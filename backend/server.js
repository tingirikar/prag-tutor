import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import cors from 'cors'
import helmet from 'helmet'
import express from 'express'
import { connectDB, isMongoReady } from './config/db.js'
import { uploadDir } from './middleware/upload.js'
import { generalRateLimiter, authRateLimiter, queryRateLimiter } from './middleware/rateLimit.js'
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js'

import authRoutes from './routes/authRoutes.js'
import subjectRoutes from './routes/subjectRoutes.js'
import conversationRoutes from './routes/conversationRoutes.js'
import prerequisiteRoutes from './routes/prerequisiteRoutes.js'
import queryRoutes from './routes/queryRoutes.js'
import documentRoutes from './routes/documentRoutes.js'
import quizRoutes from './routes/quizRoutes.js'

// 1. Load environment variables (.env)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.resolve(__dirname, '..', '.env') })

// 2. Ensure uploads directory exists
await fs.mkdir(uploadDir, { recursive: true })

// 3. Connect to MongoDB (Atlas or local fallback)
await connectDB()

const app = express()
const port = Number(process.env.PORT || 5000)

// 4. Security Headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", 'data:', 'https:'],
    },
  },
  crossOriginEmbedderPolicy: false, // Allow for dev mode
}))

// 5. Global Middlewares
app.use(cors())
app.use(express.json())
app.use((err, _req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({ error: 'Invalid JSON request payload' })
  }
  next(err)
})

// 6. Rate Limiting
app.use('/api/auth', authRateLimiter)
app.use('/api/query', queryRateLimiter)
app.use(generalRateLimiter)

// 7. System Health Check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', mongo: isMongoReady() })
})

// 8. Mount Feature Routers
app.use('/api/auth', authRoutes)
app.use('/api/subjects', subjectRoutes)
app.use('/api/conversations', conversationRoutes)
app.use('/api/prerequisites', prerequisiteRoutes)
app.use('/api/quiz', quizRoutes)
app.use('/api', queryRoutes)
app.use('/api', documentRoutes)

// 9. Error Handling
app.use(notFoundHandler)
app.use(errorHandler)

// 10. Start Server
app.listen(port, () => {
  console.log(`Node API server listening on http://127.0.0.1:${port}`)
})
