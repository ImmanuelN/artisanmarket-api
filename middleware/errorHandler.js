import crypto from 'node:crypto'
import { forLog } from '../utils/sanitize.js'

/**
 * Request fields that must never reach a log.
 *
 * Matched as lowercase substrings, not exact keys. An earlier version compared
 * whole keys against a camelCase list, so `cardNumber` lowercased to
 * `cardnumber` and never matched — card and account numbers were logged in
 * full. Substring matching also covers the variants a codebase accumulates:
 * accessToken, refresh_token, apiSecret.
 */
const REDACTED_HEADER_MARKERS = ['authorization', 'cookie', 'api-key', 'signature', 'token']
const REDACTED_BODY_MARKERS = [
  'password', 'passwd', 'token', 'secret', 'accountnumber',
  'cvv', 'cardnumber', 'pin', 'ssn', 'routingnumber'
]

/** Copy an object, replacing any key matching a sensitive marker. */
const redact = (source, markers) => {
  if (!source || typeof source !== 'object') return source
  const out = {}
  for (const [k, v] of Object.entries(source)) {
    const key = k.toLowerCase()
    out[k] = markers.some((marker) => key.includes(marker)) ? '[REDACTED]' : v
  }
  return out
}

// Error handling middleware
export const errorHandler = (err, req, res, next) => {
  // randomUUID, not Math.random: a correlation id that a caller can predict is
  // one they can also collide with, making logs harder to trust (S2245).
  const reqId = crypto.randomUUID()

  // Every interpolated request value is passed through forLog first. Raw values
  // let a caller put CR/LF in a path or header and forge whole log lines
  // (jssecurity:S5145).
  console.error(`💥 [${reqId}] Error in ${forLog(req.method)} ${forLog(req.path)}:`)
  console.error(`💥 [${reqId}] Error name: ${forLog(err.name)}`)
  console.error(`💥 [${reqId}] Error message: ${forLog(err.message)}`)
  console.error(`💥 [${reqId}] Stack trace:`, err.stack)

  // Headers and body are redacted before logging: these previously wrote the
  // Authorization header and raw request bodies -- including passwords and card
  // details -- straight to the log.
  console.error(`💥 [${reqId}] Request headers:`, forLog(redact(req.headers, REDACTED_HEADER_MARKERS)))
  console.error(`💥 [${reqId}] Request body:`, forLog(redact(req.body, REDACTED_BODY_MARKERS)))

  // Default error
  let error = { ...err }
  error.message = err.message

  // Mongoose bad ObjectId
  if (err.name === 'CastError') {
    const message = 'Resource not found'
    error = { message, statusCode: 404 }
    console.error(`💥 [${reqId}] Mongoose CastError: Invalid ObjectId`)
  }

  // Mongoose duplicate key
  if (err.code === 11000) {
    const message = 'Duplicate field value entered'
    error = { message, statusCode: 400 }
    console.error(`💥 [${reqId}] MongoDB duplicate key error`)
  }

  // Mongoose validation error
  if (err.name === 'ValidationError') {
    const message = Object.values(err.errors).map(val => val.message).join(', ')
    error = { message, statusCode: 400 }
    console.error(`💥 [${reqId}] Mongoose validation error: ${message}`)
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    const message = 'Invalid token'
    error = { message, statusCode: 401 }
    console.error(`💥 [${reqId}] JWT error: Invalid token`)
  }

  if (err.name === 'TokenExpiredError') {
    const message = 'Token expired'
    error = { message, statusCode: 401 }
    console.error(`💥 [${reqId}] JWT error: Token expired`)
  }

  // Handle timeout errors
  if (err.code === 'ETIMEDOUT' || err.code === 'ECONNRESET') {
    const message = 'Request timeout'
    error = { message, statusCode: 408 }
    console.error(`💥 [${reqId}] Connection timeout error`)
  }

  // Handle CORS errors
  if (err.message && err.message.includes('CORS')) {
    const message = 'CORS policy violation'
    error = { message, statusCode: 403 }
    console.error(`💥 [${reqId}] CORS error`)
  }

  const statusCode = error.statusCode || 500
  const message = error.message || 'Internal Server Error'

  console.error(`💥 [${reqId}] Responding with ${statusCode}: ${message}`)

  // Make sure we don't send response twice
  if (!res.headersSent) {
    res.status(statusCode).json({
      success: false,
      message: message,
      ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
    })
  } else {
    console.error(`💥 [${reqId}] Headers already sent - cannot send error response`)
  }
}

// Async error handler wrapper
export const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch((error) => {
    console.error('🔥 Async handler caught error:', error)
    next(error)
  })
}
