import Conversation from '../models/Conversation.js'
import { getConversationQuizStatus, publicQuestions } from '../services/quizService.js'
import { isMongoReady } from '../config/db.js'
import { isValidObjectId } from '../middleware/validation.js'

function getStudentUsername(request) {
  return String(
    request.user?.username
      || request.query?.studentUsername
      || request.body?.studentUsername
      || request.headers['x-user']
      || 'student'
  ).trim()
}

export async function getConversations(request, response) {
  try {
    if (!isMongoReady()) {
      return response.status(503).json({
        error: 'Database is unavailable. Conversations could not be loaded.'
      })
    }

    const studentUsername = getStudentUsername(request)
    const subject = String(request.query.subject || '').trim()
    const filter = { studentUsername }

    if (subject) {
      if (
        request.user?.role === 'student' &&
        Array.isArray(request.user.enrolled) &&
        request.user.enrolled.length > 0
      ) {
        const enrolledUpper = request.user.enrolled.map(s => String(s).trim().toUpperCase())
        if (!enrolledUpper.includes(subject.toUpperCase())) {
          return response.status(403).json({ error: `Forbidden: You are not enrolled in ${subject}.` })
        }
      }
      filter.subject = subject
    }

    const conversations = await Conversation.find(filter)
      .select('_id title subject studentUsername updatedAt createdAt')
      .sort({ updatedAt: -1 })
      .lean()

      return response.json({ conversations })
  }
    catch (err) {
      return response.status(500).json({ error: err.message })
  }
}

export async function getConversationById(request, response) {
  try {
    if (!isMongoReady()) {
      return response.status(503).json({
        error: 'Database is unavailable. Conversation could not be loaded.'
      })
    }

    if (!isValidObjectId(request.params.id)) {
      return response.status(400).json({ error: 'Invalid conversation ID.' })
    }

    const conversation = await Conversation.findOne({
      _id: request.params.id,
      studentUsername: getStudentUsername(request),
    }).lean()

    if (!conversation) {
      return response.status(404).json({ error: 'Conversation not found.' })
    }

    if (
      request.user?.role === 'student' &&
      Array.isArray(request.user.enrolled) &&
      request.user.enrolled.length > 0 &&
      conversation.subject
    ) {
      const enrolledUpper = request.user.enrolled.map(s => String(s).trim().toUpperCase())
      if (!enrolledUpper.includes(conversation.subject.toUpperCase())) {
        return response.status(403).json({ error: `Forbidden: You are not enrolled in ${conversation.subject}.` })
      }
    }

    const quizStatus = await getConversationQuizStatus(
      conversation.studentUsername,
      conversation.subject
    )

    return response.json({
      conversation: {
        _id: conversation._id,
        title: conversation.title,
        studentUsername: conversation.studentUsername,
        subject: conversation.subject,
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
        messages: conversation.messages,
        quiz_completed: conversation.quiz_completed,
        queries: (conversation.queries || []).map(q => ({
          _id: q._id, query_id: q.query_id, conversation_id: q.conversation_id,
          query_number: q.query_number, query_text: q.query_text, response: q.response,
          createdAt: q.createdAt, quiz_questions: publicQuestions(q.quiz_questions),
        })),
        query_count: conversation.query_count || 0,
        skip_count: quizStatus.skipCount,
        quiz_required: quizStatus.quizRequired,
        quiz_status: {
          available: quizStatus.quizRequired,
          compulsory: quizStatus.compulsory,
          questions: quizStatus.questions,
          quizSetIds: quizStatus.quizSetIds,
          total: quizStatus.total,
          query_count: conversation.query_count || 0,
        },
      }
    })
  }
  catch (err) {
    return response.status(500).json({ error: err.message })
  }
}

export async function deleteConversation(request, response) {
  try {
    if (!isMongoReady()) {
      return response.status(503).json({
        error: 'Database is unavailable. Conversation was not deleted.'
      })
    }

    if (!isValidObjectId(request.params.id)) {
      return response.status(400).json({ error: 'Invalid conversation ID.' })
    }

    const deleted = await Conversation.findOneAndDelete({
      _id: request.params.id,
      studentUsername: getStudentUsername(request),
    })

    if (!deleted) {
      return response.status(404).json({
        error: 'Conversation not found.'
      })
    }

    return response.json({
      success: true,
      id: request.params.id
    })
  }
  catch (err) {
    return response.status(500).json({ error: err.message })
  }
}
