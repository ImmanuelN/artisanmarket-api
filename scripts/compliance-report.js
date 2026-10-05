#!/usr/bin/env node
/**
 * Monitor stage: continuous compliance report.
 *
 * Reads the actual outcome of every security control in the run — passed in by
 * the workflow from each step's `outcome` — and reports the posture of the
 * commit against them. It replaces a summary that printed fixed text: that
 * version said "Release gate: passed" on runs where the release gate never ran,
 * and listed Snyk as active when it was not configured.
 *
 * Two properties matter more than the formatting:
 *
 *   It reports only what ran. A control whose step was skipped — because an
 *   earlier gate failed, or because its tool is not configured — is reported as
 *   not run, never as passed.
 *
 *   It fails when the posture is not fully satisfied, so a scheduled run that
 *   finds a newly published vulnerability in an unchanged commit goes red
 *   instead of filing a quiet report nobody reads.
 *
 * The PCI DSS and GDPR columns are an indicative alignment of each automated
 * control to the requirement it supports. They are not an assessment: no
 * pipeline can evidence the people, process and physical requirements that make
 * up most of PCI DSS, and a control supporting a requirement does not on its own
 * satisfy it.
 *
 * Usage: node <this script>   (inputs are read from the environment)
 */
import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

/**
 * The control-to-requirement mapping, written as a table so it can be reviewed
 * as one. Columns:
 *
 *   id | stage | control | tool | outcome variable | required/optional | PCI DSS v4.0.1 | GDPR
 *
 * The outcome variable is set by the workflow from that control's own step
 * outcome. An optional control is reported but does not affect the verdict.
 */
const CONTROL_TABLE = `
threat-model | Plan    | Threat model present             | docs/threat-model.md   | OUTCOME_THREAT_MODEL | required | 6.2.1        | Art. 25(1)
eslint       | Code    | Security lint ruleset            | ESLint                 | OUTCOME_ESLINT       | required | 6.2.4        | Art. 25(1)
tests        | Code    | Security regression tests        | Jest / Vitest          | OUTCOME_TESTS        | required | 6.2.4        | Art. 32(1)(d)
gitleaks     | Code    | Secret scanning                  | Gitleaks               | OUTCOME_GITLEAKS     | required | 8.6.2        | Art. 32(1)(b)
sast         | Code    | Static analysis and quality gate | SonarQube (SonarCloud) | OUTCOME_SAST         | required | 6.2.3, 6.2.4 | Art. 25(1)
sca          | Code    | Dependency audit                 | npm audit + audit gate | OUTCOME_SCA          | required | 6.3.1, 6.3.3 | Art. 32(1)(b)
snyk         | Build   | Dependency analysis              | Snyk                   | OUTCOME_SNYK         | optional | 6.3.1        | Art. 32(1)(b)
trivy-fs     | Build   | Dependency and config scan       | Trivy (filesystem)     | OUTCOME_TRIVY_FS     | required | 6.3.1, 6.3.2 | Art. 32(1)(b)
trivy-image  | Build   | Container image scan             | Trivy (image)          | OUTCOME_TRIVY_IMAGE  | required | 6.3.1, 6.3.3 | Art. 32(1)(b)
iac          | Build   | Infrastructure-as-code scan      | Checkov                | OUTCOME_IAC          | required | 1.3.1, 2.2.1 | Art. 32(1)(b)
dast         | Staging | Dynamic scan of the running app  | OWASP ZAP (baseline)   | OUTCOME_DAST         | required | 6.2.4        | Art. 32(1)(d)
release-gate | Deploy  | Release gate                     | needs chain            | OUTCOME_RELEASE_GATE | required | 6.5.1        | Art. 32(1)(d)
`

/** Caveats attached to individual controls, rendered beneath the table. */
const NOTES = {
  dast:
    'A baseline scan supports, but does not satisfy, PCI DSS 6.4.2, which requires an automated ' +
    'technical solution that continually detects and prevents web-based attacks.'
}

const list = (cell) => cell.split(',').map((x) => x.trim())

/**
 * Parse the control table. Exported so a test can check every row is complete:
 * a malformed row would otherwise silently drop a control from the report.
 */
export function parseControlTable(text) {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [id, stage, control, tool, env, need, pci, gdpr] = line.split('|').map((cell) => cell.trim())
      const parsed = { id, stage, control, tool, env, required: need === 'required', pci: list(pci), gdpr: list(gdpr) }
      return NOTES[id] ? { ...parsed, note: NOTES[id] } : parsed
    })
}

/** Every control the pipeline runs, in stage order. */
export const CONTROLS = parseControlTable(CONTROL_TABLE)

/** Days before a review date at which an acceptance is flagged. */
export const EXPIRY_WARNING_DAYS = 14

const LABEL = { pass: 'passed', fail: 'FAILED', 'not-run': 'not run' }

/**
 * Map a GitHub Actions step outcome to a report status. Anything other than an
 * explicit success or failure — skipped, cancelled, or absent because the job
 * never ran — is "not run", so it can never be mistaken for a pass.
 */
export function classify(outcome) {
  if (outcome === 'success') return 'pass'
  if (outcome === 'failure') return 'fail'
  return 'not-run'
}

/** Evaluate every control against the outcomes in `env`. */
export function evaluate(env, controls = CONTROLS) {
  const results = controls.map((c) => ({ ...c, outcome: env[c.env] ?? '', status: classify(env[c.env]) }))
  const required = results.filter((r) => r.required)
  const failed = required.filter((r) => r.status === 'fail')
  const notRun = required.filter((r) => r.status === 'not-run')
  return {
    controls: results,
    failed,
    notRun,
    verdict: failed.length === 0 && notRun.length === 0 ? 'pass' : 'fail'
  }
}

/** Whole days from `today` to `date`, both YYYY-MM-DD. Negative once passed. */
export function daysUntil(date, today) {
  return Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000)
}

/**
 * The accepted-risk register: every advisory the dependency gate is currently
 * allowed to pass, with how long the acceptance has left. Unreadable input
 * yields an empty register rather than failing the report — the dependency
 * gate itself already fails closed on a bad allowlist.
 */
export function acceptedRisks(allowlistText, today) {
  if (!allowlistText) return []
  let accepted
  try {
    accepted = JSON.parse(allowlistText)?.accepted
  } catch {
    return []
  }
  if (!Array.isArray(accepted)) return []
  return accepted.map((a) => {
    const days = daysUntil(a.reviewBy, today)
    let state = 'current'
    if (days < 0) state = 'expired'
    else if (days <= EXPIRY_WARNING_DAYS) state = 'expiring'
    return { id: a.id, package: a.package ?? '', severity: a.severity ?? '', reviewBy: a.reviewBy, days, state }
  })
}

const FOOTER =
  '_Indicative alignment only. Each automated control supports part of the requirement cited; ' +
  'none satisfies a requirement on its own, and PCI DSS compliance is assessed against the full ' +
  'standard, most of which no pipeline can evidence. This is not a compliance attestation._'

function verdictLines(result, event) {
  const lines = []
  if (result.verdict === 'pass') {
    lines.push(`**All ${result.controls.filter((c) => c.required).length} required controls passed.**`)
  } else {
    const parts = []
    if (result.failed.length) parts.push(`${result.failed.length} failed`)
    if (result.notRun.length) parts.push(`${result.notRun.length} did not run`)
    lines.push(`**Posture not satisfied: ${parts.join(', ')}.**`)
  }
  if (event === 'schedule') {
    lines.push(
      '',
      'This is a scheduled re-verification of an unchanged commit. A control that fails here was ' +
        'broken by something outside the repository — typically a newly published vulnerability.'
    )
  }
  return lines
}

function controlLines(controls) {
  const rows = controls.map((c) => {
    const cell = c.required ? LABEL[c.status] : `${LABEL[c.status]} (optional)`
    return `| ${c.stage} | ${c.control} | ${c.tool} | ${cell} | ${c.pci.join(', ')} | ${c.gdpr.join(', ')} |`
  })
  const notes = controls.filter((c) => c.note).map((c) => `- **${c.control}:** ${c.note}`)
  return [
    '| Stage | Control | Tool | Result | PCI DSS v4.0.1 | GDPR |',
    '|---|---|---|---|---|---|',
    ...rows,
    ...(notes.length ? ['', ...notes] : [])
  ]
}

function riskStatus(r) {
  if (r.state === 'expired') return `**expired ${-r.days} days ago**`
  if (r.state === 'expiring') return `**${r.days} days left — review due**`
  return `${r.days} days left`
}

function riskLines(risks) {
  if (risks.length === 0) return ['None. The dependency gate is currently accepting no advisories.']
  return [
    '| Advisory | Package | Severity | Review by | Status |',
    '|---|---|---|---|---|',
    ...risks.map((r) => `| ${r.id} | ${r.package} | ${r.severity} | ${r.reviewBy} | ${riskStatus(r)} |`)
  ]
}

/** Render the report as Markdown, for the job summary and the stored artifact. */
export function renderMarkdown(result, risks, meta) {
  return [
    `## Compliance report — ${meta.repository ?? 'repository'} @ \`${(meta.sha ?? '').slice(0, 7)}\``,
    '',
    `Trigger: **${meta.event ?? 'unknown'}** · Ref: \`${meta.ref ?? ''}\` · Date: ${meta.today}`,
    '',
    ...verdictLines(result, meta.event),
    '',
    ...controlLines(result.controls),
    '',
    '### Accepted risks',
    '',
    ...riskLines(risks),
    '',
    '---',
    '',
    FOOTER
  ].join('\n') + '\n'
}

/** Workflow annotations, so problems surface on the run page, not only in the summary. */
export function annotations(result, risks) {
  const out = []
  for (const c of result.failed) out.push(`::error::${c.stage} · ${c.control} (${c.tool}) failed.`)
  for (const c of result.notRun) out.push(`::warning::${c.stage} · ${c.control} (${c.tool}) did not run.`)
  for (const r of risks) {
    if (r.state === 'expired') out.push(`::error::Accepted advisory ${r.id} expired on ${r.reviewBy}.`)
    if (r.state === 'expiring') out.push(`::warning::Accepted advisory ${r.id} is due for review by ${r.reviewBy}.`)
  }
  return out
}

/**
 * Entry point, with all I/O injected so it can be tested.
 *
 * @returns {number} 0 when every required control passed, otherwise 1
 */
export function run({ env, readFile, fileExists, writeFile, appendFile, log, today }) {
  const allowlistPath = env.ALLOWLIST_PATH || '.audit-allowlist.json'
  const risks = acceptedRisks(fileExists(allowlistPath) ? readFile(allowlistPath) : '', today)
  const result = evaluate(env)
  const meta = { repository: env.GITHUB_REPOSITORY, sha: env.GITHUB_SHA, ref: env.GITHUB_REF_NAME, event: env.GITHUB_EVENT_NAME, today }

  const markdown = renderMarkdown(result, risks, meta)
  const record = {
    ...meta,
    verdict: result.verdict,
    controls: result.controls.map(({ id, stage, control, tool, required, outcome, status, pci, gdpr }) => ({
      id, stage, control, tool, required, outcome, status, pci, gdpr
    })),
    acceptedRisks: risks
  }

  writeFile('compliance-report.md', markdown)
  writeFile('compliance-report.json', JSON.stringify(record, null, 2) + '\n')
  if (env.GITHUB_STEP_SUMMARY) appendFile(env.GITHUB_STEP_SUMMARY, markdown)
  for (const line of annotations(result, risks)) log(line)
  log(result.verdict === 'pass' ? 'Compliance posture: all required controls passed.' : 'Compliance posture: not satisfied.')

  return result.verdict === 'pass' ? 0 : 1
}

const invokedDirectly = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href
if (invokedDirectly) {
  process.exitCode = run({
    env: process.env,
    readFile: (p) => readFileSync(p, 'utf8'),
    fileExists: existsSync,
    writeFile: (p, s) => writeFileSync(p, s),
    appendFile: (p, s) => appendFileSync(p, s),
    log: (line) => console.log(line),
    today: new Date().toISOString().slice(0, 10)
  })
}
