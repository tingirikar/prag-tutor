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
    default: true,
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
    default: Date.now,
  },
  lastAssessedAt: {
    type: Date,
    default: Date.now,
  },
}, { timestamps: true })

// Unique compound index: a student can have at most one mastery record per topic per subject
topicMasterySchema.index({ studentUsername: 1, subject: 1, normalizedTopic: 1 }, { unique: true })

const TopicMastery = mongoose.models.TopicMastery || mongoose.model('TopicMastery', topicMasterySchema)

export default TopicMastery
