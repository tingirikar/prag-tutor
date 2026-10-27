/**
 * Centralized error handling middleware
 * Sanitizes error messages before sending to clients
 * Logs detailed errors server-side
 */

export function errorHandler(err, req, res, next) {
  // Log full error for debugging (should use proper logging library in production)
  if (process.env.NODE_ENV !== 'production') {
    console.error('[ERROR]', err)
  }

  // Don't leak stack traces or sensitive information to clients
  const isDevelopment = process.env.NODE_ENV !== 'production'

  // Handle specific error types
  if (err.name === 'ValidationError') {
    return res.status(400).json({
      error: 'Validation error',
      details: isDevelopment ? err.message : 'Invalid input data'
    })
  }

  if (err.name === 'CastError') {
    return res.status(400).json({
      error: 'Invalid ID format'
    })
  }

  if (err.name === 'MongoError' && err.code === 11000) {
    return res.status(409).json({
      error: 'Duplicate entry'
    })
  }

  // Default error response
  const statusCode = err.statusCode || err.status || 500
  const message = isDevelopment ? err.message : 'An error occurred while processing your request'

  res.status(statusCode).json({
    error: message
  })
}

export function notFoundHandler(req, res) {
  res.status(404).json({
    error: 'Endpoint not found'
  })
}
