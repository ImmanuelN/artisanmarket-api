/**
 * Input sanitisation for values that reach MongoDB queries.
 *
 * Express parses `?status[$ne]=x` into an *object*, not a string. Assigning
 * that object straight into a Mongoose filter lets a caller inject query
 * operators — `$ne`, `$gt`, `$regex`, `$where` — and change what the query
 * matches. On a login route that is an authentication bypass.
 *
 * See threat T1 in docs/threat-model.md, and the `jssecurity:S5147` /
 * `jssecurity:S2631` entries in docs/evidence/finding-ledger.md.
 */

/**
 * Coerce a request value to a plain string, or undefined.
 *
 * Objects and arrays return undefined rather than being stringified, so an
 * injected operator becomes "absent filter" instead of "[object Object]" — the
 * query silently ignores it rather than matching on nonsense.
 *
 * @param {unknown} value
 * @returns {string|undefined}
 */
export function asString(value) {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return undefined
}

/**
 * Coerce to a string and constrain it to a known set of allowed values.
 * Anything outside the set returns undefined, so an unexpected value cannot
 * reach the query at all.
 *
 * @param {unknown} value
 * @param {string[]} allowed
 * @returns {string|undefined}
 */
export function asEnum(value, allowed) {
  const s = asString(value)
  return s !== undefined && allowed.includes(s) ? s : undefined
}

/**
 * Parse a positive integer from a request value, with bounds.
 * Guards pagination against NaN, negatives and absurd page sizes.
 *
 * @param {unknown} value
 * @param {{ fallback?: number, min?: number, max?: number }} [opts]
 * @returns {number}
 */
export function asPositiveInt(value, { fallback = 1, min = 1, max = 1000 } = {}) {
  const n = Number.parseInt(asString(value) ?? '', 10)
  if (!Number.isFinite(n)) return fallback
  return Math.min(Math.max(n, min), max)
}

/** Characters that carry meaning inside a regular expression. */
const REGEX_METACHARACTERS = /[.*+?^${}()|[\]\\]/g

/**
 * Maximum length of a user-supplied search term. A bound is the practical
 * defence against catastrophic backtracking: escaping removes operators, but a
 * very long literal can still be expensive to match.
 */
const MAX_SEARCH_LENGTH = 100

/**
 * Build a MongoDB `$regex` clause from user input safely.
 *
 * Escapes every metacharacter so the term is matched literally, and caps the
 * length. Returns undefined when there is nothing usable to search for, so the
 * caller can omit the clause entirely.
 *
 * @param {unknown} value
 * @returns {{ $regex: string, $options: string }|undefined}
 */
export function asSafeSearchRegex(value) {
  const s = asString(value)
  if (!s) return undefined
  const trimmed = s.trim().slice(0, MAX_SEARCH_LENGTH)
  if (trimmed.length === 0) return undefined
  return { $regex: trimmed.replace(REGEX_METACHARACTERS, '\\$&'), $options: 'i' }
}

/**
 * Pick only the named fields from a request body.
 *
 * Passing `req.body` wholesale into an update lets a caller set any field the
 * schema exposes — role, balance, verification status. An explicit allow-list
 * is the fix (`jssecurity:S4684`).
 *
 * @param {Record<string, unknown>} source
 * @param {string[]} allowed
 * @returns {Record<string, unknown>}
 */
export function pickFields(source, allowed) {
  if (!source || typeof source !== 'object') return {}
  const out = {}
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(source, key)) out[key] = source[key]
  }
  return out
}
