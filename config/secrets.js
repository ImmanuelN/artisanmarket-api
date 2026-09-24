/**
 * Centralised access to secrets that must never fall back to a literal.
 *
 * A hardcoded fallback (e.g. `process.env.JWT_SECRET || 'fallback-secret'`)
 * turns a misconfiguration into an authentication bypass: if the variable is
 * unset, every token verifies against a constant that is public in the source
 * tree. See threat T3 in docs/threat-model.md.
 *
 * These helpers fail closed instead — a missing secret throws rather than
 * silently accepting forged credentials.
 */

/**
 * Read a required secret, throwing if it is absent or blank.
 * @param {string} name Environment variable name.
 * @returns {string} The secret value.
 */
export function requireSecret(name) {
  const value = process.env[name]
  if (!value || value.trim() === '') {
    throw new Error(
      `${name} is not set. Refusing to continue — a missing secret must fail closed, not fall back to a constant (threat T3).`
    )
  }
  return value
}

/**
 * The JWT signing/verification secret. Throws if JWT_SECRET is unset.
 * @returns {string}
 */
export function getJwtSecret() {
  return requireSecret('JWT_SECRET')
}

/**
 * Validate every secret the process cannot run safely without.
 * Called once at startup so misconfiguration surfaces immediately rather than
 * on the first authenticated request.
 * @param {string[]} names
 */
export function assertRequiredSecrets(names = ['JWT_SECRET']) {
  const missing = names.filter((n) => !process.env[n] || process.env[n].trim() === '')
  if (missing.length > 0) {
    console.error(`❌ Missing required secret(s): ${missing.join(', ')}`)
    console.error('   Refusing to start. Set them in the environment (never a source-level default).')
    process.exit(1)
  }
}
