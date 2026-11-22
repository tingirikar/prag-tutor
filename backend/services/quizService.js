import { createHash, randomUUID } from 'node:crypto'
import mongoose from 'mongoose'
import QuizAttempt from '../models/QuizAttempt.js'
import QuizSet from '../models/QuizSet.js'
import QuizState from '../models/QuizState.js'
import TopicMastery, { normalizeTopicName } from '../models/TopicMastery.js'
import Prerequisite from '../models/Prerequisite.js'
import { diagnoseMisconception } from './pythonService.js'

/**
 * Normalizes difficulty level string and provides pedagogical focus guidelines.
 */
function normalizeLevel(level) {
  const l = String(level || '').trim().toLowerCase()
  if (l === 'beginner' || l === 'easy') {
    return {
      name: 'Easy (Beginner)',
      focus: 'fundamental definitions, key concepts, terminology, and direct conceptual identification',
    }
  }
  if (l === 'expert' || l === 'hard') {
    return {
      name: 'Hard (Expert)',
      focus: 'edge cases, worst-case trade-offs, internal mechanics, algorithmic invariants, and in-depth analytical reasoning',
    }
  }
  return {
    name: 'Medium (Intermediate)',
    focus: 'operational mechanics, typical algorithmic execution, time and space complexities, and comparative trade-offs',
  }
}

/**
 * Clean helper to call the configured AI provider in the project.
 * Supports Groq Cloud API with model fallbacks (openai/gpt-oss-120b, qwen/qwen3.8-27b, openai/gpt-oss-20b)
 * and local Ollama as final fallback.
 */
async function callLLMProvider(messages) {
  const groqApiKey = (process.env.GROQ_API_KEY || '').trim()
  const preferredModel = (process.env.GROQ_MODEL || '').trim()

  const candidateModels = [
    preferredModel,
    'openai/gpt-oss-120b',
    'qwen/qwen3.8-27b',
    'openai/gpt-oss-20b',
  ].filter(Boolean)
  const uniqueModels = Array.from(new Set(candidateModels))

  // Attempt 1: Groq Cloud API
  if (groqApiKey) {
    for (const model of uniqueModels) {
      try {
        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${groqApiKey}`,
          },
          body: JSON.stringify({
            model,
            messages,
            temperature: 0.3,
          }),
          signal: AbortSignal.timeout(30000),
        })

        if (response.ok) {
          const data = await response.json()
          const content = data.choices?.[0]?.message?.content
          if (content && content.trim()) return content
        } else {
          const errorText = await response.text().catch(() => '')
          console.warn(`[quizService] Groq model ${model} returned ${response.status}: ${errorText}`)
        }
      } catch (err) {
        console.warn(`[quizService] Groq request error for ${model}:`, err.message)
      }
    }
  }

  // Attempt 2: Local Ollama
  const ollamaUrl = (process.env.OLLAMA_URL || 'http://127.0.0.1:11434').replace(/\/$/, '')
  const ollamaModel = process.env.OLLAMA_MODEL || 'llama3.2:3b'

  try {
    const response = await fetch(`${ollamaUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: ollamaModel,
        messages,
        stream: false,
      }),
      signal: AbortSignal.timeout(30000),
    })

    if (response.ok) {
      const data = await response.json()
      const content = data.message?.content
      if (content && content.trim()) return content
    }
  } catch (err) {
    console.warn('[quizService] Ollama request error:', err.message)
  }

  throw new Error('AI provider unavailable. Please configure GROQ_API_KEY or ensure local Ollama is running.')
}

/**
 * Parses and validates raw LLM output into exactly 6 high-quality question objects.
 */
function parseAndValidateQuestions(rawContent) {
  let parsed
  try {
    parsed = JSON.parse(rawContent)
  } catch {
    const cleaned = rawContent.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim()
    try {
      parsed = JSON.parse(cleaned)
    } catch {
      const jsonMatch = rawContent.match(/\{[\s\S]*\}/) || rawContent.match(/\[[\s\S]*\]/)
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0])
      } else {
        throw new Error('Failed to parse JSON response from AI provider.')
      }
    }
  }

  const rawList = Array.isArray(parsed)
    ? parsed
    : (Array.isArray(parsed?.questions) ? parsed.questions : parsed?.quiz || [])

  if (!Array.isArray(rawList) || rawList.length < 6) {
    throw new Error(`Expected at least 6 questions from AI provider, received ${rawList?.length || 0}.`)
  }

  return rawList.slice(0, 6).map((item, index) => {
    const question = String(item.question || '').trim()
    if (!question) {
      throw new Error(`Question ${index + 1} is missing question text.`)
    }

    if (!Array.isArray(item.options) || item.options.length !== 4) {
      throw new Error(`Question ${index + 1} must contain exactly 4 options.`)
    }

    const options = item.options.map((opt) => String(opt).trim())
    let correctAnswer = String(item.correctAnswer || '').trim()

    // Normalize letter-indicator answers (e.g., "A", "Option A") to matching option text
    if (!options.includes(correctAnswer)) {
      const letterMatch = correctAnswer.match(/^(?:option\s+)?([A-D])$/i)
      if (letterMatch) {
        const optIndex = letterMatch[1].toUpperCase().charCodeAt(0) - 65
        if (options[optIndex]) {
          correctAnswer = options[optIndex]
        }
      }
    }

    if (!options.includes(correctAnswer)) {
      throw new Error(`Question ${index + 1} correctAnswer must match one of the four options.`)
    }

    let distractorMisconceptions = {}
    if (item.distractorMisconceptions && typeof item.distractorMisconceptions === 'object') {
      for (const [optKey, misText] of Object.entries(item.distractorMisconceptions)) {
        if (typeof misText === 'string' && misText.trim()) {
          distractorMisconceptions[optKey.trim()] = misText.trim()
        }
      }
    }

    return {
      question,
      options,
      correctAnswer,
      distractorMisconceptions,
    }
  })
}

/**
 * 1. generateQuizQuestions(explanation, level, query)
 * Generates exactly 6 high-quality, conceptual MCQs based on the lesson explanation
 * tailored strictly to the user's selected difficulty level.
 */
export async function generateQuizQuestions(explanation, level = 'beginner', query = '') {
  if (!explanation || typeof explanation !== 'string' || !explanation.trim()) {
    throw new Error('Valid explanation text is required to generate quiz questions.')
  }

  const levelInfo = normalizeLevel(level)

  const systemPrompt =
    `You are an expert Computer Science educator and assessment designer for PRAG-TUTOR. ` +
    `Your task is to create high-quality, conceptual multiple-choice questions (MCQs) evaluating a student's grasp of the provided lesson explanation. ` +
    `Difficulty Level: ${levelInfo.name} (Focus on ${levelInfo.focus}). ` +
    `For each distractor (incorrect option), diagnose the specific conceptual misconception or false assumption behind selecting it. ` +
    `Output ONLY a valid JSON object matching the requested schema.`

  const userPrompt =
    `Generate exactly 6 conceptual multiple-choice questions (MCQs) based on the lesson explanation below.\n\n` +
    (query ? `STUDENT QUERY:\n${query.trim()}\n\n` : '') +
    `LESSON EXPLANATION:\n"""\n${explanation.trim()}\n"""\n\n` +
    `DIFFICULTY LEVEL: ${levelInfo.name}\n` +
    `Focus: ${levelInfo.focus}\n\n` +
    `Strict Quality Guidelines:\n` +
    `1. Conceptual Depth: Do NOT ask superficial questions or repeat the question text inside the answer options.\n` +
    `2. Question Structure: Formulate clear, well-phrased questions that genuinely test understanding of concepts, mechanisms, algorithms, properties, and complexity described in the lesson.\n` +
    `3. Plausible Distractors: Each question must have exactly 4 options. All 3 wrong options (distractors) must be realistic, intelligent misconceptions or closely related technical terms—never nonsense, trivial fragments, or obvious throwaways.\n` +
    `4. Distractor Misconceptions: For each of the 3 wrong options, provide a 1-sentence explanation of the conceptual misconception behind choosing it in the "distractorMisconceptions" map.\n` +
    `5. Verbatim Correct Answer: The "correctAnswer" field must exactly match one of the 4 items in "options".\n` +
    `6. Return exactly 6 questions.\n\n` +
    `Return ONLY a JSON object formatted as:\n` +
    `{\n` +
    `  "questions": [\n` +
    `    {\n` +
    `      "question": "Question text?",\n` +
    `      "options": ["Option A", "Option B", "Option C", "Option D"],\n` +
    `      "correctAnswer": "Option A",\n` +
    `      "distractorMisconceptions": {\n` +
    `        "Option B": "Confuses X with Y",\n` +
    `        "Option C": "Assumes worst-case complexity applies in all scenarios",\n` +
    `        "Option D": "Misapplies property Z"\n` +
    `      }\n` +
    `    }\n` +
    `  ]\n` +
    `}`

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ]

  const rawContent = await callLLMProvider(messages)
  return parseAndValidateQuestions(rawContent)
}

/**
 * 2. createQuizSet({ studentUsername, subject, conversationId, query, explanation, level, topic })
 * Generates exactly 6 MCQs tailored to the user's selected difficulty level
 * and saves one QuizSet with initial status 'pending'.
 */
export async function createQuizSet({
  studentUsername,
  subject,
  conversationId,
  query,
  explanation,
  level = 'beginner',
  topic = '',
}) {
  if (!conversationId) {
    throw new Error('conversationId is required for createQuizSet.')
  }

  const rawQuestions = await generateQuizQuestions(explanation, level, query)

  const questions = rawQuestions.map((q) => ({
    question_id: randomUUID(),
    topic: String(topic || '').trim(),
    question: q.question,
    options: q.options,
    correctAnswer: q.correctAnswer,
    distractorMisconceptions: q.distractorMisconceptions || {},
    difficulty: String(level || 'beginner'),
  }))

  const quizSet = await QuizSet.create({
    studentUsername,
    subject,
    conversationId: String(conversationId),
    query,
    explanation,
    level: String(level || 'beginner'),
    topic: String(topic || '').trim(),
    questions,
    status: 'pending',
  })

  console.log(`[QUIZ SET CREATED] id=${quizSet._id} student=${studentUsername} subject=${subject} topic="${topic}" level=${level} questions=6`)
  return quizSet
}

/**
 * 3. getQuizState(studentUsername, subject)
 * Retrieves or creates the student's persistent QuizState per student and subject.
 */
export async function getQuizState(studentUsername, subject) {
  let state = await QuizState.findOne({ studentUsername, subject })

  if (!state) {
    try {
      state = await QuizState.create({
        studentUsername,
        subject,
        pendingQuizSetIds: [],
        skipCount: 0,
      })
    } catch (err) {
      if (err.code === 11000) {
        state = await QuizState.findOne({ studentUsername, subject })
      } else {
        throw err
      }
    }
  }

  return state
}

function quizId(value) {
  if (!mongoose.isObjectIdOrHexString(value)) {
    throw Object.assign(new Error('A valid quiz set ID is required.'), { status: 400 })
  }
  return String(value).toLowerCase()
}

function unavailableQuiz() {
  return Object.assign(new Error('Quiz not found or no longer available.'), { status: 404 })
}

// Older records have no generation-source field. This option identifies the retired template.
function isLegacyFallback(quiz) {
  return quiz.questions.some(q => q.options.includes('It is an auxiliary mechanism discarded after memory allocation.'))
}

export function publicQuestions(questions = []) {
  if (!Array.isArray(questions)) return []
  return questions.filter(Boolean).map(({ question_id, question, options }) => ({ question_id, question, options }))
}

/**
 * 4. recordQuizSkip(studentUsername, subject, quizSetId)
 * Dismisses the named quiz and records the skip once.
 */
export async function recordQuizSkip(studentUsername, subject, quizSetId, conversationId) {
  const scope = { studentUsername, subject, _id: quizId(quizSetId) }
  if (conversationId) scope.conversationId = String(conversationId)
  const quiz = await QuizSet.findOne(scope)
  if (!quiz || !['pending', 'skipped'].includes(quiz.status)) throw unavailableQuiz()
  const state = await getQuizState(studentUsername, subject)
  const slot = 'claims.' + scope._id
  if (quiz.status === 'skipped' && !state.claims?.has(scope._id)) throw unavailableQuiz()
  const skipped = await QuizState.findOneAndUpdate(
    { _id: state._id, [slot]: null },
    { $set: { [slot]: 'skipped' }, $inc: { skipCount: 1 }, $pull: { pendingQuizSetIds: scope._id } },
    { new: true },
  ) || await QuizState.findOne({ _id: state._id, [slot]: 'skipped' })
  if (!skipped) throw unavailableQuiz()
  await QuizSet.updateOne({ ...scope, status: 'pending' }, { $set: { status: 'skipped' } })
  return skipped
}

/**
 * 5. getPendingQuizSets(studentUsername, subject)
 * Quizzes are not stacked across queries. Returns empty array.
 */
export async function getPendingQuizSets(studentUsername, subject) {
  return []
}

/**
 * 6. shouldForceQuiz(studentUsername, subject)
 * Quizzes are strictly optional; students can decline any number of times.
 */
export async function shouldForceQuiz(studentUsername, subject) {
  return false
}

/**
 * 7. getConversationQuizStatus(studentUsername, subject, currentQuizSet)
 * Quizzes are strictly optional and per-query (not stacked).
 */
export async function getConversationQuizStatus(studentUsername, subject, currentQuizSet = null) {
  const state = await getQuizState(studentUsername, subject)
  const compulsory = false

  const quizSetIds = currentQuizSet ? [currentQuizSet._id.toString()] : []
  const totalCalculated = currentQuizSet ? (currentQuizSet.questions?.length || 6) : 0

  console.log(
    `[QUIZ STATUS]\n` +
    `  student=${studentUsername} subject=${subject}\n` +
    `  skipCount=${state?.skipCount || 0}\n` +
    `  compulsory=${compulsory}\n` +
    `  hasCurrentQuizSet=${Boolean(currentQuizSet)}\n` +
    `  totalQuestions=${totalCalculated}`
  )

  return {
    quizRequired: compulsory,
    compulsory,
    questions: [],
    quizSetIds,
    total: totalCalculated,
    pendingCount: 0,
    skipCount: state?.skipCount || 0,
  }
}

/**
 * 8. buildQuiz(studentUsername, subject, currentQuizSetId)
 * Returns the quiz payload for the current query context only.
 */
export async function buildQuiz(studentUsername, subject, currentQuizSetId, conversationId) {
  const scope = { studentUsername, subject, _id: quizId(currentQuizSetId), status: 'pending' }
  if (conversationId) scope.conversationId = String(conversationId)
  const quizSet = await QuizSet.findOne(scope)
  if (!quizSet || isLegacyFallback(quizSet) || await QuizState.exists({
    studentUsername, subject, ['claims.' + scope._id]: { $exists: true },
  })) throw unavailableQuiz()
  const questionsToPresent = publicQuestions(quizSet.questions)

  return {
    quizSetIds: [quizSet._id.toString()],
    questions: questionsToPresent,
    total: questionsToPresent.length,
  }
}


/**
 * ── BKT and Ebbinghaus Forgetting Engine Helpers ───────────────────────
 */

/**
 * Computes time-decayed mastery score using Ebbinghaus exponential forgetting curve.
 * Formula:
 *   decayFactor = exp(-elapsedDays / S)
 *   effective = pPrior + (pKnown - pPrior) * decayFactor
 */
export function computeEffectiveMastery(pKnown, lastAssessedAt, memoryStability = 7.0, pPrior = 0.20) {
  const pK = Math.min(Math.max(Number(pKnown) || 0, 0.0), 1.0)
  const p0 = Math.min(Math.max(Number(pPrior) || 0.20, 0.0), 1.0)
  const stability = Math.max(0.5, Number(memoryStability) || 7.0)

  const elapsedDays = lastAssessedAt
    ? Math.max(0, (Date.now() - new Date(lastAssessedAt).getTime()) / (1000 * 60 * 60 * 24))
    : 0

  const decayFactor = Math.exp(-elapsedDays / stability)
  const effective = p0 + (pK - p0) * decayFactor
  const clampedEffective = Math.min(Math.max(effective, 0.0), 1.0)

  const needsRefresher = pK >= 0.85 && clampedEffective < 0.70
  const mastered = clampedEffective >= 0.85 || (pK >= 0.85 && !needsRefresher)

  return {
    effectiveMastery: Number(clampedEffective.toFixed(4)),
    needsRefresher,
    mastered,
  }
}

/**
 * Updates mastery probability after a single response using Bayesian Knowledge Tracing.
 */
export function updateBKTStep(pKnown, isCorrect, pLearn = 0.15, pGuess = 0.25, pSlip = 0.10) {
  const pClamped = Math.min(Math.max(Number(pKnown) || 0.20, 0.001), 0.999)
  let pObs
  if (isCorrect) {
    const num = pClamped * (1.0 - pSlip)
    const den = num + (1.0 - pClamped) * pGuess
    pObs = den > 0 ? num / den : pClamped
  } else {
    const num = pClamped * pSlip
    const den = num + (1.0 - pClamped) * (1.0 - pGuess)
    pObs = den > 0 ? num / den : pClamped
  }
  const pNext = pObs + (1.0 - pObs) * pLearn
  return Number(Math.min(Math.max(pNext, 0.001), 0.999).toFixed(4))
}

/**
 * Updates memory stability S (days) and review streak based on quiz accuracy.
 */
export function updateMemoryStability(currentStability = 7.0, reviewStreak = 0, accuracy = 0) {
  const currS = Math.max(0.5, Number(currentStability) || 7.0)
  const streak = Math.max(0, Number(reviewStreak) || 0)
  const acc = Math.min(Math.max(Number(accuracy) || 0, 0.0), 1.0)

  let newStreak = streak
  let newStability = currS

  if (acc >= 0.67) {
    newStreak = streak + 1
    newStability = Math.min(90.0, Number((currS * (1.0 + 0.5 * newStreak)).toFixed(2)))
  } else if (acc < 0.50) {
    newStreak = 0
    newStability = Math.max(3.0, Number((currS * 0.75).toFixed(2)))
  }

  return { newStability, newStreak }
}

/**
 * Upward Implicit Prerequisite Review:
 * When a student scores high accuracy (>= 0.80) on an advanced topic, look up its
 * direct prerequisites from the Prerequisite model for that subject.
 * For each direct prerequisite where the student has TopicMastery with pKnown >= 0.50:
 * - Refresh lastAssessedAt = new Date()
 * - Clear needsRefresher = false
 * - Nudge pKnown upward: pKnown = min(0.99, pKnown + (1 - pKnown) * 0.08)
 */
export async function applyImplicitPrerequisiteReview({
  studentUsername,
  subject,
  topic,
  topicAccuracy = 1.0,
  reviewKey,
}) {
  if (!studentUsername || !subject || !topic || topicAccuracy < 0.80) {
    return []
  }

  const cleanSubject = String(subject || '').trim().toUpperCase()
  const cleanTopic = String(topic || '').trim()

  try {
    const escapedTopic = cleanTopic.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const prereqDoc = await Prerequisite.findOne({
      subject: cleanSubject,
      topic: { $regex: new RegExp(`^${escapedTopic}$`, 'i') },
    }).lean()

    const directPrereqs = prereqDoc?.prerequisites || []
    if (!Array.isArray(directPrereqs) || directPrereqs.length === 0) {
      return []
    }

    const boostedPrereqs = []

    for (const prereqName of directPrereqs) {
      const normPrereq = normalizeTopicName(prereqName)
      if (!normPrereq) continue

      const pMastery = await TopicMastery.findOne({
        studentUsername,
        subject: cleanSubject,
        normalizedTopic: normPrereq,
      })

      if (reviewKey && pMastery?.assessmentReviews.some(r => r.key === reviewKey)) continue
      if (pMastery && (pMastery.pKnown != null ? pMastery.pKnown : 0.20) >= 0.50) {
        const currentP = pMastery.pKnown != null ? pMastery.pKnown : 0.50
        const boostedP = Math.min(0.99, Number((currentP + (1.0 - currentP) * 0.08).toFixed(4)))

        pMastery.pKnown = boostedP
        pMastery.effectiveMastery = boostedP
        pMastery.needsRefresher = false
        pMastery.lastAssessedAt = new Date()
        if (boostedP >= 0.85) {
          pMastery.mastered = true
        }

        if (reviewKey) pMastery.assessmentReviews.push({ key: reviewKey })
        await pMastery.save()
        boostedPrereqs.push({
          topic: pMastery.topic,
          priorPKnown: currentP,
          boostedPKnown: boostedP,
        })

        console.log(
          `[IMPLICIT PREREQUISITE REVIEW] student=${studentUsername} | subject=${cleanSubject} | advancedTopic="${cleanTopic}" (accuracy=${(topicAccuracy * 100).toFixed(0)}%) -> prereq="${pMastery.topic}" boosted from ${currentP} to ${boostedP}`
        )
      }
    }

    return boostedPrereqs
  } catch (err) {
    if (reviewKey) throw err
    console.warn(`[quizService] Error in applyImplicitPrerequisiteReview for ${topic}:`, err.message)
    return []
  }
}

/**
 * 9. completeQuiz({ studentUsername, subject, quizSetIds, answers, conversationId })
 * Authoritatively scores questions:
 * - Scores only against the included QuizSets.
 * - Marks included QuizSets as completed.
 * - Removes those QuizSet IDs from pendingQuizSetIds.
 * - Resets skipCount to 0.
 * - Evaluates Bayesian Knowledge Tracing & decay per topic.
 * - Saves QuizAttempt with bktUpdates.
 * - Never asks those completed QuizSets again.
 */
export async function completeQuiz({
  studentUsername,
  subject,
  quizSetIds = [],
  answers = [],
  conversationId = null,
}) {
  if (!Array.isArray(quizSetIds) || !quizSetIds.length) {
    throw Object.assign(new Error('At least one quiz set ID is required.'), { status: 400 })
  }
  const ids = quizSetIds.map(quizId)
  if (new Set(ids).size !== ids.length || !Array.isArray(answers) ||
      answers.some(a => !a || typeof a.selectedAnswer !== 'string')) {
    throw Object.assign(new Error('Invalid quiz submission.'), { status: 400 })
  }

  const scope = { studentUsername, subject, _id: { $in: ids } }
  if (conversationId) scope.conversationId = String(conversationId)
  const records = await QuizSet.find(scope)
  if (records.length !== ids.length || records.some(isLegacyFallback)) throw unavailableQuiz()
  const byId = new Map(records.map(q => [String(q._id), q]))
  const quizSets = ids.map(id => byId.get(id))
  const sortedIds = [...ids].sort()
  const submissionKey = createHash('sha256').update(sortedIds.join(',')).digest('hex')
  const attemptId = sortedIds[0]
  const conflict = () => Object.assign(new Error('This quiz has already been submitted or dismissed.'), { status: 409 })
  if (records.some(q => q.status !== 'pending' && q.submissionKey !== submissionKey)) throw conflict()

  // Build authoritative question list
  const allKnownQuestions = []
  for (const qs of quizSets) {
    const fallbackTopic = qs.topic || qs.query || ''
    for (const q of qs.questions) {
      allKnownQuestions.push({
        question_id: q.question_id,
        topic: q.topic || fallbackTopic,
        question: q.question,
        options: q.options,
        correctAnswer: q.correctAnswer,
        distractorMisconceptions: q.distractorMisconceptions || {},
        difficulty: q.difficulty || qs.level || 'intermediate',
      })
    }
  }

  // Map user answers by question_id or questionIndex
  const answerMap = new Map()
  for (const ans of answers) {
    const questionId = ans.question_id || allKnownQuestions[ans.questionIndex]?.question_id
    if (questionId) answerMap.set(questionId, ans.selectedAnswer)
  }

  // Reserve the whole batch with one compare-and-set. A retry may continue only
  // if every slot belongs to the same submission. Skips use these same slots.
  const state = await getQuizState(studentUsername, subject)
  const emptySlots = {}
  const claimedSlots = {}
  for (const id of ids) {
    emptySlots['claims.' + id] = null
    claimedSlots['claims.' + id] = submissionKey
  }
  const reserved = await QuizState.updateOne({ _id: state._id, ...emptySlots }, {
    $set: { ...claimedSlots, skipCount: 0 }, $pull: { pendingQuizSetIds: { $in: ids } },
  })
  if (!reserved.matchedCount && !await QuizState.exists({ _id: state._id, ...claimedSlots })) throw conflict()
  await QuizSet.updateMany({ ...scope, status: 'pending' }, { $set: { status: 'submitting', submissionKey } })

  let attempt = await QuizAttempt.findById(attemptId)
  if (!attempt) {
    const graded = await gradeAnswers(allKnownQuestions, answerMap)
    // All concurrent scorers share this attempt. The first saved answers are authoritative.
    attempt = await QuizAttempt.findOneAndUpdate({ _id: attemptId }, { $setOnInsert: {
      studentUsername, subject, conversationId: quizSets[0].conversationId,
      quizSetIds: ids, questions: allKnownQuestions, ...graded, completedAt: new Date(),
    } }, { new: true, upsert: true, runValidators: true })
  }

  const { answers: answeredDetails } = attempt
  if (attempt.quizSetIds.map(String).join(',') !== ids.join(',') ||
      answeredDetails.some((a, i) => a.selectedAnswer !== (answerMap.get(allKnownQuestions[i].question_id) || ''))) {
    throw conflict()
  }

  if (records.every(q => q.status === 'completed')) return submissionResult(attempt)

  // Apply the persisted evidence once per topic.
  const topicGroups = new Map()
  for (let idx = 0; idx < allKnownQuestions.length; idx++) {
    const qObj = allKnownQuestions[idx]
    const fallbackTopic = quizSets[0]?.topic || quizSets[0]?.query || 'General'
    const topicName = (qObj.topic || fallbackTopic).trim()
    const norm = normalizeTopicName(topicName) || 'general'

    if (!topicGroups.has(norm)) {
      topicGroups.set(norm, {
        originalTopic: topicName,
        observations: [],
        score: 0,
        total: 0,
        newMisconceptions: [],
      })
    }

    const group = topicGroups.get(norm)
    const ansRecord = answeredDetails[idx]
    group.observations.push(ansRecord.isCorrect)
    group.total += 1
    if (ansRecord.isCorrect) {
      group.score += 1
    } else if (ansRecord.diagnosedMisconception) {
      group.newMisconceptions.push({
        misconception: ansRecord.diagnosedMisconception,
        distractorChosen: ansRecord.selectedAnswer,
        questionText: qObj.question,
      })
    }
  }

  const bktUpdates = []

  for (const group of topicGroups.values()) {
    const review = await recordTopicMastery({
      studentUsername, subject, topic: group.originalTopic, observations: group.observations,
      score: group.score, total: group.total, newMisconceptions: group.newMisconceptions,
      assessmentKey: attemptId,
    })
    if (review) bktUpdates.push({
      topic: review.topic, priorMastery: review._priorMastery, posteriorMastery: review._posteriorMastery,
    })
  }

  await QuizAttempt.updateOne({ _id: attemptId }, { $set: { bktUpdates } })
  attempt.bktUpdates = bktUpdates
  await QuizSet.updateMany({ ...scope, submissionKey, status: 'submitting' }, { $set: { status: 'completed' } })
  return submissionResult(attempt)
}

function submissionResult(attempt) {
  const { score, total, bktUpdates } = attempt
  const masteredTopics = bktUpdates.filter(b => b.posteriorMastery >= 0.85).map(b => b.topic)
  const diagnosedMisconceptions = attempt.answers.flatMap((a, i) => {
    if (!a.diagnosedMisconception) return []
    const { topic, question, correctAnswer } = attempt.questions[i]
    return [{ topic, question, selectedAnswer: a.selectedAnswer, correctAnswer, misconception: a.diagnosedMisconception }]
  })
  return {
    success: true, attempt, score, total, correctCount: score, percentage: total ? score / total * 100 : 0,
    mastered: masteredTopics.length > 0, masteredTopics, bktUpdates, diagnosedMisconceptions,
  }
}

async function gradeAnswers(allKnownQuestions, answerMap) {
  let score = 0
  const total = allKnownQuestions.length
  const answeredDetails = []

  for (let idx = 0; idx < allKnownQuestions.length; idx++) {
    const qObj = allKnownQuestions[idx]
    const selected = answerMap.get(qObj.question_id) || ''
    const isCorrect = String(selected).trim() === String(qObj.correctAnswer).trim()
    let diagnosed = null

    if (isCorrect) {
      score += 1
    } else if (selected && String(selected).trim()) {
      let foundInMap = null
      const misconceptionsMap = qObj.distractorMisconceptions
      if (misconceptionsMap) {
        if (typeof misconceptionsMap.get === 'function') {
          foundInMap = misconceptionsMap.get(selected)
        } else if (typeof misconceptionsMap === 'object') {
          foundInMap = misconceptionsMap[selected]
        }
      }

      if (foundInMap && typeof foundInMap === 'string') {
        diagnosed = foundInMap.trim()
      } else {
        diagnosed = await diagnoseMisconception({
          topic: qObj.topic,
          question: qObj.question,
          selectedAnswer: selected,
          correctAnswer: qObj.correctAnswer,
        })
      }
    }

    answeredDetails.push({
      questionIndex: idx,
      selectedAnswer: selected,
      isCorrect,
      diagnosedMisconception: diagnosed,
    })
  }

  return { answers: answeredDetails, score, total }
}


/**
 * 10. recordTopicMastery({ studentUsername, subject, topic, observations, score, total, newMisconceptions })
 * Updates Bayesian Knowledge Tracing posterior, Ebbinghaus memory stability, and active misconceptions.
 */
export async function recordTopicMastery({
  studentUsername,
  subject,
  topic,
  observations = [],
  score = 0,
  total = 0,
  newMisconceptions = [],
  assessmentKey,
}) {
  if (!topic || !studentUsername || !subject) return null
  const normalizedTopic = normalizeTopicName(topic)
  if (!normalizedTopic) return null

  // Ensure observations array exists if legacy score/total was supplied
  let obs = Array.isArray(observations) ? observations : []
  if (obs.length === 0 && total > 0) {
    obs = Array(score).fill(true).concat(Array(Math.max(0, total - score)).fill(false))
  }

  const existing = await TopicMastery.findOne({
    studentUsername,
    subject,
    normalizedTopic,
  })

  const previous = assessmentKey && existing?.assessmentReviews.find(r => r.key === assessmentKey)
  const reinforce = topicAccuracy => applyImplicitPrerequisiteReview({
    studentUsername, subject, topic, topicAccuracy,
    reviewKey: assessmentKey && assessmentKey + '/' + normalizedTopic,
  })
  if (previous) {
    existing._priorMastery = previous.priorMastery
    existing._posteriorMastery = previous.posteriorMastery
    if (total > 0 && score / total >= 0.80) await reinforce(score / total)
    return existing
  }

  let priorMastery = 0.20
  let currentStability = 7.0
  let currentStreak = 0

  if (existing) {
    const pK = existing.pKnown != null ? existing.pKnown : (existing.mastered ? 0.85 : 0.20)
    currentStability = existing.memoryStability != null ? existing.memoryStability : 7.0
    currentStreak = existing.reviewStreak != null ? existing.reviewStreak : 0

    const decayed = computeEffectiveMastery(pK, existing.lastAssessedAt, currentStability)
    priorMastery = decayed.effectiveMastery
  }

  let posteriorMastery = priorMastery
  for (const item of obs) {
    posteriorMastery = updateBKTStep(posteriorMastery, Boolean(item))
  }

  const topicTotal = total || obs.length || 1
  const topicCorrect = score != null ? score : obs.filter(Boolean).length
  const accuracy = topicTotal > 0 ? topicCorrect / topicTotal : 0
  const { newStability, newStreak } = updateMemoryStability(currentStability, currentStreak, accuracy)

  const mastered = posteriorMastery >= 0.85

  // Process and manage active misconceptions
  const activeMisconceptions = existing && Array.isArray(existing.activeMisconceptions)
    ? existing.activeMisconceptions
    : []

  // If mastered (posterior >= 0.85) or 100% score on this quiz, resolve previously active misconceptions
  const isPerfectScore = topicCorrect === topicTotal && topicTotal > 0
  if (mastered || isPerfectScore) {
    for (const m of activeMisconceptions) {
      m.resolved = true
    }
  }

  // Track newly detected misconceptions in this session
  for (const item of newMisconceptions) {
    if (!item.misconception) continue
    const normMisconception = item.misconception.trim().toLowerCase()
    const normQ = (item.questionText || '').trim().toLowerCase()
    const normDist = (item.distractorChosen || '').trim().toLowerCase()

    const existingEntry = activeMisconceptions.find((m) => {
      const matchText = (m.misconception || '').trim().toLowerCase() === normMisconception
      const matchQuestionDistractor =
        normQ && normDist &&
        (m.questionText || '').trim().toLowerCase() === normQ &&
        (m.distractorChosen || '').trim().toLowerCase() === normDist
      return matchText || matchQuestionDistractor
    })

    if (existingEntry) {
      existingEntry.occurrences = (existingEntry.occurrences || 1) + 1
      existingEntry.detectedAt = new Date()
      existingEntry.resolved = false
      if (item.distractorChosen) existingEntry.distractorChosen = item.distractorChosen
      if (item.questionText) existingEntry.questionText = item.questionText
    } else {
      activeMisconceptions.push({
        misconception: item.misconception.trim(),
        distractorChosen: item.distractorChosen || '',
        questionText: item.questionText || '',
        detectedAt: new Date(),
        occurrences: 1,
        resolved: false,
      })
    }
  }

  const mastery = existing || new TopicMastery({ studentUsername, subject, topic: topic.trim(), normalizedTopic })
  mastery.bestScore = Math.max(mastery.bestScore || 0, topicCorrect)
  mastery.total = Math.max(mastery.total || 0, topicTotal)
  mastery.pKnown = posteriorMastery
  mastery.effectiveMastery = posteriorMastery
  mastery.needsRefresher = false
  mastery.memoryStability = newStability
  mastery.reviewStreak = newStreak
  mastery.attemptsCount = (mastery.attemptsCount || 0) + 1
  mastery.questionsAnswered = (mastery.questionsAnswered || 0) + topicTotal
  mastery.mastered = mastered
  mastery.activeMisconceptions = activeMisconceptions
  if (mastered && !mastery.firstMasteredAt) mastery.firstMasteredAt = new Date()
  mastery.lastAssessedAt = new Date()
  if (assessmentKey) mastery.assessmentReviews.push({ key: assessmentKey, priorMastery, posteriorMastery })
  await mastery.save()

  mastery._priorMastery = priorMastery
  mastery._posteriorMastery = posteriorMastery
  if (accuracy >= 0.80) await reinforce(accuracy)
  return mastery
}


/**
 * 11. getMasteredTopics(studentUsername, subject)
 * Retrieves list of actively mastered topics for a student in a subject,
 * dynamically checking for Ebbinghaus decay below the refresher threshold.
 */
export async function getMasteredTopics(studentUsername, subject) {
  if (!studentUsername || !subject) return []
  const filter = {
    studentUsername,
    subject: subject.trim().toUpperCase(),
  }

  const records = await TopicMastery.find(filter)
  const effectivelyMastered = []

  for (const doc of records) {
    const pK = doc.pKnown != null ? doc.pKnown : (doc.mastered ? 0.85 : 0.20)
    const stability = doc.memoryStability != null ? doc.memoryStability : 7.0
    const decayed = computeEffectiveMastery(pK, doc.lastAssessedAt, stability)

    if ((doc.mastered || pK >= 0.85) && decayed.needsRefresher) {
      await TopicMastery.updateOne(
        { _id: doc._id },
        {
          $set: {
            mastered: false,
            needsRefresher: true,
            effectiveMastery: decayed.effectiveMastery,
          },
        }
      )
    } else if (decayed.mastered && (doc.mastered || pK >= 0.85)) {
      effectivelyMastered.push(doc.topic)
    }
  }

  return effectivelyMastered
}

/**
 * 12. getStudentMasteryDetails({ studentUsername, subject })
 * Fetches comprehensive topic mastery data for a student, merging
 * dynamic BKT & decay statuses with curriculum topics from Prerequisites.
 */
export async function getStudentMasteryDetails({ studentUsername, subject }) {
  if (!studentUsername) {
    return {
      masteredTopics: [],
      remainingTopics: [],
      allTopics: [],
      stats: { totalTopics: 0, masteredCount: 0, remainingCount: 0, progressPercentage: 0, averageScore: 0 },
    }
  }

  const masteryFilter = { studentUsername }
  if (subject) {
    masteryFilter.subject = subject.trim().toUpperCase()
  }

  const rawMasteryRecords = await TopicMastery.find(masteryFilter).sort({ lastAssessedAt: -1 })

  const normalizedMasteryMap = new Map()
  for (const m of (rawMasteryRecords || [])) {
    const pK = m.pKnown != null ? m.pKnown : (m.mastered ? 0.85 : 0.20)
    const stability = m.memoryStability != null ? m.memoryStability : 7.0
    const decayed = computeEffectiveMastery(pK, m.lastAssessedAt, stability)

    if (m.mastered && decayed.needsRefresher) {
      await TopicMastery.updateOne(
        { _id: m._id },
        {
          $set: {
            mastered: false,
            needsRefresher: true,
            effectiveMastery: decayed.effectiveMastery,
          },
        }
      )
      m.mastered = false
      m.needsRefresher = true
      m.effectiveMastery = decayed.effectiveMastery
    }

    const key = `${m.subject || ''}:::${m.normalizedTopic}`
    normalizedMasteryMap.set(key, {
      subject: m.subject,
      topic: m.topic,
      normalizedTopic: m.normalizedTopic,
      pKnown: pK,
      effectiveMastery: decayed.effectiveMastery,
      isMastered: m.mastered && !decayed.needsRefresher,
      needsRefresher: decayed.needsRefresher,
      memoryStability: stability,
      reviewStreak: m.reviewStreak ?? 0,
      bestScore: m.bestScore || 0,
      total: m.total || 0,
      percentage: m.total > 0 ? Math.round(((m.bestScore || 0) / m.total) * 100) : 0,
      firstMasteredAt: m.firstMasteredAt || null,
      lastAssessedAt: m.lastAssessedAt || null,
      activeMisconceptions: (m.activeMisconceptions || []).filter(item => !item.resolved),
    })
  }

  // Fetch curriculum/syllabus topics from Prerequisite collection
  const prereqFilter = subject ? { subject: subject.trim().toUpperCase() } : {}
  const prereqRecords = await Prerequisite.find(prereqFilter).sort({ topic: 1 }).lean()

  const topicMap = new Map()

  // 1. Add all syllabus topics from Prerequisite
  for (const p of (prereqRecords || [])) {
    const norm = normalizeTopicName(p.topic)
    const key = `${p.subject || ''}:::${norm}`
    const mastery = normalizedMasteryMap.get(key)

    topicMap.set(key, {
      subject: p.subject,
      topic: p.topic,
      normalizedTopic: norm,
      prerequisites: p.prerequisites || [],
      isMastered: mastery ? mastery.isMastered : false,
      needsRefresher: mastery ? mastery.needsRefresher : false,
      pKnown: mastery ? mastery.pKnown : 0.20,
      effectiveMastery: mastery ? mastery.effectiveMastery : 0.20,
      memoryStability: mastery ? mastery.memoryStability : 7.0,
      reviewStreak: mastery ? mastery.reviewStreak : 0,
      bestScore: mastery ? mastery.bestScore : 0,
      total: mastery ? mastery.total : 0,
      percentage: mastery ? mastery.percentage : 0,
      firstMasteredAt: mastery?.firstMasteredAt || null,
      lastAssessedAt: mastery?.lastAssessedAt || null,
      activeMisconceptions: mastery?.activeMisconceptions || [],
    })
  }

  // 2. Also ensure any topics assessed for the student (even if not explicitly in Prerequisite table) are included
  for (const m of normalizedMasteryMap.values()) {
    const key = `${m.subject || ''}:::${m.normalizedTopic}`
    if (!topicMap.has(key)) {
      topicMap.set(key, {
        subject: m.subject,
        topic: m.topic,
        normalizedTopic: m.normalizedTopic,
        prerequisites: [],
        isMastered: m.isMastered,
        needsRefresher: m.needsRefresher,
        pKnown: m.pKnown,
        effectiveMastery: m.effectiveMastery,
        memoryStability: m.memoryStability,
        reviewStreak: m.reviewStreak,
        bestScore: m.bestScore,
        total: m.total,
        percentage: m.percentage,
        firstMasteredAt: m.firstMasteredAt || null,
        lastAssessedAt: m.lastAssessedAt || null,
        activeMisconceptions: m.activeMisconceptions || [],
      })
    }
  }

  const allTopics = Array.from(topicMap.values())
  const completedTopics = allTopics.filter(t => t.isMastered)
  const remainingTopics = allTopics.filter(t => !t.isMastered)

  const totalTopics = allTopics.length
  const masteredCount = completedTopics.length
  const progressPercentage = totalTopics > 0 ? Math.round((masteredCount / totalTopics) * 100) : 0

  const totalScorePct = completedTopics.reduce((acc, t) => acc + (t.percentage || 0), 0)
  const averageScore = masteredCount > 0 ? Math.round(totalScorePct / masteredCount) : 0

  return {
    subject: subject || null,
    studentUsername,
    stats: {
      totalTopics,
      masteredCount,
      remainingCount: remainingTopics.length,
      progressPercentage,
      averageScore,
    },
    masteredTopics: completedTopics,
    remainingTopics,
    allTopics,
  }
}

/**
 * 13. getLearnerProfile(studentUsername, subject)
 * Returns comprehensive topic mastery records with dynamic decay evaluations,
 * active misconceptions, and refresher status.
 */
export async function getLearnerProfile(studentUsername, subject) {
  if (!studentUsername) return []
  const filter = { studentUsername }
  if (subject) {
    filter.subject = subject.trim().toUpperCase()
  }

  const docs = await TopicMastery.find(filter).lean()
  return docs.map((doc) => {
    const pK = doc.pKnown != null ? doc.pKnown : (doc.mastered ? 0.85 : 0.20)
    const stability = doc.memoryStability != null ? doc.memoryStability : 7.0
    const decayed = computeEffectiveMastery(pK, doc.lastAssessedAt, stability)

    return {
      topic: doc.topic,
      normalizedTopic: doc.normalizedTopic,
      subject: doc.subject,
      pKnown: pK,
      effectiveMastery: decayed.effectiveMastery,
      mastered: doc.mastered && !decayed.needsRefresher,
      needsRefresher: decayed.needsRefresher,
      memoryStability: stability,
      reviewStreak: doc.reviewStreak ?? 0,
      attemptsCount: doc.attemptsCount ?? 0,
      questionsAnswered: doc.questionsAnswered ?? 0,
      activeMisconceptions: (doc.activeMisconceptions || []).filter((m) => !m.resolved),
      lastAssessedAt: doc.lastAssessedAt,
      firstMasteredAt: doc.firstMasteredAt,
    }
  })
}

export default {
  generateQuizQuestions,
  createQuizSet,
  getQuizState,
  recordQuizSkip,
  getPendingQuizSets,
  shouldForceQuiz,
  getConversationQuizStatus,
  buildQuiz,
  completeQuiz,
  recordTopicMastery,
  getMasteredTopics,
  getStudentMasteryDetails,
  getLearnerProfile,
  computeEffectiveMastery,
  updateBKTStep,
  updateMemoryStability,
}

