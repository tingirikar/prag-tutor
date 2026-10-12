import mongoose from 'mongoose'

const subjectSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true }, // e.g. 'DSA', 'ML', 'CN'
  name: { type: String, required: true },
  description: { type: String, default: '' },
  teacherUsername: { type: String, default: '' },
}, { timestamps: true })

const Subject = mongoose.models.Subject || mongoose.model('Subject', subjectSchema)

export default Subject
