import mongoose from 'mongoose'
import bcrypt from 'bcrypt'

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  name: { type: String, required: true },
  role: { type: String, enum: ['student', 'teacher'], required: true },
  enrolled: { type: [String], default: [] },
  subject: { type: String, default: null }, // e.g. 'DSA', 'ML', 'CN'
}, { timestamps: true })

// Hash password before saving (Mongoose 8 async format)
userSchema.pre('save', async function() {
  if (!this.isModified('password')) return
  const salt = await bcrypt.genSalt(10)
  this.password = await bcrypt.hash(this.password, salt)
})

// Method to compare password
userSchema.methods.comparePassword = async function(candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password)
}

const User = mongoose.models.User || mongoose.model('User', userSchema)

export default User
