import mongoose from 'mongoose'

/**
 * Normalizes a topic string for robust matching across slight variations,
 * plurals, punctuation, and language tags (e.g. "Binary Heaps" vs "Heap" vs "Pointers in C++").
 */
export function normalizeTopicName(topic) {
  if (!topic || typeof topic !== 'string') return ''
  return topic
    .toLowerCase()
    .replace(/\b(in\s+c\+\+|in\s+python|in\s+java|for\s+dsa)\b/gi, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/s\b/g, '') // remove plural trailing 's'
}

const misconceptionSchema = new mongoose.Schema({
  misconception: {
    type: String,
    required: true,
    trim: true,
  },
  distractorChosen: {
    type: String,
    default: '',
  },
  questionText: {
    type: String,
    default: '',
  },
  detectedAt: {
    type: Date,
    default: Date.now,
  },
  occurrences: {
    type: Number,
    default: 1,
    min: 1,
  },
  resolved: {
    type: Boolean,
    default: false,
  },
}, { _id: false })

const topicMasterySchema = new mongoose.Schema({
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
  topic: {
    type: String,
    required: true,
  },
  normalizedTopic: {
    type: String,
    required: true,
    index: true,
  },
  mastered: {
    type: Boolean,
    default: false,
  },
  bestScore: {
    type: Number,
    required: true,
    min: 0,
  },
  total: {
    type: Number,
    required: true,
    min: 1,
  },
  firstMasteredAt: {
    type: Date,
    default: null,
  },
  lastAssessedAt: {
    type: Date,
    default: Date.now,
  },
  // Bayesian Knowledge Tracing (BKT)
  pKnown: {
    type: Number,
    default: 0.20,
    min: 0,
    max: 1,
  },
  pLearn: {
    type: Number,
    default: 0.15,
    min: 0,
    max: 1,
  },
  pGuess: {
    type: Number,
    default: 0.25,
    min: 0,
    max: 1,
  },
  pSlip: {
    type: Number,
    default: 0.10,
    min: 0,
    max: 1,
  },
  attemptsCount: {
    type: Number,
    default: 0,
    min: 0,
  },
  questionsAnswered: {
    type: Number,
    default: 0,
    min: 0,
  },
  // Ebbinghaus Memory Decay
  memoryStability: {
    type: Number,
    default: 7.0,
    min: 0.5,
  },
  reviewStreak: {
    type: Number,
    default: 0,
    min: 0,
  },
  effectiveMastery: {
    type: Number,
    default: 0.20,
    min: 0,
    max: 1,
  },
  needsRefresher: {
    type: Boolean,
    default: false,
  },
  // Distractor Misconception Tracking
  activeMisconceptions: {
    type: [misconceptionSchema],
    default: [],
  },
}, { timestamps: true })

// Unique compound index: a student can have at most one mastery record per topic per subject
topicMasterySchema.index({ studentUsername: 1, subject: 1, normalizedTopic: 1 }, { unique: true })

const TopicMastery = mongoose.models.TopicMastery || mongoose.model('TopicMastery', topicMasterySchema)

export default TopicMastery
