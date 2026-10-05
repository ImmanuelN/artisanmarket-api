#!/usr/bin/env node
/**
 * Dependency audit gate.
 *
 * Reads the JSON report of `npm audit --json` and decides whether the build may
 * proceed. The gate stays blocking on the FULL dependency tree, devDependencies
 * included, while still allowing a specific advisory to be accepted in the open,
 * with a reason and a review date.
 *
 * Why this exists rather than `npm audit --omit=dev`:
 *
 *   Scoping the audit to production dependencies was tried once in this project
 *   and deliberately reverted, on the grounds that a compromised build tool can
 *   affect the bundle it produces even though it never ships. Narrowing the gate
 *   silently drops that coverage for every future advisory, not just the one
 *   that prompted it.
 *
 *   `npm audit` has no per-advisory suppression, so the choice it offers is
 *   between blocking on everything and scanning less. Neither is right when a
 *   single advisory has no released fix. This adds the third option: keep
 *   scanning everything, name the exception, and make it expire.
 *
 * An allowlist entry is not a dismissal. The gate fails when a finding is not
 * listed, when an acceptance passes its review date, and when a listed entry
 * stops matching anything, so an acceptance cannot quietly become permanent and
 * stale entries get removed rather than accumulating.
 *
 * The report is read from a file rather than produced by spawning npm. That
 * keeps the decision a pure function of its input, which is what makes it
 * testable, and avoids resolving an executable through PATH (javascript:S4036).
 *
 * The gate fails closed. `npm audit` exits non-zero whenever it finds anything,
 * so the pipeline discards its exit code — which means empty, malformed or
 * error output must be treated as a failure here, never as a clean tree.
 *
 * Usage: node <this script> <npm-audit.json> [--level=high] [--allowlist=path]
 */
import { readFileSync, existsSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export const RANK = { info: 0, low: 1, moderate: 2, high: 3, critical: 4 }

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const GHSA = /GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}/i

/** The GHSA identifier in an advisory URL, or the URL itself when there is none. */
export function advisoryId(url) {
  if (!url) return 'unknown'
  return url.match(GHSA)?.[0] ?? url
}

/**
 * Parse `npm audit --json` output, refusing anything that is not a report.
 *
 * @param {string} text
 * @returns {{ vulnerabilities: object, metadata?: object }}
 */
export function parseReport(text) {
  if (!text?.trim()) {
    throw new Error('npm audit produced no output; refusing to treat that as a clean tree')
  }
  let report
  try {
    report = JSON.parse(text)
  } catch {
    throw new Error('npm audit output is not valid JSON')
  }
  if (report.error) {
    const summary = report.error.summary ?? JSON.stringify(report.error)
    throw new Error(`npm audit reported an error: ${summary}`)
  }
  if (!report.vulnerabilities || typeof report.vulnerabilities !== 'object') {
    throw new Error('npm audit output has no "vulnerabilities" field; refusing to treat it as clean')
  }
  return report
}

/**
 * Parse and validate the allowlist. An entry missing its reason or its review
 * date would defeat the point of the file, so it is rejected outright rather
 * than honoured.
 *
 * @param {string} text
 * @returns {Array<{ id: string, reason: string, acceptedOn?: string, reviewBy: string }>}
 */
export function parseAllowlist(text) {
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('allowlist is not valid JSON')
  }
  const accepted = parsed?.accepted ?? []
  if (!Array.isArray(accepted)) throw new Error('allowlist "accepted" must be an array')

  const problems = []
  accepted.forEach((entry, i) => {
    const where = `allowlist entry ${i} (${entry?.id ?? 'no id'})`
    if (!GHSA.test(entry?.id ?? '')) problems.push(`${where}: id must be a GHSA identifier`)
    if (!entry?.reason?.trim()) problems.push(`${where}: a reason is required`)
    if (!ISO_DATE.test(entry?.reviewBy ?? '')) {
      problems.push(`${where}: reviewBy must be a YYYY-MM-DD date`)
    }
  })
  if (problems.length > 0) throw new Error(problems.join('; '))
  return accepted
}

/**
 * Resolve a package to the advisories actually responsible for it.
 *
 * `via` holds either advisory objects (this package is itself vulnerable) or
 * package names (it is only affected because something it depends on is).
 * Following the names reaches the root advisory, so accepting that one covers
 * everything downstream without listing each affected package.
 */
export function rootAdvisories(name, vulns, seen = new Set()) {
  if (seen.has(name)) return []
  seen.add(name)
  const out = []
  for (const via of vulns[name]?.via ?? []) {
    if (typeof via === 'string') {
      out.push(...rootAdvisories(via, vulns, seen))
    } else if (via?.url || via?.title) {
      out.push({ id: advisoryId(via.url), title: via.title, severity: via.severity, url: via.url })
    }
  }
  return out
}

/**
 * Decide the gate. Pure: the same report, allowlist and date always give the
 * same answer.
 *
 * @param {{ vulnerabilities: object }} report
 * @param {Array<{ id: string, reviewBy: string }>} allowlist
 * @param {{ minLevel?: string, today: string }} options
 */
export function evaluate(report, allowlist, { minLevel = 'high', today }) {
  const minRank = RANK[minLevel]
  if (minRank === undefined) {
    throw new Error(`unknown level "${minLevel}"; use one of ${Object.keys(RANK).join(', ')}`)
  }

  const vulns = report.vulnerabilities
  const allowed = new Map(allowlist.map((a) => [a.id, a]))
  const accepted = new Map()
  const blocking = []

  for (const [name, entry] of Object.entries(vulns)) {
    if ((RANK[entry.severity] ?? 0) < minRank) continue

    const roots = rootAdvisories(name, vulns)
    // With no resolvable advisory there is nothing to match against the
    // allowlist, so the finding blocks rather than slipping through unexamined.
    if (roots.length === 0) {
      blocking.push({ name, id: 'unresolved', title: `${entry.severity} finding with no resolvable advisory` })
      continue
    }

    for (const root of roots) {
      const acceptance = allowed.get(root.id)
      if (!acceptance) {
        blocking.push({ name, ...root })
        continue
      }
      if (!accepted.has(root.id)) accepted.set(root.id, { ...root, acceptance, packages: new Set() })
      accepted.get(root.id).packages.add(name)
    }
  }

  const acceptedList = [...accepted.values()].map((a) => ({
    ...a,
    packages: [...a.packages].sort((x, y) => x.localeCompare(y)),
    expired: a.acceptance.reviewBy < today
  }))
  const stale = allowlist.filter((a) => !accepted.has(a.id))
  const failed = blocking.length > 0 || stale.length > 0 || acceptedList.some((a) => a.expired)

  return { accepted: acceptedList, blocking, stale, failed }
}

/**
 * Render a result as log lines. Accepted advisories are printed on every run,
 * so an acceptance is always visible in the log of the run it let through.
 */
export function render(result, { minLevel = 'high', counts = {} } = {}) {
  const lines = []

  if (result.accepted.length > 0) {
    lines.push(`Accepted advisories (${result.accepted.length}) — still scanned, deliberately not blocking:`, '')
    for (const a of result.accepted) {
      lines.push(
        `  ${a.id}  [${a.severity ?? 'unknown'}]  ${a.title ?? ''}`,
        `    reaches:   ${a.packages.join(', ')}`,
        `    reason:    ${a.acceptance.reason}`,
        `    accepted:  ${a.acceptance.acceptedOn ?? 'unrecorded'}   review by: ${a.acceptance.reviewBy}`
      )
      if (a.expired) {
        lines.push(
          `    ::error::Acceptance of ${a.id} expired on ${a.acceptance.reviewBy}. ` +
            'Re-evaluate it, or extend the date deliberately.'
        )
      }
      lines.push('')
    }
  }

  if (result.stale.length > 0) {
    lines.push('Allowlist entries that no longer match any finding — remove them:', '')
    for (const a of result.stale) lines.push(`  ${a.id}  (${a.reason})`)
    lines.push('')
  }

  if (result.blocking.length > 0) {
    lines.push(`Blocking advisories at ${minLevel} or above (${result.blocking.length}):`, '')
    for (const b of result.blocking) {
      lines.push(`  ${b.name}: ${b.id}  ${b.title ?? ''}`)
      if (b.url) lines.push(`    ${b.url}`)
    }
    lines.push(
      '',
      'Fix them, or accept one deliberately in .audit-allowlist.json with a reason',
      'and a review date.'
    )
  }

  if (!result.failed) {
    lines.push(
      `Dependency audit passed at ${minLevel}+ ` +
        `(critical ${counts.critical ?? 0}, high ${counts.high ?? 0}, moderate ${counts.moderate ?? 0}).`
    )
  }

  return lines
}

/**
 * Command-line entry point, with its I/O injected so it can be tested.
 *
 * @returns {number} 0 pass, 1 gate failed, 2 the gate could not be evaluated
 */
export function run(argv, { readFile, fileExists, log, today }) {
  const option = (name) => argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3)
  const minLevel = option('level') ?? 'high'
  const allowlistPath = option('allowlist') ?? '.audit-allowlist.json'
  const reportPath = argv.find((a) => !a.startsWith('--'))

  if (!reportPath) {
    log('Usage: audit-gate <npm-audit.json> [--level=high] [--allowlist=path]')
    return 2
  }

  try {
    const report = parseReport(readFile(reportPath))
    const allowlist = fileExists(allowlistPath) ? parseAllowlist(readFile(allowlistPath)) : []
    const result = evaluate(report, allowlist, { minLevel, today })
    for (const line of render(result, { minLevel, counts: report.metadata?.vulnerabilities })) log(line)
    return result.failed ? 1 : 0
  } catch (err) {
    log(`audit-gate: ${err.message}`)
    return 2
  }
}

const invokedDirectly = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href
if (invokedDirectly) {
  process.exitCode = run(process.argv.slice(2), {
    readFile: (p) => readFileSync(p, 'utf8'),
    fileExists: existsSync,
    log: (line) => console.log(line),
    today: new Date().toISOString().slice(0, 10)
  })
}
