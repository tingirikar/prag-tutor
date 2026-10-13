import { randomUUID } from 'node:crypto'
import mongoose from 'mongoose'
import QuizAttempt from '../models/QuizAttempt.js'
import QuizSet from '../models/QuizSet.js'
import QuizState from '../models/QuizState.js'
import TopicMastery, { normalizeTopicName } from '../models/TopicMastery.js'

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

    return {
      question,
      options,
      correctAnswer,
    }
  })
}

/**
 * Fallback MCQ generator: creates conceptual questions from explanation key terms
 * when all external LLM providers are offline.
 */
function generateFallbackQuestions(explanation, levelName = 'Medium') {
  const clean = explanation.replace(/[#*`_\[\]()]/g, ' ').replace(/\s+/g, ' ').trim()
  const words = clean.split(/\s+/).filter((w) => w.length > 4 && /^[a-zA-Z]+$/.test(w))
  const keyTerms = Array.from(new Set(words)).slice(0, 8)

  const templates = [
    {
      q: (t) => `What is the primary role or conceptual definition of ${t} as described in the lesson?`,
      correct: (t) => `It serves as a foundational component establishing the core properties of ${t}.`,
      d1: (t) => `It is an auxiliary mechanism discarded after memory allocation.`,
      d2: (t) => `It reverses the operational order to guarantee constant time execution.`,
      d3: (t) => `It is deprecated under standard modern algorithmic constraints.`,
    },
    {
      q: (t) => `In terms of algorithmic behavior, how does ${t} function according to the explanation?`,
      correct: (t) => `It follows the deterministic rules and constraints specified in the lesson.`,
      d1: (t) => `It performs random permutations regardless of input structure.`,
      d2: (t) => `It bypasses typical invariants and executes unconditionally.`,
      d3: (t) => `It replaces all recursive steps with static memory buffers.`,
    },
    {
      q: (t) => `What is the expected complexity or efficiency characteristic related to ${t}?`,
      correct: (t) => `It is bounded by the height or structure of the underlying data representation.`,
      d1: (t) => `It always operates in O(1) time irrespective of input volume.`,
      d2: (t) => `It suffers exponential degradation in all practical configurations.`,
      d3: (t) => `It cannot be analyzed using standard asymptotic bounds.`,
    },
    {
      q: (t) => `Which invariant or condition must remain satisfied when manipulating ${t}?`,
      correct: (t) => `The ordering and structural consistency defined in the explanation.`,
      d1: (t) => `All nodes or elements must carry strictly identical values.`,
      d2: (t) => `Every element must be stored in a flat contiguous array without pointers.`,
      d3: (t) => `Tree height must always equal zero.`,
    },
    {
      q: (t) => `Under what scenario would performance related to ${t} degrade towards worst-case bounds?`,
      correct: (t) => `When elements are inserted in skewed or unbalanced order without rebalancing.`,
      d1: (t) => `When the input size is smaller than the system word size.`,
      d2: (t) => `When accessed concurrently in read-only mode.`,
      d3: (t) => `When balanced structures like AVL trees are introduced.`,
    },
    {
      q: (t) => `Why is understanding ${t} essential for mastery of this topic at ${levelName} level?`,
      correct: (t) => `It provides the conceptual foundation for optimizing searches and modifications.`,
      d1: (t) => `It eliminates the requirement of writing code for data structures.`,
      d2: (t) => `It converts all data types into primitive integer scalars automatically.`,
      d3: (t) => `It is only used for hardware graphics pipelines.`,
    },
  ]

  const questions = []
  for (let i = 0; i < 6; i++) {
    const term = keyTerms[i % Math.max(keyTerms.length, 1)] || 'the algorithm'
    const tpl = templates[i % templates.length]

    const qText = tpl.q(term)
    const correctOpt = tpl.correct(term)
    const optionsPool = [correctOpt, tpl.d1(term), tpl.d2(term), tpl.d3(term)]

    // Rotate options so correct answer isn't always Option A
    const targetSlot = (i + 1) % 4
    const finalOptions = [...optionsPool]
    const temp = finalOptions[0]
    finalOptions[0] = finalOptions[targetSlot]
    finalOptions[targetSlot] = temp

    questions.push({
      question: qText,
      options: finalOptions,
      correctAnswer: correctOpt,
    })
  }
  return questions
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
    `4. Options Quality: Keep options concise, distinct, and meaningful. Do NOT quote verbatim whole sentences from the text as options.\n` +
    `5. Verbatim Correct Answer: The "correctAnswer" field must exactly match one of the 4 items in "options".\n` +
    `6. Return exactly 6 questions.\n\n` +
    `Return ONLY a JSON object formatted as:\n` +
    `{\n` +
    `  "questions": [\n` +
    `    {\n` +
    `      "question": "Question text?",\n` +
    `      "options": ["Option A", "Option B", "Option C", "Option D"],\n` +
    `      "correctAnswer": "Option A"\n` +
    `    }\n` +
    `  ]\n` +
    `}`

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ]

  try {
    const rawContent = await callLLMProvider(messages)
    return parseAndValidateQuestions(rawContent)
  } catch (providerError) {
    console.warn('[quizService] AI provider failed, using derived fallback questions:', providerError.message)
    return generateFallbackQuestions(explanation, levelInfo.name)
  }
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
    question: q.question,
    options: q.options,
    correctAnswer: q.correctAnswer,
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
 * QuizState contains ONLY: studentUsername, subject, pendingQuizSetIds, skipCount.
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

/**
 * 4. recordQuizSkip(studentUsername, subject, quizSetId)
 * Marks QuizSet as skipped, clears pendingQuizSetIds, and increments skipCount.
 */
export async function recordQuizSkip(studentUsername, subject, quizSetId) {
  const state = await getQuizState(studentUsername, subject)

  if (quizSetId) {
    const targetIdStr = quizSetId?._id ? quizSetId._id.toString() : quizSetId.toString()
    await QuizSet.updateOne({ _id: targetIdStr }, { status: 'skipped' })
  }

  // Clear pendingQuizSetIds so quizzes are not stacked or carried over
  state.pendingQuizSetIds = []
  state.skipCount = (state.skipCount || 0) + 1
  await state.save()

  console.log(`[QUIZ SKIP] student=${studentUsername} subject=${subject} skipCount=${state.skipCount} quiz dismissed, pending cleared`)
  return state
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
export async function buildQuiz(studentUsername, subject, currentQuizSetId = null) {
  if (!currentQuizSetId) {
    return {
      quizSetIds: [],
      questions: [],
      total: 0,
    }
  }

  const currIdStr = currentQuizSetId?._id ? currentQuizSetId._id.toString() : currentQuizSetId.toString()
  const quizSet = await QuizSet.findById(currIdStr)

  if (!quizSet) {
    return {
      quizSetIds: [],
      questions: [],
      total: 0,
    }
  }

  const questionsToPresent = (quizSet.questions || []).map((q) => ({
    question_id: q.question_id,
    question: q.question,
    options: q.options,
  }))

  return {
    quizSetIds: [quizSet._id.toString()],
    questions: questionsToPresent,
    total: questionsToPresent.length,
  }
}


/**
 * 9. completeQuiz({ studentUsername, subject, quizSetIds, answers, conversationId })
 * Authoritatively scores questions:
 * - Scores only against the included QuizSets.
 * - Marks included QuizSets as completed.
 * - Removes those QuizSet IDs from pendingQuizSetIds.
 * - Resets skipCount to 0.
 * - Saves QuizAttempt.
 * - Never asks those completed QuizSets again.
 */
export async function completeQuiz({
  studentUsername,
  subject,
  quizSetIds = [],
  answers = [],
  conversationId = null,
}) {
  if (!Array.isArray(quizSetIds) || quizSetIds.length === 0) {
    throw new Error('quizSetIds array is required for completeQuiz.')
  }

  // Load ONLY the included QuizSets
  const quizSets = await QuizSet.find({
    _id: { $in: quizSetIds },
  })

  // Build authoritative question list
  const allKnownQuestions = []
  for (const qs of quizSets) {
    for (const q of qs.questions) {
      allKnownQuestions.push({
        question_id: q.question_id,
        question: q.question,
        options: q.options,
        correctAnswer: q.correctAnswer,
      })
    }
  }

  // Map user answers by question_id or questionIndex
  const answerMap = new Map()
  if (Array.isArray(answers)) {
    for (const ans of answers) {
      if (ans.question_id) {
        answerMap.set(ans.question_id, ans.selectedAnswer)
      } else if (typeof ans.questionIndex === 'number' && allKnownQuestions[ans.questionIndex]) {
        answerMap.set(allKnownQuestions[ans.questionIndex].question_id, ans.selectedAnswer)
      }
    }
  }

  let score = 0
  const total = allKnownQuestions.length
  const answeredDetails = []

  for (let idx = 0; idx < allKnownQuestions.length; idx++) {
    const qObj = allKnownQuestions[idx]
    const selected = answerMap.get(qObj.question_id) || ''
    const isCorrect = String(selected).trim() === String(qObj.correctAnswer).trim()

    if (isCorrect) {
      score += 1
    }

    answeredDetails.push({
      questionIndex: idx,
      selectedAnswer: selected,
    })
  }

  // 1. Mark ONLY the included QuizSets as completed
  for (const qs of quizSets) {
    qs.status = 'completed'
    await qs.save()
  }

  // 2. Update QuizState: remove included QuizSet IDs and reset skipCount to 0
  const state = await getQuizState(studentUsername, subject)
  const completedIds = quizSets.map((qs) => qs._id.toString())

  state.pendingQuizSetIds = (state.pendingQuizSetIds || []).filter(
    (id) => !completedIds.includes(id.toString())
  )
  state.skipCount = 0
  await state.save()

  // 3. Save QuizAttempt
  const attempt = await QuizAttempt.create({
    studentUsername,
    subject,
    conversationId: conversationId ? String(conversationId) : null,
    quizSetIds: quizSets.map((qs) => qs._id),
    questions: allKnownQuestions.map((q) => ({
      question: q.question,
      options: q.options,
      correctAnswer: q.correctAnswer,
    })),
    answers: answeredDetails,
    score,
    total,
    completedAt: new Date(),
  })

  // 4. Learner Model: Evaluate topic mastery (> 50% score)
  const percentage = total > 0 ? (score / total) * 100 : 0
  const masteredTopics = []

  if (percentage > 50) {
    for (const qs of quizSets) {
      const topicToRecord = qs.topic || qs.query || ''
      if (topicToRecord) {
        const masteryDoc = await recordTopicMastery({
          studentUsername,
          subject,
          topic: topicToRecord,
          score,
          total,
        })
        if (masteryDoc) {
          masteredTopics.push(masteryDoc.topic)
        }
      }
    }
  }

  console.log(
    `[QUIZ COMPLETED]\n` +
    `  student=${studentUsername} subject=${subject}\n` +
    `  score=${score}/${total} (${percentage.toFixed(1)}%)\n` +
    `  masteredTopics=${masteredTopics.join(', ') || 'none'}\n` +
    `  completedQuizSets=${quizSets.length}\n` +
    `  remainingPending=${state.pendingQuizSetIds.length}\n` +
    `  skipCountReset=0`
  )

  return {
    success: true,
    attempt,
    score,
    total,
    correctCount: score,
    percentage,
    mastered: percentage > 50,
    masteredTopics,
  }
}

/**
 * 10. recordTopicMastery({ studentUsername, subject, topic, score, total })
 * Records permanent mastery of a topic in MongoDB once the student passes (> 50%).
 */
export async function recordTopicMastery({ studentUsername, subject, topic, score, total }) {
  if (!topic || !studentUsername || !subject) return null
  const normalizedTopic = normalizeTopicName(topic)
  if (!normalizedTopic) return null

  const existing = await TopicMastery.findOne({
    studentUsername,
    subject,
    normalizedTopic,
  })

  if (existing) {
    if (score > existing.bestScore) {
      existing.bestScore = score
      existing.total = total
    }
    existing.lastAssessedAt = new Date()
    await existing.save()
    return existing
  }

  const created = await TopicMastery.create({
    studentUsername,
    subject,
    topic: topic.trim(),
    normalizedTopic,
    mastered: true,
    bestScore: score,
    total,
    firstMasteredAt: new Date(),
    lastAssessedAt: new Date(),
  })

  console.log(`[LEARNER MODEL] Student ${studentUsername} mastered topic "${topic}" (${normalizedTopic}) score=${score}/${total}`)
  return created
}

/**
 * 11. getMasteredTopics(studentUsername, subject)
 * Retrieves list of all permanently mastered topics for a student in a subject.
 */
export async function getMasteredTopics(studentUsername, subject) {
  if (!studentUsername || !subject) return []
  const records = await TopicMastery.find({
    studentUsername,
    subject,
    mastered: true,
  }).lean()

  return records.map((r) => r.topic)
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
}

