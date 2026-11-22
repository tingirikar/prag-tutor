import mongoose from 'mongoose'

const quizStateSchema = new mongoose.Schema({
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
  pendingQuizSetIds: {
    type: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'QuizSet',
    }],
    default: [],
  },
  // One atomic reservation covers every quiz set in a submission, even on standalone MongoDB.
  claims: { type: Map, of: String, default: () => ({}) },
  skipCount: {
    type: Number,
    default: 0,
    min: 0,
  },
}, { timestamps: true })

quizStateSchema.index({ studentUsername: 1, subject: 1 }, { unique: true })

const QuizState = mongoose.models.QuizState || mongoose.model('QuizState', quizStateSchema)

export default QuizState
