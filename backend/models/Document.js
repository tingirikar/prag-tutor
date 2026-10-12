import mongoose from 'mongoose'

const documentSchema = new mongoose.Schema({
  name: { type: String, required: true },
  subject: { type: String, required: true, index: true }, // e.g. 'DSA', 'ML', 'CN'
  size: { type: Number, required: true },
  contentHash: { type: String, default: null },
  uploadedAt: { type: Date, default: Date.now },
  indexedAt: { type: Date, default: null },
  imageCount: { type: Number, default: 0 },
  extractedImages: { type: Array, default: [] },
  processingError: { type: String, default: null },
  status: { type: String, default: 'Uploaded' },
}, { versionKey: false })

// Compound uniqueness: file name is unique within its subject, allowing different subjects to have files with the same name
documentSchema.index({ subject: 1, name: 1 }, { unique: true })

const Document = mongoose.models.Document || mongoose.model('Document', documentSchema)

export default Document
