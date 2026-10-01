/**
 * Test environment setup, loaded via jest.config.js `setupFiles` so it runs
 * before any module under test is imported.
 *
 * Several modules fail closed at import time by design — utils/encryption.js
 * calls process.exit(1) without a valid BANK_ENCRYPTION_KEY, and
 * config/secrets.js does the same for JWT_SECRET. That behaviour is correct
 * and is itself the remediation for threat T3, so the tests supply ephemeral
 * values rather than weakening the checks.
 *
 * These values are generated per run, used only in-process, and never leave it.
 */
import crypto from 'node:crypto'

process.env.NODE_ENV = 'test'

// encryption.js requires exactly 64 hex characters (32 bytes).
process.env.BANK_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex')

// secrets.js requires a non-empty value.
process.env.JWT_SECRET = `test-only-${crypto.randomUUID()}`
process.env.JWT_EXPIRE = '1h'

// Left unset on purpose: the code paths that depend on these degrade
// gracefully, and exercising that degradation is part of what the tests cover.
delete process.env.REDIS_URL
delete process.env.STRIPE_SECRET_KEY
