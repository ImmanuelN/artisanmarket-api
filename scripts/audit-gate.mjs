#!/usr/bin/env node
/**
 * Dependency audit gate.
 *
 * Wraps `npm audit` so that the gate can stay blocking on the FULL dependency
 * tree — devDependencies included — while still allowing a specific advisory to
 * be accepted in the open, with a reason and a review date.
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
 *   single advisory has no released fix. This script adds the third option:
 *   keep scanning everything, name the exception, and make it expire.
 *
 * An allowlist entry is not a dismissal. It fails the build when its review
 * date passes, so an acceptance cannot quietly become permanent, and it fails
 * when it stops matching anything, so stale entries get removed rather than
 * accumulating.
 *
 * Usage: node scripts/audit-gate.mjs [--level=high]
 */
import { spawnSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ALLOWLIST_PATH = join(ROOT, '.audit-allowlist.json')

const RANK = { info: 0, low: 1, moderate: 2, high: 3, critical: 4 }

const levelArg = process.argv.find((a) => a.startsWith('--level='))
const MIN_LEVEL = levelArg ? levelArg.split('=')[1] : 'high'
const MIN_RANK = RANK[MIN_LEVEL]
if (MIN_RANK === undefined) {
  console.error(`Unknown --level=${MIN_LEVEL}. Use one of: ${Object.keys(RANK).join(', ')}`)
  process.exit(2)
}

/** Pull the GHSA identifier out of an advisory URL. */
const advisoryId = (url) => (url ?? '').match(/GHSA-[a-z0-9-]+/i)?.[0] ?? url ?? 'unknown'

function loadAllowlist() {
  if (!existsSync(ALLOWLIST_PATH)) return []
  const parsed = JSON.parse(readFileSync(ALLOWLIST_PATH, 'utf8'))
  return Array.isArray(parsed.accepted) ? parsed.accepted : []
}

function runAudit() {
  // npm audit exits non-zero whenever it finds anything, so the exit code says
  // nothing useful here; the JSON body is what matters.
  const res = spawnSync('npm', ['audit', '--json'], {
    cwd: ROOT,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    maxBuffer: 32 * 1024 * 1024
  })
  if (!res.stdout) {
    console.error('npm audit produced no output.')
    console.error(res.stderr || '(no stderr)')
    process.exit(2)
  }
  try {
    return JSON.parse(res.stdout)
  } catch {
    console.error('Could not parse npm audit output as JSON:')
    console.error(res.stdout.slice(0, 2000))
    process.exit(2)
  }
}

/**
 * Resolve a package to the set of root advisories responsible for it.
 *
 * `via` holds either advisory objects (this package is itself vulnerable) or
 * package names (this package is only affected because something it depends on
 * is). Following the names reaches the advisory that actually has to be
 * accepted, so accepting a root advisory covers everything downstream of it
 * without listing each affected package separately.
 */
function rootAdvisories(name, vulns, seen = new Set()) {
  if (seen.has(name)) return []
  seen.add(name)
  const entry = vulns[name]
  if (!entry) return []
  const out = []
  for (const via of entry.via ?? []) {
    if (typeof via === 'string') {
      out.push(...rootAdvisories(via, vulns, seen))
    } else if (via?.url || via?.title) {
      out.push({ id: advisoryId(via.url), title: via.title, severity: via.severity, url: via.url })
    }
  }
  return out
}

const report = runAudit()
const vulns = report.vulnerabilities ?? {}
const allowlist = loadAllowlist()
const allowedIds = new Map(allowlist.map((a) => [a.id, a]))

const today = new Date().toISOString().slice(0, 10)
const blocking = []
const accepted = new Map()

for (const [name, entry] of Object.entries(vulns)) {
  if ((RANK[entry.severity] ?? 0) < MIN_RANK) continue
  const roots = rootAdvisories(name, vulns)
  // A package with no resolvable advisory cannot be matched against the
  // allowlist, so it blocks rather than slipping through unexamined.
  if (roots.length === 0) {
    blocking.push({ name, id: 'unresolved', title: entry.severity, url: '' })
    continue
  }
  for (const root of roots) {
    if (allowedIds.has(root.id)) {
      if (!accepted.has(root.id)) accepted.set(root.id, { ...root, packages: new Set() })
      accepted.get(root.id).packages.add(name)
    } else {
      blocking.push({ name, ...root })
    }
  }
}

let failed = false

if (accepted.size > 0) {
  console.log(`Accepted advisories (${accepted.size}) — still scanned, deliberately not blocking:\n`)
  for (const [id, info] of accepted) {
    const entry = allowedIds.get(id)
    console.log(`  ${id}  [${info.severity}]  ${info.title ?? ''}`)
    console.log(`    reaches:   ${[...info.packages].sort().join(', ')}`)
    console.log(`    reason:    ${entry.reason}`)
    console.log(`    accepted:  ${entry.acceptedOn}   review by: ${entry.reviewBy}`)
    if (entry.reviewBy < today) {
      console.log(`    ::error::ACCEPTANCE EXPIRED on ${entry.reviewBy}. Re-evaluate it or extend the date deliberately.`)
      failed = true
    }
    console.log('')
  }
}

// An entry that matches nothing is either fixed upstream or mis-keyed. Either
// way it should not sit in the file pretending to cover something.
const stale = allowlist.filter((a) => !accepted.has(a.id))
if (stale.length > 0) {
  console.log('Allowlist entries that no longer match any finding — remove them:\n')
  for (const a of stale) console.log(`  ${a.id}  (${a.reason})`)
  console.log('')
  failed = true
}

if (blocking.length > 0) {
  console.log(`Blocking advisories at ${MIN_LEVEL} or above (${blocking.length}):\n`)
  for (const b of blocking) {
    console.log(`  ${b.name}: ${b.id}  ${b.title ?? ''}`)
    if (b.url) console.log(`    ${b.url}`)
  }
  console.log('')
  console.log('Fix them, or accept one deliberately by adding it to .audit-allowlist.json')
  console.log('with a reason and a review date.')
  failed = true
}

if (!failed) {
  const counts = report.metadata?.vulnerabilities ?? {}
  console.log(
    `Dependency audit passed at ${MIN_LEVEL}+ ` +
      `(critical ${counts.critical ?? 0}, high ${counts.high ?? 0}, moderate ${counts.moderate ?? 0}).`
  )
}

process.exit(failed ? 1 : 0)
