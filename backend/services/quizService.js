import { randomUUID } from 'node:crypto'
import mongoose from 'mongoose'
import QuizAttempt from '../models/QuizAttempt.js'
import QuizSet from '../models/QuizSet.js'
import QuizState from '../models/QuizState.js'

/**
 * Clean helper to call the configured AI provider in the project.
 * Supports Groq Cloud API as primary with local Ollama as fallback.
 */
async function callLLMProvider(messages) {
  const groqApiKey = (process.env.GROQ_API_KEY || '').trim()
  const groqModel = process.env.GROQ_MODEL || 'openai/gpt-oss-20b'

  // Attempt 1: Groq Cloud API
  if (groqApiKey) {
    try {
      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${groqApiKey}`,
        },
        body: JSON.stringify({
          model: groqModel,
          messages,
          temperature: 0.2,
          response_format: { type: 'json_object' },
        }),
        signal: AbortSignal.timeout(15000),
      })

      if (response.ok) {
        const data = await response.json()
        const content = data.choices?.[0]?.message?.content
        if (content) return content
      } else {
        const errorText = await response.text().catch(() => '')
        console.error(`[quizService] Groq API returned ${response.status}: ${errorText}`)
      }
    } catch (err) {
      console.error('[quizService] Groq request error:', err.message)
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
        format: 'json',
      }),
      signal: AbortSignal.timeout(30000),
    })

    if (response.ok) {
      const data = await response.json()
      const content = data.message?.content
      if (content) return content
    }
  } catch (err) {
    console.error('[quizService] Ollama request error:', err.message)
  }

  throw new Error('AI provider unavailable. Please configure GROQ_API_KEY or ensure local Ollama is running.')
}

/**
 * Parses and validates raw LLM output into exactly 3 question objects.
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

  if (!Array.isArray(rawList) || rawList.length !== 3) {
    throw new Error(`Expected exactly 3 questions from AI provider, received ${rawList?.length || 0}.`)
  }

  return rawList.map((item, index) => {
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
 * Fallback MCQ generator: reliably generates 3 valid MCQs from explanation text
 * when external LLM providers are offline or rate-limited.
 */
function generateFallbackQuestions(explanation) {
  const clean = explanation.replace(/[#*`_\[\]()]/g, ' ').replace(/\s+/g, ' ').trim()
  const sentences = clean.split(/(?<=[.?!])\s+/).filter((s) => s.length >= 20 && s.length <= 250)

  const questions = []
  for (let i = 0; i < 3; i++) {
    const targetSentence = sentences[i % Math.max(sentences.length, 1)] || `Key algorithmic principle ${i + 1} described in the lesson.`
    const words = targetSentence.split(' ').filter((w) => w.length > 4)
    const keyWord = words[i % Math.max(words.length, 1)] || 'concept'

    const qText = `Based on the explanation, what is true regarding: "${targetSentence.slice(0, 70).trim()}${targetSentence.length > 70 ? '...' : ''}"?`
    const correctOpt = targetSentence.slice(0, 80).trim()
    const distractorB = `It does not apply to ${keyWord} under standard constraints.`
    const distractorC = `It produces an inverted outcome for ${keyWord}.`
    const distractorD = `It is purely decorative and not utilized in the curriculum.`

    // Rotate correct answer position across A, B, C, D so Option A is not always correct
    const optionsPool = [correctOpt, distractorB, distractorC, distractorD]
    const targetSlot = (i + 1) % 4 // Question 1 -> B, Question 2 -> C, Question 3 -> D
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
 * 1. generateQuizQuestions(explanation)
 * Generates exactly 3 single-correct MCQs based strictly on the supplied explanation.
 */
export async function generateQuizQuestions(explanation) {
  if (!explanation || typeof explanation !== 'string' || !explanation.trim()) {
    throw new Error('Valid explanation text is required to generate quiz questions.')
  }

  const systemPrompt =
    'You are an educational assessment expert for PRAG-TUTOR. ' +
    'Generate exactly 3 single-correct multiple-choice questions (MCQs) based SOLELY and STRICTLY on the provided explanation text. ' +
    'Do NOT use outside or general knowledge. Everything must be derived exclusively from the text. ' +
    'Output ONLY a valid JSON object with a "questions" array containing exactly 3 items.'

  const userPrompt =
    `Generate exactly 3 single-correct MCQs based ONLY on the following explanation:\n\n` +
    `---\n${explanation.trim()}\n---\n\n` +
    `Rules:\n` +
    `1. Questions must be derived strictly and exclusively from the text above.\n` +
    `2. Generate exactly 3 questions.\n` +
    `3. Each question must have exactly 4 distinct options.\n` +
    `4. Each question must have exactly one correct answer matching one of the options verbatim.\n\n` +
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
    return generateFallbackQuestions(explanation)
  }
}

/**
 * 2. createQuizSet({ studentUsername, subject, conversationId, query, explanation })
 * Generates exactly 3 MCQs and saves one QuizSet with initial status 'pending'.
 */
export async function createQuizSet({
  studentUsername,
  subject,
  conversationId,
  query,
  explanation,
}) {
  if (!conversationId) {
    throw new Error('conversationId is required for createQuizSet.')
  }

  const rawQuestions = await generateQuizQuestions(explanation)

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
    questions,
    status: 'pending',
  })

  console.log(`[QUIZ SET CREATED] id=${quizSet._id} student=${studentUsername} subject=${subject} questions=3`)
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
 * Adds the QuizSet ID to pendingQuizSetIds and increments skipCount.
 */
export async function recordQuizSkip(studentUsername, subject, quizSetId) {
  const state = await getQuizState(studentUsername, subject)

  if (quizSetId) {
    const targetIdStr = quizSetId?._id ? quizSetId._id.toString() : quizSetId.toString()
    const alreadyPending = (state.pendingQuizSetIds || []).some(
      (id) => id.toString() === targetIdStr
    )
    if (!alreadyPending) {
      state.pendingQuizSetIds.push(quizSetId)
    }
  }

  state.skipCount = (state.skipCount || 0) + 1
  await state.save()

  console.log(`[QUIZ SKIP] student=${studentUsername} subject=${subject} skipCount=${state.skipCount} pendingSets=${state.pendingQuizSetIds.length}`)
  return state
}

/**
 * 5. getPendingQuizSets(studentUsername, subject)
 * Retrieves active non-completed QuizSets for the student and subject.
 */
export async function getPendingQuizSets(studentUsername, subject) {
  const state = await getQuizState(studentUsername, subject)

  if (!state || !state.pendingQuizSetIds || state.pendingQuizSetIds.length === 0) {
    return []
  }

  const pendingDocs = await QuizSet.find({
    _id: { $in: state.pendingQuizSetIds },
    status: 'pending',
  }).sort({ createdAt: 1 })

  const pendingMap = new Map(pendingDocs.map((doc) => [doc._id.toString(), doc]))

  const validPendingSets = []
  const validPendingIds = []

  for (const id of state.pendingQuizSetIds) {
    const idStr = id.toString()
    const doc = pendingMap.get(idStr)
    if (doc && doc.status === 'pending') {
      validPendingSets.push(doc)
      validPendingIds.push(doc._id)
    }
  }

  // Sync if any were cleaned or already completed
  if (validPendingIds.length !== state.pendingQuizSetIds.length) {
    state.pendingQuizSetIds = validPendingIds
    await state.save()
  }

  return validPendingSets
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
 * Quizzes are strictly optional. Returns active questions without forcing compulsory state.
 */
export async function getConversationQuizStatus(studentUsername, subject, currentQuizSet = null) {
  const state = await getQuizState(studentUsername, subject)
  const compulsory = false

  const pendingSets = await getPendingQuizSets(studentUsername, subject)

  // In compulsory mode: combine pending QuizSets + current QuizSet
  const combinedSets = [...pendingSets]
  if (currentQuizSet) {
    const currentIdStr = currentQuizSet._id.toString()
    if (!combinedSets.some((qs) => qs._id.toString() === currentIdStr)) {
      combinedSets.push(currentQuizSet)
    }
  }

  let questionsToPresent = []
  let quizSetIds = []

  if (compulsory) {
    for (const qs of combinedSets) {
      quizSetIds.push(qs._id.toString())
      for (const q of qs.questions || []) {
        questionsToPresent.push({
          question_id: q.question_id,
          question: q.question,
          options: q.options,
        })
      }
    }
  } else if (currentQuizSet) {
    quizSetIds = [currentQuizSet._id.toString()]
  }

  const totalCalculated = compulsory
    ? questionsToPresent.length
    : (pendingSets.length + (currentQuizSet ? 1 : 0)) * 3

  console.log(
    `[QUIZ STATUS]\n` +
    `  student=${studentUsername} subject=${subject}\n` +
    `  skipCount=${state?.skipCount || 0}\n` +
    `  compulsory=${compulsory}\n` +
    `  pendingSets=${pendingSets.length}\n` +
    `  hasCurrentQuizSet=${Boolean(currentQuizSet)}\n` +
    `  totalQuestions=${totalCalculated}`
  )

  return {
    quizRequired: compulsory,
    compulsory,
    questions: questionsToPresent,
    quizSetIds,
    total: totalCalculated,
    pendingCount: pendingSets.length,
    skipCount: state?.skipCount || 0,
  }
}

/**
 * 8. buildQuiz(studentUsername, subject, currentQuizSetId)
 * Returns the combined quiz payload:
 * pendingQuizSetIds for the current student+subject + current QuizSet.
 */
export async function buildQuiz(studentUsername, subject, currentQuizSetId = null) {
  const state = await getQuizState(studentUsername, subject)

  const allSetIdStrings = new Set()
  if (state?.pendingQuizSetIds) {
    for (const id of state.pendingQuizSetIds) {
      allSetIdStrings.add(id.toString())
    }
  }
  if (currentQuizSetId) {
    const currIdStr = currentQuizSetId?._id ? currentQuizSetId._id.toString() : currentQuizSetId.toString()
    allSetIdStrings.add(currIdStr)
  }

  const quizSets = await QuizSet.find({
    _id: { $in: Array.from(allSetIdStrings) },
    status: 'pending',
  }).sort({ createdAt: 1 })

  const questionsToPresent = []
  for (const qs of quizSets) {
    for (const q of qs.questions || []) {
      questionsToPresent.push({
        question_id: q.question_id,
        question: q.question,
        options: q.options,
      })
    }
  }

  const finalSetIds = quizSets.map((qs) => qs._id.toString())

  return {
    quizSetIds: finalSetIds,
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

  console.log(
    `[QUIZ COMPLETED]\n` +
    `  student=${studentUsername} subject=${subject}\n` +
    `  score=${score}/${total}\n` +
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
  }
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
}

