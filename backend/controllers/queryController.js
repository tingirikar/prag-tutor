import { randomUUID } from 'node:crypto'
import Conversation from '../models/Conversation.js'
import { isMongoReady } from '../config/db.js'
import { callPython } from '../services/pythonService.js'
import { isValidObjectId } from '../middleware/validation.js'
import { createQuizSet, getConversationQuizStatus, shouldForceQuiz } from '../services/quizService.js'

function isGenuineExplanation(result) {
  if (!result || typeof result !== 'object') return false
  if (result.error) return false
  const text = String(result.response || result.answer || '').trim()
  if (!text || text.length < 50) return false

  const fallbackIndicators = [
    'could not complete the tutor response',
    'no course documents have been uploaded',
    'no course documents for',
    'not covered in the available course material',
    'cannot answer this question based on the course materials',
    'sorry, but no course documents',
    'do not have access to',
    'please upload course documents',
    'fallback',
  ]

  const lower = text.toLowerCase()
  for (const phrase of fallbackIndicators) {
    if (lower.includes(phrase)) return false
  }

  return true
}

export async function handleQuery(request, response) {
  const query = String(request.body?.query || request.body?.question || '').trim()
  if (!query) return response.status(400).json({ error: 'Please enter a question.' })

  const subject = String(request.body?.subject || '').trim().toUpperCase()
  if (!subject) return response.status(400).json({ error: 'Subject is required.' })

  // Verify student enrollment isolation
  if (
    request.user?.role === 'student' &&
    Array.isArray(request.user.enrolled) &&
    request.user.enrolled.length > 0
  ) {
    const enrolledUpper = request.user.enrolled.map(s => String(s).trim().toUpperCase())
    if (!enrolledUpper.includes(subject)) {
      return response.status(403).json({
        error: `Forbidden: You are not enrolled in ${subject}.`,
      })
    }
  }

  const topic = request.body?.topic ? String(request.body.topic).trim() : null
  const studentUsername = String(request.user?.username || request.body?.studentUsername || 'student').trim()
  let conversationId = request.body?.conversationId

  // Quizzes are completely optional: students can ask questions and say no any number of times.

  try {
    // 1. Call Python RAG Backend
    const result = await callPython('/rag/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query,
        topic: topic || undefined,
        subject,
        level: request.body?.level || 'beginner',
        model: request.body?.model || 'openai/gpt-oss-20b',
        provider: request.body?.provider || 'groq',
        history: request.body?.history || [],
        include_image: request.body?.include_image !== undefined ? Boolean(request.body.include_image) : true,
        image_mode: request.body?.image_mode || 'notes',
      }),
      timeout: 180000, // 3 minute timeout for query processing
    })

    // 2. Persist to MongoDB conversation if available
    const conversationPersistence = isMongoReady()
    if (conversationPersistence) {
      let conversation = null
      if (conversationId) {
        if (!isValidObjectId(conversationId)) {
          return response.status(400).json({ error: 'Invalid conversation ID.' })
        }
        conversation = await Conversation.findOne({ _id: conversationId, studentUsername, subject })
      }
      if (!conversation) {
        const title = query.length > 38 ? `${query.slice(0, 38)}...` : query
        conversation = await Conversation.create({
          studentUsername,
          subject,
          title,
          messages: [],
          query_count: 0,
          queries: [],
          quiz_completed: false,
        })
        conversationId = conversation._id.toString()
      }

      const currentQueryNumber = (conversation.query_count || 0) + 1
      const queryId = randomUUID()

      const userMsg = {
        id: randomUUID(),
        role: 'user',
        content: query,
        createdAt: new Date()
      }
      const assistantMsg = {
        id: randomUUID(),
        role: 'assistant',
        content: result.response || result.answer || '',
        topic: result.topic || null,
        prerequisites: result.prerequisites || [],
        exploreNext: result.explore_next || [],
        rejected: Boolean(result.rejected),
        status: result.status || null,
        sources: result.sources || [],
        images: result.images || [],
        model: result.model || request.body?.model,
        provider: result.provider || request.body?.provider,
        level: request.body?.level || 'beginner',
        createdAt: new Date()
      }

      conversation.messages.push(userMsg, assistantMsg)
      conversation.query_count = currentQueryNumber

      // 3. Generate exactly 3 MCQs ONLY for a genuine successful tutor explanation
      let currentQuizSet = null
      const explanation = result.response || result.answer || ''
      const isGenuine = isGenuineExplanation(result)

      if (isGenuine) {
        try {
          const level = request.body?.level || 'beginner'
          currentQuizSet = await createQuizSet({
            studentUsername,
            subject,
            conversationId,
            query,
            explanation,
            level,
          })
        } catch (quizError) {
          console.warn('[QUIZ ERROR] Generation failed:', quizError.message)
        }
      } else {
        console.log('[QUIZ SKIPPED] Non-genuine or fallback RAG response — no QuizSet created')
      }

      // Add conceptual query record to the conversation
      if (!conversation.queries) conversation.queries = []
      conversation.queries.push({
        query_id: queryId,
        conversation_id: conversationId,
        query_number: currentQueryNumber,
        query_text: query,
        response: explanation,
        quiz_questions: currentQuizSet ? currentQuizSet.questions : [],
        createdAt: new Date(),
      })

      conversation.updatedAt = new Date()
      await conversation.save()

      // 4. Authoritative quiz presentation trigger check:
      let quiz = {
        available: false,
        compulsory: false,
        conversationId,
        quizSetId: null,
        quizSetIds: [],
        questions: [],
        total: 0,
        query_count: conversation.query_count,
      }

      if (isGenuine && currentQuizSet) {
        const quizStatus = await getConversationQuizStatus(studentUsername, subject, currentQuizSet)
        quiz = {
          available: quizStatus.compulsory || Boolean(currentQuizSet),
          compulsory: quizStatus.compulsory,
          conversationId,
          quizSetId: currentQuizSet._id.toString(),
          quizSetIds: quizStatus.quizSetIds,
          questions: quizStatus.questions,
          total: quizStatus.total,
          query_count: conversation.query_count,
        }
      }

      return response.json({
        ...result,
        conversationId,
        conversationPersistence,
        query_count: conversation.query_count,
        query_id: queryId,
        query_number: currentQueryNumber,
        quiz,
      })
    }

    return response.json({
      ...result,
      conversationId,
      conversationPersistence,
      query_count: 1,
      quiz: { available: false, compulsory: false }
    })
  } catch (error) {
    response.status(error.status || 503).json({ error: error.message })
  }
}

export async function getModels(_request, response) {
  try {
    const result = await callPython('/rag/models', { timeout: 10000 })
    return response.json(result)
  } catch (error) {
    return response.status(503).json({
      models: [
        { id: 'openai/gpt-oss-20b', name: 'GPT-OSS 20B (Default)' },
        { id: 'openai/gpt-oss-120b', name: 'GPT-OSS 120B' },
        { id: 'qwen/qwen3.8-27b', name: 'Qwen 3.8 27B' },
      ],
      default: 'openai/gpt-oss-20b',
      degraded: true,
      error: 'Python model service is unavailable.'
    })
  }
}

export async function handleQueryImages(request, response) {
  const query = String(request.body?.query || request.body?.question || '').trim()
  if (!query) return response.status(400).json({ error: 'Please enter a question.' })

  const conversationId = request.body?.conversationId
  const messageId = request.body?.messageId
  const studentUsername = String(request.user?.username || request.body?.studentUsername || 'student').trim()
  const subject = String(request.body?.subject || '').trim().toUpperCase()
  if (!subject) return response.status(400).json({ error: 'Subject is required.' })

  // Verify student enrollment isolation
  if (
    request.user?.role === 'student' &&
    Array.isArray(request.user.enrolled) &&
    request.user.enrolled.length > 0
  ) {
    const enrolledUpper = request.user.enrolled.map(s => String(s).trim().toUpperCase())
    if (!enrolledUpper.includes(subject)) {
      return response.status(403).json({
        error: `Forbidden: You are not enrolled in ${subject}.`,
      })
    }
  }

  try {
    const result = await callPython('/rag/images', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query,
        topic: request.body?.topic || '',
        mode: request.body?.mode || 'notes',
        subject,
      }),
      timeout: 120000, // 2 minute timeout for image loading
    })

    // Persist discovered diagrams back to MongoDB conversation so they never disappear on reload
    if (isMongoReady() && conversationId && Array.isArray(result.images) && result.images.length > 0) {
      try {
        if (!isValidObjectId(conversationId)) return response.status(400).json({ error: 'Invalid conversation ID.' })
        const conv = await Conversation.findOne({ _id: conversationId, studentUsername, subject })
        if (conv && Array.isArray(conv.messages)) {
          let updated = false
          for (let i = conv.messages.length - 1; i >= 0; i--) {
            const m = conv.messages[i]
            if (m.role === 'assistant' && (!messageId || m.id === messageId)) {
              m.images = result.images
              updated = true
              break
            }
          }
          if (updated) {
            conv.markModified('messages')
            await conv.save()
          }
        }
      } catch (err) {
        console.warn('[Notice] Could not attach diagrams to conversation:', err.message)
      }
    }

    return response.json(result)
  } catch (error) {
    response.status(error.status || 503).json({ error: error.message })
  }
}

export async function getSampleQuestions(request, response) {
  try {
    const seed = request.query.seed || randomUUID()
    const subject = String(request.query.subject || '').trim().toUpperCase()
    if (!subject) return response.status(400).json({ error: 'Subject is required.' })

    // Verify student enrollment isolation
    if (
      request.user?.role === 'student' &&
      Array.isArray(request.user.enrolled) &&
      request.user.enrolled.length > 0
    ) {
      const enrolledUpper = request.user.enrolled.map(s => String(s).trim().toUpperCase())
      if (!enrolledUpper.includes(subject)) {
        return response.status(403).json({
          error: `Forbidden: You are not enrolled in ${subject}.`,
        })
      }
    }

    const result = await callPython(`/rag/sample-questions?seed=${encodeURIComponent(seed)}&subject=${encodeURIComponent(subject)}`, {
      timeout: 60000, // 1 minute timeout for sample questions
    })
    response.json(result)
  } catch (error) {
    response.status(error.status || 503).json({ error: error.message })
  }
}
