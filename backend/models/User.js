import mongoose from 'mongoose'

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  name: { type: String, required: true },
  role: { type: String, enum: ['student', 'teacher'], required: true },
  enrolled: { type: [String], default: [] },
  subject: { type: String, default: null }, // e.g. 'DSA', 'ML', 'CN'
}, { timestamps: true })

const User = mongoose.models.User || mongoose.model('User', userSchema)

export default User
