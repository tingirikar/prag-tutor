import jwt from 'jsonwebtoken'
import User from '../models/User.js'

const tokenLifetimeSeconds = 8 * 60 * 60

function getTokenSecret() {
  const secret = process.env.AUTH_SECRET
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('AUTH_SECRET environment variable is required in production')
    }
    console.warn('[WARNING] Using development AUTH_SECRET. Set AUTH_SECRET in production!')
    return 'prag-tutor-development-secret'
  }
  return secret
}

export function createAuthToken(user) {
  const payload = {
    username: user.username,
    role: user.role,
    subject: user.subject || null,
  }
  return jwt.sign(payload, getTokenSecret(), {
    expiresIn: `${tokenLifetimeSeconds}s`,
  })
}

function readToken(request) {
  const header = String(request.headers.authorization || '')
  if (header.startsWith('Bearer ')) return header.slice(7).trim()
  return String(request.query?.token || '').trim()
}

export async function requireAuth(request, response, next) {
  try {
    const token = readToken(request)
    if (!token) {
      return response.status(401).json({ error: 'Authentication is required.' })
    }

    const claims = jwt.verify(token, getTokenSecret())
    if (!claims.username) {
      return response.status(401).json({ error: 'Invalid authentication token.' })
    }

    const user = await User.findOne({ username: claims.username }).lean()
    if (!user) {
      return response.status(401).json({ error: 'Authenticated user was not found.' })
    }

    request.user = user
    return next()
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return response.status(401).json({ error: 'Authentication token has expired.' })
    }
    if (error.name === 'JsonWebTokenError') {
      return response.status(401).json({ error: 'Invalid authentication token.' })
    }
    return response.status(401).json({ error: 'Authentication failed.' })
  }
}

export function requireRole(...roles) {
  return (request, response, next) => {
    if (!request.user || !roles.includes(request.user.role)) {
      return response.status(403).json({ error: 'You are not authorized for this action.' })
    }
    return next()
  }
}
