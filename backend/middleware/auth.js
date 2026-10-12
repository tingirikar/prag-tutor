import { createHmac, timingSafeEqual } from 'node:crypto'
import User from '../models/User.js'

const tokenLifetimeSeconds = 8 * 60 * 60

function getTokenSecret() {
  return process.env.AUTH_SECRET || 'prag-tutor-development-secret'
}

function encode(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

function sign(value) {
  return createHmac('sha256', getTokenSecret()).update(value).digest('base64url')
}

export function createAuthToken(user) {
  const payload = encode({
    username: user.username,
    role: user.role,
    subject: user.subject || null,
    exp: Math.floor(Date.now() / 1000) + tokenLifetimeSeconds,
  })
  return `${payload}.${sign(payload)}`
}

function readToken(request) {
  const header = String(request.headers.authorization || '')
  if (header.startsWith('Bearer ')) return header.slice(7).trim()
  return String(request.query?.token || '').trim()
}

export async function requireAuth(request, response, next) {
  try {
    const token = readToken(request)
    const [payload, signature] = token.split('.')
    if (!payload || !signature) {
      return response.status(401).json({ error: 'Authentication is required.' })
    }

    const expected = sign(payload)
    const signaturesMatch = signature.length === expected.length
      && timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
    if (!signaturesMatch) {
      return response.status(401).json({ error: 'Invalid authentication token.' })
    }

    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    if (!claims.username || Number(claims.exp) <= Math.floor(Date.now() / 1000)) {
      return response.status(401).json({ error: 'Authentication token has expired.' })
    }

    const user = await User.findOne({ username: claims.username }).lean()
    if (!user) {
      return response.status(401).json({ error: 'Authenticated user was not found.' })
    }

    request.user = user
    return next()
  } catch (error) {
    return response.status(401).json({ error: 'Invalid authentication token.' })
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
