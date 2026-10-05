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
 * Every control the pipeline runs, in stage order. `env` names the environment
 * variable carrying that step's outcome. A control that is not `required` is
 * reported but does not affect the verdict.
 */
export const CONTROLS = [
  {
    id: 'threat-model', stage: 'Plan', control: 'Threat model present', tool: 'docs/threat-model.md',
    env: 'OUTCOME_THREAT_MODEL', required: true,
    pci: ['6.2.1'], gdpr: ['Art. 25(1)']
  },
  {
    id: 'eslint', stage: 'Code', control: 'Security lint ruleset', tool: 'ESLint',
    env: 'OUTCOME_ESLINT', required: true,
    pci: ['6.2.4'], gdpr: ['Art. 25(1)']
  },
  {
    id: 'tests', stage: 'Code', control: 'Security regression tests', tool: 'Jest / Vitest',
    env: 'OUTCOME_TESTS', required: true,
    pci: ['6.2.4'], gdpr: ['Art. 32(1)(d)']
  },
  {
    id: 'gitleaks', stage: 'Code', control: 'Secret scanning', tool: 'Gitleaks',
    env: 'OUTCOME_GITLEAKS', required: true,
    pci: ['8.6.2'], gdpr: ['Art. 32(1)(b)']
  },
  {
    id: 'sast', stage: 'Code', control: 'Static analysis and quality gate', tool: 'SonarQube (SonarCloud)',
    env: 'OUTCOME_SAST', required: true,
    pci: ['6.2.3', '6.2.4'], gdpr: ['Art. 25(1)']
  },
  {
    id: 'sca', stage: 'Code', control: 'Dependency audit', tool: 'npm audit + audit gate',
    env: 'OUTCOME_SCA', required: true,
    pci: ['6.3.1', '6.3.3'], gdpr: ['Art. 32(1)(b)']
  },
  {
    id: 'snyk', stage: 'Build', control: 'Dependency analysis (optional)', tool: 'Snyk',
    env: 'OUTCOME_SNYK', required: false,
    pci: ['6.3.1'], gdpr: ['Art. 32(1)(b)']
  },
  {
    id: 'trivy-fs', stage: 'Build', control: 'Dependency and config scan', tool: 'Trivy (filesystem)',
    env: 'OUTCOME_TRIVY_FS', required: true,
    pci: ['6.3.1', '6.3.2'], gdpr: ['Art. 32(1)(b)']
  },
  {
    id: 'trivy-image', stage: 'Build', control: 'Container image scan', tool: 'Trivy (image)',
    env: 'OUTCOME_TRIVY_IMAGE', required: true,
    pci: ['6.3.1', '6.3.3'], gdpr: ['Art. 32(1)(b)']
  },
  {
    id: 'iac', stage: 'Build', control: 'Infrastructure-as-code scan', tool: 'Checkov',
    env: 'OUTCOME_IAC', required: true,
    pci: ['1.3.1', '2.2.1'], gdpr: ['Art. 32(1)(b)']
  },
  {
    id: 'dast', stage: 'Staging', control: 'Dynamic scan of the running app', tool: 'OWASP ZAP (baseline)',
    env: 'OUTCOME_DAST', required: true,
    pci: ['6.2.4'], gdpr: ['Art. 32(1)(d)'],
    note:
      'A baseline scan supports, but does not satisfy, PCI DSS 6.4.2, which requires an automated ' +
      'technical solution that continually detects and prevents web-based attacks.'
  },
  {
    id: 'release-gate', stage: 'Deploy', control: 'Release gate', tool: 'needs chain',
    env: 'OUTCOME_RELEASE_GATE', required: true,
    pci: ['6.5.1'], gdpr: ['Art. 32(1)(d)']
  }
]

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

/** Render the report as Markdown, for the job summary and the stored artifact. */
export function renderMarkdown(result, risks, meta) {
  const lines = [
    `## Compliance report — ${meta.repository ?? 'repository'} @ \`${(meta.sha ?? '').slice(0, 7)}\``,
    '',
    `Trigger: **${meta.event ?? 'unknown'}** · Ref: \`${meta.ref ?? ''}\` · Date: ${meta.today}`,
    ''
  ]

  if (result.verdict === 'pass') {
    lines.push(`**All ${result.controls.filter((c) => c.required).length} required controls passed.**`)
  } else {
    const parts = []
    if (result.failed.length) parts.push(`${result.failed.length} failed`)
    if (result.notRun.length) parts.push(`${result.notRun.length} did not run`)
    lines.push(`**Posture not satisfied: ${parts.join(', ')}.**`)
  }
  if (meta.event === 'schedule') {
    lines.push(
      '',
      'This is a scheduled re-verification of an unchanged commit. A control that fails here was ' +
        'broken by something outside the repository — typically a newly published vulnerability.'
    )
  }

  lines.push(
    '',
    '| Stage | Control | Tool | Result | PCI DSS v4.0.1 | GDPR |',
    '|---|---|---|---|---|---|'
  )
  for (const c of result.controls) {
    const cell = c.required ? LABEL[c.status] : `${LABEL[c.status]} (optional)`
    lines.push(`| ${c.stage} | ${c.control} | ${c.tool} | ${cell} | ${c.pci.join(', ')} | ${c.gdpr.join(', ')} |`)
  }

  const notes = result.controls.filter((c) => c.note)
  if (notes.length) {
    lines.push('')
    for (const c of notes) lines.push(`- **${c.control}:** ${c.note}`)
  }

  lines.push('', '### Accepted risks')
  if (risks.length === 0) {
    lines.push('', 'None. The dependency gate is currently accepting no advisories.')
  } else {
    lines.push('', '| Advisory | Package | Severity | Review by | Status |', '|---|---|---|---|---|')
    for (const r of risks) {
      let status = `${r.days} days left`
      if (r.state === 'expired') status = `**expired ${-r.days} days ago**`
      else if (r.state === 'expiring') status = `**${r.days} days left — review due**`
      lines.push(`| ${r.id} | ${r.package} | ${r.severity} | ${r.reviewBy} | ${status} |`)
    }
  }

  lines.push(
    '',
    '---',
    '',
    '_Indicative alignment only. Each automated control supports part of the requirement cited; ' +
      'none satisfies a requirement on its own, and PCI DSS compliance is assessed against the full ' +
      'standard, most of which no pipeline can evidence. This is not a compliance attestation._'
  )
  return lines.join('\n') + '\n'
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
