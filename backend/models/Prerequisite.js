import mongoose from 'mongoose'

const prerequisiteDetailSchema = new mongoose.Schema({
  topic: { type: String, required: true },
  weight: { type: Number, default: 0.8 },
  reason: { type: String, default: '' },
}, { _id: false })

const prerequisiteSchema = new mongoose.Schema({
  subject: { type: String, required: true, index: true },
  topic: { type: String, required: true },
  prerequisites: { type: [String], default: [] },
  prerequisiteDetails: { type: [prerequisiteDetailSchema], default: [] },
  firstSeenOrder: { type: Number, default: 0 },
  isCustom: { type: Boolean, default: false },        // needed because, when a document is deleted, that prerequisite should also be deleted
  document: { type: String, default: 'Manual' },
  createdBy: { type: String, default: 'system' },
}, { timestamps: true })

// Compound uniqueness: each topic is strictly unique within its subject
prerequisiteSchema.index({ subject: 1, topic: 1 }, { unique: true })

const Prerequisite = mongoose.models.Prerequisite || mongoose.model('Prerequisite', prerequisiteSchema)

export default Prerequisite

