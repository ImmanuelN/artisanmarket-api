import {
  CONTROLS,
  parseControlTable,
  EXPIRY_WARNING_DAYS,
  classify,
  evaluate,
  daysUntil,
  acceptedRisks,
  renderMarkdown,
  annotations,
  run
} from '../scripts/compliance-report.js'

/**
 * The Monitor stage's report replaced one that printed fixed text and said
 * "Release gate: passed" on runs where the gate never ran. The cases that matter
 * are therefore the ones where it must NOT report a pass: a failed control, a
 * control that was skipped, and a control whose outcome never arrived.
 */

const TODAY = '2026-10-05'

/** Every required control succeeded; Snyk (optional) not configured. */
const allPassing = () =>
  Object.fromEntries(CONTROLS.map((c) => [c.env, c.required ? 'success' : 'skipped']))

const allowlist = (reviewBy) =>
  JSON.stringify({
    accepted: [{ id: 'GHSA-vfj7-8cjw-p6xm', package: 'braces', severity: 'high', reviewBy }]
  })

describe('the control table', () => {
  test('every row parses into a complete control with a unique outcome variable', () => {
    expect(CONTROLS).toHaveLength(12)
    for (const c of CONTROLS) {
      for (const field of ['id', 'stage', 'control', 'tool', 'env']) expect(c[field]).toBeTruthy()
      expect(c.env).toMatch(/^OUTCOME_[A-Z_]+$/)
      expect(c.pci.every(Boolean)).toBe(true)
      expect(c.gdpr.every(Boolean)).toBe(true)
    }
    expect(new Set(CONTROLS.map((c) => c.env)).size).toBe(CONTROLS.length)
    expect(new Set(CONTROLS.map((c) => c.id)).size).toBe(CONTROLS.length)
  })

  test('only Snyk is optional', () => {
    expect(CONTROLS.filter((c) => !c.required).map((c) => c.id)).toEqual(['snyk'])
  })

  test('splits multi-requirement cells and attaches notes by id', () => {
    const [row] = parseControlTable('dast | S | C | T | OUTCOME_X | required | 1.1, 2.2 | Art. 1')
    expect(row.pci).toEqual(['1.1', '2.2'])
    expect(row.note).toMatch(/6.4.2/)
  })
})

describe('classify', () => {
  test.each([
    ['success', 'pass'],
    ['failure', 'fail'],
    ['skipped', 'not-run'],
    ['cancelled', 'not-run'],
    ['', 'not-run'],
    [undefined, 'not-run']
  ])('maps %p to %s', (outcome, status) => {
    expect(classify(outcome)).toBe(status)
  })
})

describe('evaluate', () => {
  test('passes only when every required control succeeded', () => {
    expect(evaluate(allPassing()).verdict).toBe('pass')
  })

  test('an optional control that did not run does not affect the verdict', () => {
    const r = evaluate(allPassing())
    expect(r.controls.find((c) => c.id === 'snyk').status).toBe('not-run')
    expect(r.verdict).toBe('pass')
  })

  test('an optional control that failed does not affect the verdict either', () => {
    expect(evaluate({ ...allPassing(), OUTCOME_SNYK: 'failure' }).verdict).toBe('pass')
  })

  test('fails when a required control failed', () => {
    const r = evaluate({ ...allPassing(), OUTCOME_TRIVY_IMAGE: 'failure' })
    expect(r.verdict).toBe('fail')
    expect(r.failed.map((c) => c.id)).toEqual(['trivy-image'])
  })

  test('fails when a required control was skipped, rather than counting it as a pass', () => {
    const r = evaluate({ ...allPassing(), OUTCOME_RELEASE_GATE: 'skipped' })
    expect(r.verdict).toBe('fail')
    expect(r.notRun.map((c) => c.id)).toEqual(['release-gate'])
  })

  test('fails when an outcome never arrived, as when its job did not run at all', () => {
    const env = allPassing()
    delete env.OUTCOME_DAST
    const r = evaluate(env)
    expect(r.verdict).toBe('fail')
    expect(r.notRun.map((c) => c.id)).toEqual(['dast'])
  })

  test('reports an upstream failure and everything it blocked, as in a red main run', () => {
    // The 2026-10-05 API run: the dependency audit failed, so Build, Staging
    // and Deploy never ran. The old summary still printed "Release gate: passed".
    const env = {
      OUTCOME_THREAT_MODEL: 'success',
      OUTCOME_ESLINT: 'success',
      OUTCOME_TESTS: 'success',
      OUTCOME_GITLEAKS: 'success',
      OUTCOME_SAST: 'success',
      OUTCOME_SCA: 'failure'
    }
    const r = evaluate(env)
    expect(r.failed.map((c) => c.id)).toEqual(['sca'])
    expect(r.notRun.map((c) => c.id)).toEqual(['trivy-fs', 'trivy-image', 'iac', 'dast', 'release-gate'])
  })
})

describe('daysUntil', () => {
  test('counts whole days, negative once the date has passed', () => {
    expect(daysUntil('2026-10-15', TODAY)).toBe(10)
    expect(daysUntil(TODAY, TODAY)).toBe(0)
    expect(daysUntil('2026-10-01', TODAY)).toBe(-4)
  })
})

describe('acceptedRisks', () => {
  test('marks an acceptance current, expiring, or expired', () => {
    expect(acceptedRisks(allowlist('2026-12-05'), TODAY)[0].state).toBe('current')
    expect(acceptedRisks(allowlist('2026-10-12'), TODAY)[0].state).toBe('expiring')
    expect(acceptedRisks(allowlist('2026-10-04'), TODAY)[0].state).toBe('expired')
  })

  test(`starts warning ${EXPIRY_WARNING_DAYS} days out, not earlier`, () => {
    const atLimit = `2026-10-${String(5 + EXPIRY_WARNING_DAYS).padStart(2, '0')}`
    const pastLimit = `2026-10-${String(6 + EXPIRY_WARNING_DAYS).padStart(2, '0')}`
    expect(acceptedRisks(allowlist(atLimit), TODAY)[0].state).toBe('expiring')
    expect(acceptedRisks(allowlist(pastLimit), TODAY)[0].state).toBe('current')
  })

  test('fills absent optional fields with empty strings', () => {
    const text = JSON.stringify({ accepted: [{ id: 'GHSA-x', reviewBy: '2026-12-05' }] })
    expect(acceptedRisks(text, TODAY)[0]).toMatchObject({ package: '', severity: '' })
  })

  test.each([
    ['no file', ''],
    ['invalid JSON', '{'],
    ['no accepted list', JSON.stringify({})],
    ['a non-array accepted list', JSON.stringify({ accepted: {} })]
  ])('yields an empty register for %s', (_label, text) => {
    expect(acceptedRisks(text, TODAY)).toEqual([])
  })
})

describe('renderMarkdown', () => {
  const meta = { repository: 'ImmanuelN/artisanmarket-api', sha: '0123456789abcdef', ref: 'main', event: 'push', today: TODAY }

  test('states that every required control passed', () => {
    const md = renderMarkdown(evaluate(allPassing()), [], meta)
    expect(md).toContain('All 11 required controls passed')
    expect(md).toContain('`0123456`')
  })

  test('names how many failed and how many did not run', () => {
    const md = renderMarkdown(evaluate({ ...allPassing(), OUTCOME_SAST: 'failure', OUTCOME_DAST: 'skipped' }), [], meta)
    expect(md).toContain('Posture not satisfied: 1 failed, 1 did not run.')
    expect(md).toContain('| Code | Static analysis and quality gate | SonarQube (SonarCloud) | FAILED |')
  })

  test('names only the kind of problem that is present', () => {
    expect(renderMarkdown(evaluate({ ...allPassing(), OUTCOME_SAST: 'failure' }), [], meta)).toContain('1 failed.')
    expect(renderMarkdown(evaluate({ ...allPassing(), OUTCOME_SAST: 'skipped' }), [], meta)).toContain('1 did not run.')
  })

  test('labels optional controls as optional', () => {
    expect(renderMarkdown(evaluate(allPassing()), [], meta)).toContain('| Snyk | not run (optional) |')
  })

  test('carries the PCI DSS and GDPR alignment and the DAST caveat', () => {
    const md = renderMarkdown(evaluate(allPassing()), [], meta)
    expect(md).toContain('| 8.6.2 | Art. 32(1)(b) |')
    expect(md).toContain('does not satisfy, PCI DSS 6.4.2')
    expect(md).toContain('This is not a compliance attestation.')
  })

  test('explains what a failure on a scheduled run means', () => {
    const md = renderMarkdown(evaluate(allPassing()), [], { ...meta, event: 'schedule' })
    expect(md).toContain('scheduled re-verification of an unchanged commit')
  })

  test('says so when no risks are accepted', () => {
    expect(renderMarkdown(evaluate(allPassing()), [], meta)).toContain('currently accepting no advisories')
  })

  test('lists accepted risks with their remaining time', () => {
    const risks = [
      ...acceptedRisks(allowlist('2026-12-05'), TODAY),
      ...acceptedRisks(allowlist('2026-10-12'), TODAY),
      ...acceptedRisks(allowlist('2026-10-01'), TODAY)
    ]
    const md = renderMarkdown(evaluate(allPassing()), risks, meta)
    expect(md).toContain('61 days left')
    expect(md).toContain('**7 days left — review due**')
    expect(md).toContain('**expired 4 days ago**')
  })

  test('tolerates missing metadata', () => {
    const md = renderMarkdown(evaluate(allPassing()), [], { today: TODAY })
    expect(md).toContain('## Compliance report — repository @ ``')
    expect(md).toContain('Trigger: **unknown**')
  })
})

describe('annotations', () => {
  test('raises an error per failed control and a warning per control that did not run', () => {
    const out = annotations(evaluate({ ...allPassing(), OUTCOME_GITLEAKS: 'failure', OUTCOME_IAC: 'skipped' }), [])
    expect(out).toEqual([
      '::error::Code · Secret scanning (Gitleaks) failed.',
      '::warning::Build · Infrastructure-as-code scan (Checkov) did not run.'
    ])
  })

  test('raises an error for an expired acceptance and a warning for one due soon', () => {
    const risks = [
      ...acceptedRisks(allowlist('2026-10-01'), TODAY),
      ...acceptedRisks(allowlist('2026-10-12'), TODAY),
      ...acceptedRisks(allowlist('2026-12-05'), TODAY)
    ]
    const out = annotations(evaluate(allPassing()), risks)
    expect(out).toEqual([
      '::error::Accepted advisory GHSA-vfj7-8cjw-p6xm expired on 2026-10-01.',
      '::warning::Accepted advisory GHSA-vfj7-8cjw-p6xm is due for review by 2026-10-12.'
    ])
  })
})

describe('run — the workflow contract', () => {
  const harness = (env, files = {}) => {
    const written = {}
    const appended = {}
    const logged = []
    const io = {
      env,
      readFile: (p) => files[p],
      fileExists: (p) => p in files,
      writeFile: (p, s) => { written[p] = s },
      appendFile: (p, s) => { appended[p] = (appended[p] ?? '') + s },
      log: (l) => logged.push(l),
      today: TODAY
    }
    return { io, written, appended, logged }
  }

  test('exits 0, writes both report files and the job summary when everything passed', () => {
    const { io, written, appended, logged } = harness(
      { ...allPassing(), GITHUB_STEP_SUMMARY: '/summary', GITHUB_EVENT_NAME: 'push' },
      { '.audit-allowlist.json': allowlist('2026-12-05') }
    )
    expect(run(io)).toBe(0)
    expect(Object.keys(written).sort()).toEqual(['compliance-report.json', 'compliance-report.md'])
    expect(appended['/summary']).toBe(written['compliance-report.md'])
    expect(logged.at(-1)).toBe('Compliance posture: all required controls passed.')

    const record = JSON.parse(written['compliance-report.json'])
    expect(record.verdict).toBe('pass')
    expect(record.controls).toHaveLength(CONTROLS.length)
    expect(record.acceptedRisks[0].id).toBe('GHSA-vfj7-8cjw-p6xm')
  })

  test('exits 1 when the posture is not satisfied', () => {
    const { io, logged } = harness({ ...allPassing(), OUTCOME_SCA: 'failure' })
    expect(run(io)).toBe(1)
    expect(logged).toContain('::error::Code · Dependency audit (npm audit + audit gate) failed.')
    expect(logged.at(-1)).toBe('Compliance posture: not satisfied.')
  })

  test('skips the job summary when not running in Actions', () => {
    const { io, appended } = harness(allPassing())
    run(io)
    expect(appended).toEqual({})
  })

  test('reads the allowlist from ALLOWLIST_PATH when it is set', () => {
    const { io, written } = harness(
      { ...allPassing(), ALLOWLIST_PATH: 'custom.json' },
      { 'custom.json': allowlist('2026-12-05') }
    )
    run(io)
    expect(JSON.parse(written['compliance-report.json']).acceptedRisks).toHaveLength(1)
  })

  test('reports no accepted risks when there is no allowlist file', () => {
    const { io, written } = harness(allPassing())
    run(io)
    expect(JSON.parse(written['compliance-report.json']).acceptedRisks).toEqual([])
  })
})
