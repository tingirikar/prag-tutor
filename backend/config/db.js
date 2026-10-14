import mongoose from 'mongoose'
import { seedDatabase } from './seed.js'

let mongoReady = false

export function isMongoReady() {
  return mongoReady
}

export async function connectDB() {
  const configuredMongoUri = process.env.MONGODB_URI
  const localMongoUri = 'mongodb://127.0.0.1:27017/prag-tutor'

  if (configuredMongoUri) {
    try {
      const isAtlas = configuredMongoUri.includes('@')
      console.log(`Connecting to ${isAtlas ? 'configured MongoDB Atlas' : 'configured MongoDB'}...`)
      await mongoose.connect(configuredMongoUri, { serverSelectionTimeoutMS: 5000 })
      mongoReady = true
      console.log('MongoDB connected successfully to configured URI.')
      await seedDatabase()
      return true
    } catch (err) {
      console.warn(`Configured MongoDB connection notice: ${err.message}. Falling back to local MongoDB...`)
    }
  }

  if (!mongoReady) {
    try {
      console.log('Connecting to local MongoDB (127.0.0.1:27017)...')
      await mongoose.connect(localMongoUri, { serverSelectionTimeoutMS: 3000 })
      mongoReady = true
      console.log('MongoDB connected to local instance.')
      await seedDatabase()
      return true
    } catch (error) {
      console.warn(`Local MongoDB connection notice: ${error.message}`)
    }
  }

  return mongoReady
}
