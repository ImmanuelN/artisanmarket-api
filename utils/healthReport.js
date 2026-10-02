/**
 * Formatting for the health-monitor output.
 *
 * This logic lived inline in `monitor-server.js`, which cannot be imported by a
 * test: that file calls `setInterval` and registers signal handlers at module
 * scope, so loading it starts the monitor. That is precisely why its four
 * `jssecurity:S5145` log-injection sites survived a codebase-wide sweep of
 * `forLog` — the file was unreachable from the test suite, so nothing ever
 * looked at it.
 *
 * Keeping the formatting here, as pure functions over a plain object, makes the
 * sanitisation assertable. `monitor-server.js` is reduced to transport.
 */
import { forLog } from './sanitize.js'

/** Above this many megabytes resident, the monitor warns. */
export const MEMORY_WARN_MB = 300

/** The only database status the monitor treats as healthy. */
export const HEALTHY_DB_STATUS = 'connected'

/** Shown when the monitored service omits a field, or sends a non-value. */
const UNKNOWN = 'unknown'

/**
 * Render an uptime in seconds as `{m}m {s}s`.
 *
 * Returns `unknown` rather than `NaNm NaNs` when the field is missing or not a
 * number, so a malformed response degrades to a readable line.
 *
 * @param {unknown} seconds
 * @returns {string}
 */
export function formatUptime(seconds) {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) {
    return UNKNOWN
  }
  return `${Math.floor(seconds / 60)}m ${Math.floor(seconds % 60)}s`
}

/**
 * Build the detailed health-check lines.
 *
 * Every interpolated value passes through `forLog`, because the health payload
 * comes from the monitored service rather than from this process. A CR or LF in
 * any field would otherwise forge whole log lines and could hide a real failure
 * in the one place whose job is to report failures.
 *
 * @param {Record<string, unknown>} [health]
 * @returns {string[]}
 */
export function formatHealthLines(health) {
  const h = health ?? {}
  return [
    '📊 Detailed health check:',
    `   Uptime: ${forLog(formatUptime(h.uptime))}`,
    `   Memory: ${forLog(h.memory?.used || UNKNOWN)}MB used`,
    `   Database: ${forLog(h.database?.mongodb || UNKNOWN)}`
  ]
}

/**
 * Build the warning lines a health payload justifies, in report order.
 *
 * An empty array means nothing is wrong, which lets the caller stay a loop
 * rather than a chain of conditionals.
 *
 * @param {Record<string, unknown>} [health]
 * @returns {string[]}
 */
export function healthWarnings(health) {
  const h = health ?? {}
  const warnings = []

  if (h.memory?.used > MEMORY_WARN_MB) {
    warnings.push(`⚠️ High memory usage: ${forLog(h.memory.used)}MB`)
  }

  if (h.database?.mongodb !== HEALTHY_DB_STATUS) {
    warnings.push(`⚠️ Database issue: ${forLog(h.database?.mongodb)}`)
  }

  return warnings
}
