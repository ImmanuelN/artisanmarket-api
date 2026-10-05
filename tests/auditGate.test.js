import {
  advisoryId,
  parseReport,
  parseAllowlist,
  rootAdvisories,
  evaluate,
  render,
  run
} from '../scripts/audit-gate.js'

/**
 * The dependency gate decides whether a build may ship, so the cases that matter
 * most are the ones where it must NOT pass: unlisted findings, expired or stale
 * acceptances, and — because the pipeline discards npm audit's exit code —
 * output that is empty, malformed or an error rather than a report.
 */

const BRACES = 'GHSA-vfj7-8cjw-p6xm'
const OTHER = 'GHSA-aaaa-bbbb-cccc'
const TODAY = '2026-10-05'

const advisory = (id, severity = 'high') => ({
  url: `https://github.com/advisories/${id}`,
  title: `advisory ${id}`,
  severity
})

/** braces is vulnerable itself; micromatch and jest are affected through it. */
const bracesTree = () => ({
  vulnerabilities: {
    braces: { severity: 'high', via: [advisory(BRACES)] },
    micromatch: { severity: 'high', via: ['braces'] },
    jest: { severity: 'high', via: ['micromatch'] }
  },
  metadata: { vulnerabilities: { critical: 0, high: 3, moderate: 0 } }
})

const accept = (id, reviewBy = '2026-12-05') => ({
  id,
  reason: 'no released fix; dev-only',
  acceptedOn: '2026-10-05',
  reviewBy
})

describe('advisoryId', () => {
  test('extracts the GHSA identifier from an advisory URL', () => {
    expect(advisoryId(`https://github.com/advisories/${BRACES}`)).toBe(BRACES)
  })

  test('falls back to the URL when it carries no GHSA identifier', () => {
    expect(advisoryId('https://example.test/advisory/1')).toBe('https://example.test/advisory/1')
  })

  test('reports unknown when there is no URL at all', () => {
    expect(advisoryId(undefined)).toBe('unknown')
  })
})

describe('parseReport — fails closed', () => {
  test.each([
    ['empty output', ''],
    ['whitespace only', '   \n'],
    ['undefined', undefined]
  ])('rejects %s rather than treating it as a clean tree', (_label, text) => {
    expect(() => parseReport(text)).toThrow(/no output/)
  })

  test('rejects output that is not JSON', () => {
    expect(() => parseReport('npm ERR! network')).toThrow(/not valid JSON/)
  })

  test('rejects an npm error object, such as a registry outage', () => {
    const text = JSON.stringify({ error: { code: 'ENOTFOUND', summary: 'registry unreachable' } })
    expect(() => parseReport(text)).toThrow(/registry unreachable/)
  })

  test('rejects an error object that has no summary', () => {
    expect(() => parseReport(JSON.stringify({ error: { code: 'E500' } }))).toThrow(/E500/)
  })

  test('rejects a JSON body with no vulnerabilities field', () => {
    expect(() => parseReport(JSON.stringify({ auditReportVersion: 2 }))).toThrow(/no "vulnerabilities"/)
  })

  test('accepts a real report', () => {
    expect(parseReport(JSON.stringify(bracesTree())).vulnerabilities.braces).toBeDefined()
  })
})

describe('parseAllowlist — an acceptance must be accountable', () => {
  test('accepts a complete entry', () => {
    const text = JSON.stringify({ accepted: [accept(BRACES)] })
    expect(parseAllowlist(text)).toHaveLength(1)
  })

  test('treats a file with no accepted list as empty', () => {
    expect(parseAllowlist(JSON.stringify({ $comment: 'none yet' }))).toEqual([])
  })

  test('rejects invalid JSON', () => {
    expect(() => parseAllowlist('{')).toThrow(/not valid JSON/)
  })

  test('rejects a non-array accepted field', () => {
    expect(() => parseAllowlist(JSON.stringify({ accepted: {} }))).toThrow(/must be an array/)
  })

  test.each([
    ['no review date', { id: BRACES, reason: 'x' }, /reviewBy/],
    ['a malformed review date', { id: BRACES, reason: 'x', reviewBy: 'next month' }, /reviewBy/],
    ['no reason', { id: BRACES, reviewBy: '2026-12-05' }, /reason/],
    ['a blank reason', { id: BRACES, reason: '  ', reviewBy: '2026-12-05' }, /reason/],
    ['an id that is not a GHSA', { id: 'braces', reason: 'x', reviewBy: '2026-12-05' }, /GHSA/]
  ])('rejects an entry with %s', (_label, entry, pattern) => {
    expect(() => parseAllowlist(JSON.stringify({ accepted: [entry] }))).toThrow(pattern)
  })
})

describe('rootAdvisories', () => {
  test('follows package names through to the advisory that causes them', () => {
    const roots = rootAdvisories('jest', bracesTree().vulnerabilities)
    expect(roots.map((r) => r.id)).toEqual([BRACES])
  })

  test('terminates on a dependency cycle', () => {
    const vulns = {
      a: { severity: 'high', via: ['b'] },
      b: { severity: 'high', via: ['a'] }
    }
    expect(rootAdvisories('a', vulns)).toEqual([])
  })

  test('ignores via entries that are neither names nor advisories', () => {
    const vulns = { a: { severity: 'high', via: [null, {}] } }
    expect(rootAdvisories('a', vulns)).toEqual([])
  })

  test('returns nothing for a package not in the report', () => {
    expect(rootAdvisories('absent', {})).toEqual([])
  })
})

describe('evaluate', () => {
  test('passes a tree with no findings', () => {
    const result = evaluate({ vulnerabilities: {} }, [], { today: TODAY })
    expect(result.failed).toBe(false)
  })

  test('blocks an unlisted high-severity finding', () => {
    const result = evaluate(bracesTree(), [], { today: TODAY })
    expect(result.failed).toBe(true)
    expect(result.blocking.map((b) => b.name)).toEqual(['braces', 'micromatch', 'jest'])
  })

  test('ignores findings below the threshold', () => {
    const report = { vulnerabilities: { uuid: { severity: 'moderate', via: [advisory(OTHER, 'moderate')] } } }
    expect(evaluate(report, [], { today: TODAY }).failed).toBe(false)
  })

  test('applies a lower threshold when one is asked for', () => {
    const report = { vulnerabilities: { uuid: { severity: 'moderate', via: [advisory(OTHER, 'moderate')] } } }
    expect(evaluate(report, [], { minLevel: 'moderate', today: TODAY }).failed).toBe(true)
  })

  test('treats an unrecognised severity as below every threshold', () => {
    const report = { vulnerabilities: { odd: { severity: 'weird', via: [advisory(OTHER)] } } }
    expect(evaluate(report, [], { minLevel: 'low', today: TODAY }).failed).toBe(false)
  })

  test('rejects an unknown threshold rather than guessing', () => {
    expect(() => evaluate(bracesTree(), [], { minLevel: 'severe', today: TODAY })).toThrow(/unknown level/)
  })

  test('accepting the root advisory covers every package downstream of it', () => {
    const result = evaluate(bracesTree(), [accept(BRACES)], { today: TODAY })
    expect(result.failed).toBe(false)
    expect(result.accepted).toHaveLength(1)
    expect(result.accepted[0].packages).toEqual(['braces', 'jest', 'micromatch'])
  })

  test('still blocks a different advisory when one is accepted', () => {
    const report = bracesTree()
    report.vulnerabilities.lodash = { severity: 'critical', via: [advisory(OTHER, 'critical')] }
    const result = evaluate(report, [accept(BRACES)], { today: TODAY })
    expect(result.failed).toBe(true)
    expect(result.blocking.map((b) => b.id)).toEqual([OTHER])
  })

  test('fails once an acceptance passes its review date', () => {
    const result = evaluate(bracesTree(), [accept(BRACES, '2026-10-04')], { today: TODAY })
    expect(result.failed).toBe(true)
    expect(result.accepted[0].expired).toBe(true)
  })

  test('still passes on the review date itself', () => {
    const result = evaluate(bracesTree(), [accept(BRACES, TODAY)], { today: TODAY })
    expect(result.failed).toBe(false)
  })

  test('fails on an allowlist entry that no longer matches anything', () => {
    const result = evaluate(bracesTree(), [accept(BRACES), accept(OTHER)], { today: TODAY })
    expect(result.failed).toBe(true)
    expect(result.stale.map((s) => s.id)).toEqual([OTHER])
  })

  test('blocks a finding whose advisory cannot be resolved', () => {
    const report = { vulnerabilities: { mystery: { severity: 'high', via: [] } } }
    const result = evaluate(report, [], { today: TODAY })
    expect(result.failed).toBe(true)
    expect(result.blocking[0].id).toBe('unresolved')
  })
})

describe('render', () => {
  test('prints each acceptance with its reason, so it is visible in every run', () => {
    const lines = render(evaluate(bracesTree(), [accept(BRACES)], { today: TODAY }))
    const text = lines.join('\n')
    expect(text).toContain(BRACES)
    expect(text).toContain('no released fix; dev-only')
    expect(text).toContain('review by: 2026-12-05')
    expect(text).toContain('Dependency audit passed at high+')
  })

  test('raises a workflow error annotation for an expired acceptance', () => {
    const lines = render(evaluate(bracesTree(), [accept(BRACES, '2026-01-01')], { today: TODAY }))
    expect(lines.some((l) => l.includes('::error::') && l.includes('2026-01-01'))).toBe(true)
    expect(lines.join('\n')).not.toContain('passed')
  })

  test('lists stale entries for removal', () => {
    const lines = render(evaluate(bracesTree(), [accept(BRACES), accept(OTHER)], { today: TODAY }))
    expect(lines.join('\n')).toContain(`${OTHER}  (no released fix; dev-only)`)
  })

  test('lists blocking findings with their advisory links', () => {
    const lines = render(evaluate(bracesTree(), [], { today: TODAY }))
    const text = lines.join('\n')
    expect(text).toContain('Blocking advisories at high or above (3)')
    expect(text).toContain(`https://github.com/advisories/${BRACES}`)
  })

  test('copes with an acceptance that records no severity, title or acceptance date', () => {
    const result = {
      accepted: [{ id: BRACES, packages: ['braces'], expired: false, acceptance: { reason: 'r', reviewBy: '2027-01-01' } }],
      blocking: [{ name: 'x', id: 'unresolved' }],
      stale: [],
      failed: true
    }
    const text = render(result).join('\n')
    expect(text).toContain('[unknown]')
    expect(text).toContain('accepted:  unrecorded')
  })

  test('reports zero counts when the report carries no metadata', () => {
    const lines = render({ accepted: [], blocking: [], stale: [], failed: false })
    expect(lines).toEqual(['Dependency audit passed at high+ (critical 0, high 0, moderate 0).'])
  })
})

describe('run — the command-line contract', () => {
  /** Build an injected filesystem and capture what the gate logs. */
  const harness = (files) => {
    const logged = []
    const io = {
      readFile: (p) => {
        if (!(p in files)) throw new Error(`ENOENT: ${p}`)
        return files[p]
      },
      fileExists: (p) => p in files,
      log: (line) => logged.push(line),
      today: TODAY
    }
    return { io, logged }
  }

  test('exits 0 when every finding is accepted and current', () => {
    const { io } = harness({
      'audit.json': JSON.stringify(bracesTree()),
      '.audit-allowlist.json': JSON.stringify({ accepted: [accept(BRACES)] })
    })
    expect(run(['audit.json'], io)).toBe(0)
  })

  test('exits 1 when the gate fails', () => {
    const { io } = harness({ 'audit.json': JSON.stringify(bracesTree()) })
    expect(run(['audit.json'], io)).toBe(1)
  })

  test('treats a missing allowlist file as accepting nothing', () => {
    const { io, logged } = harness({ 'audit.json': JSON.stringify(bracesTree()) })
    run(['audit.json'], io)
    expect(logged.join('\n')).toContain('Blocking advisories')
  })

  test('exits 2 on unusable npm output, so a registry outage cannot pass the gate', () => {
    const { io, logged } = harness({ 'audit.json': '' })
    expect(run(['audit.json'], io)).toBe(2)
    expect(logged.join('\n')).toContain('no output')
  })

  test('exits 2 when the report file is missing', () => {
    const { io } = harness({})
    expect(run(['audit.json'], io)).toBe(2)
  })

  test('exits 2 with usage when no report path is given', () => {
    const { io, logged } = harness({})
    expect(run(['--level=high'], io)).toBe(2)
    expect(logged[0]).toMatch(/^Usage:/)
  })

  test('honours --level and --allowlist', () => {
    const report = { vulnerabilities: { uuid: { severity: 'moderate', via: [advisory(OTHER, 'moderate')] } } }
    const { io } = harness({
      'audit.json': JSON.stringify(report),
      'custom.json': JSON.stringify({ accepted: [accept(OTHER)] })
    })
    expect(run(['audit.json', '--level=moderate'], io)).toBe(1)
    expect(run(['audit.json', '--level=moderate', '--allowlist=custom.json'], io)).toBe(0)
  })
})
