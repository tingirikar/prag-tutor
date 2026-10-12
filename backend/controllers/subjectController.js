import Subject from '../models/Subject.js'
import { isMongoReady } from '../config/db.js'

export async function getSubjects(request, response) {
  try {
    if (isMongoReady()) {
      let filter = {}
      if (request.user?.role === 'student' && Array.isArray(request.user.enrolled) && request.user.enrolled.length > 0) {
        filter = { code: { $in: request.user.enrolled.map((s) => String(s).toUpperCase()) } }
      } else if (request.user?.role === 'teacher' && request.user.subject) {
        filter = { code: String(request.user.subject).toUpperCase() }
      }
      const subjects = await Subject.find(filter).lean()
      return response.json({ subjects: subjects || [] })
    }
    return response.status(503).json({ error: 'Database is unavailable.' })
  } catch (err) {
    return response.status(500).json({ error: err.message })
  }
}
