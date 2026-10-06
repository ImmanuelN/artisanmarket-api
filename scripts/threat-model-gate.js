#!/usr/bin/env node
/**
 * Plan stage: threat model gate.
 *
 * Reads an OWASP Threat Dragon (v2) model and decides whether the work it
 * covers may proceed to Code. It replaces a check that only asked whether a
 * markdown file existed — which a blank file, or a model full of unaddressed
 * threats, would have passed.
 *
 * The gate fails when:
 *
 *   - the model cannot be read, or contains no threats at all. An empty model
 *     is a threat-modelling exercise that has not been done;
 *   - any High or Critical threat is still Open;
 *   - a threat marked Mitigated or Accepted does not say how. A status without
 *     a mitigation is an assertion, not a decision.
 *
 * Open Medium and Low threats are reported but do not block: they are known,
 * recorded and scheduled, which is the point of modelling them. Accepted threats
 * are listed on every run, so a risk acceptance stays visible.
 *
 * Usage: node <this script> [path/to/threat-model.json]
 */
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

/** Severities that may not remain Open. */
export const BLOCKING_SEVERITIES = new Set(['critical', 'high'])

/** Statuses that close a threat, each of which must say how. */
const CLOSED = new Set(['mitigated', 'accepted'])

/** A threat ruled out as not applicable needs no mitigation, only a status. */
const NOT_APPLICABLE = 'notapplicable'

const norm = (value) => String(value ?? '').toLowerCase().replaceAll(/[\s_-]/g, '')

/**
 * Parse a Threat Dragon model, refusing anything that is not one.
 *
 * @param {string} text
 */
export function parseModel(text) {
  if (!text?.trim()) throw new Error('the threat model file is empty')
  let model
  try {
    model = JSON.parse(text)
  } catch {
    throw new Error('the threat model is not valid JSON')
  }
  if (!Array.isArray(model?.detail?.diagrams)) {
    throw new Error('not a Threat Dragon v2 model: detail.diagrams is missing')
  }
  return model
}

/** Every threat in every diagram, with the element it is attached to. */
export function collectThreats(model) {
  const threats = []
  for (const diagram of model.detail.diagrams) {
    for (const cell of diagram.cells ?? []) {
      for (const threat of cell.data?.threats ?? []) {
        threats.push({
          ...threat,
          element: cell.data.name ?? cell.data.type ?? 'unnamed element',
          diagram: diagram.title ?? 'untitled diagram'
        })
      }
    }
  }
  return threats.sort((a, b) => (a.number ?? 0) - (b.number ?? 0))
}

/** Decide the gate. Pure: the same threats always give the same answer. */
export function evaluate(threats) {
  const blocking = []
  const incomplete = []
  const openNonBlocking = []
  const accepted = []

  for (const t of threats) {
    const status = norm(t.status)
    const severity = norm(t.severity)
    if (status === NOT_APPLICABLE) continue

    if (CLOSED.has(status)) {
      if (!String(t.mitigation ?? '').trim()) incomplete.push(t)
      else if (status === 'accepted') accepted.push(t)
      continue
    }

    // Anything that is not explicitly closed is treated as open, so an
    // unrecognised status cannot hide a High threat.
    if (BLOCKING_SEVERITIES.has(severity)) blocking.push(t)
    else openNonBlocking.push(t)
  }

  const empty = threats.length === 0
  return {
    total: threats.length,
    blocking,
    incomplete,
    openNonBlocking,
    accepted,
    empty,
    failed: empty || blocking.length > 0 || incomplete.length > 0
  }
}

const label = (t) => `#${t.number ?? '?'} ${t.title ?? 'untitled threat'} [${t.severity ?? 'no severity'}] — ${t.element}`

/** Render a result as log lines, with workflow annotations for anything that blocks. */
export function render(result, title) {
  const lines = [`Threat model: ${title ?? 'untitled'} — ${result.total} threat(s)`]

  if (result.empty) {
    lines.push('::error::The threat model contains no threats. An empty model is a threat-modelling exercise that has not been done.')
  }
  for (const t of result.blocking) {
    lines.push(`::error::Open ${t.severity} threat blocks the Plan stage: ${label(t)}`)
  }
  for (const t of result.incomplete) {
    lines.push(`::error::Threat marked ${t.status} without a mitigation: ${label(t)}`)
  }
  for (const t of result.openNonBlocking) {
    lines.push(`::warning::Open threat, recorded and not blocking: ${label(t)}`)
  }
  if (result.accepted.length > 0) {
    lines.push('', `Accepted risks (${result.accepted.length}):`)
    for (const t of result.accepted) lines.push(`  ${label(t)}`)
  }

  lines.push(
    '',
    result.failed
      ? 'Plan stage: threat model gate FAILED.'
      : 'Plan stage: no High or Critical threat is open, and every closed threat states its mitigation.'
  )
  return lines
}

/**
 * Entry point, with its I/O injected so it can be tested.
 *
 * @returns {number} 0 pass, 1 the gate failed, 2 the model could not be read
 */
export function run(argv, { readFile, log }) {
  const path = argv.find((a) => !a.startsWith('--')) ?? 'docs/threat-model.json'
  let model
  try {
    model = parseModel(readFile(path))
  } catch (err) {
    log(`::error::threat-model-gate: ${path}: ${err.message}`)
    return 2
  }
  const result = evaluate(collectThreats(model))
  for (const line of render(result, model.summary?.title)) log(line)
  return result.failed ? 1 : 0
}

const invokedDirectly = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href
if (invokedDirectly) {
  process.exitCode = run(process.argv.slice(2), {
    readFile: (p) => readFileSync(p, 'utf8'),
    log: (line) => console.log(line)
  })
}
