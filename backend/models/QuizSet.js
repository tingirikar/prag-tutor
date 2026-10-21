import { randomUUID } from 'node:crypto'
import mongoose from 'mongoose'

const questionSchema = new mongoose.Schema({
  question_id: {
    type: String,
    default: () => randomUUID(),
  },
  topic: {
    type: String,
    default: '',
  },
  question: {
    type: String,
    required: true,
  },
  options: {
    type: [String],
    required: true,
    validate: {
      validator: (options) => Array.isArray(options) && options.length === 4,
      message: 'options must contain exactly 4 Strings.',
    },
  },
  correctAnswer: {
    type: String,
    required: true,
    validate: {
      validator: function (val) {
        return Array.isArray(this.options) && this.options.includes(val)
      },
      message: 'correctAnswer must represent one of the four option values.',
    },
  },
  distractorMisconceptions: {
    type: mongoose.Schema.Types.Mixed,
    default: () => ({}),
  },
  difficulty: {
    type: String,
    enum: ['beginner', 'intermediate', 'expert'],
    default: 'intermediate',
  },
}, { _id: false })

const quizSetSchema = new mongoose.Schema({
  studentUsername: {
    type: String,
    required: true,
    index: true,
  },
  subject: {
    type: String,
    required: true,
    index: true,
  },
  conversationId: {
    type: String,
    required: true,
    index: true,
  },
  query: {
    type: String,
    required: true,
  },
  explanation: {
    type: String,
    required: true,
  },
  level: {
    type: String,
    default: 'beginner',
  },
  topic: {
    type: String,
    default: '',
  },
  questions: {
    type: [questionSchema],
    required: true,
    validate: {
      validator: (questions) => Array.isArray(questions) && (questions.length === 6 || questions.length === 3),
      message: 'questions must contain 6 question objects.',
    },
  },
  status: {
    type: String,
    enum: ['pending', 'completed', 'skipped'],
    default: 'pending',
    index: true,
  },
}, { timestamps: true })

const QuizSet = mongoose.models.QuizSet || mongoose.model('QuizSet', quizSetSchema)

export default QuizSet
