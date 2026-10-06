import { parseModel, collectThreats, evaluate, render, run } from '../scripts/threat-model-gate.js'

/**
 * The Plan-stage gate replaced a check that passed on any file named
 * docs/threat-model.md, including an empty one. The cases that matter are the
 * ones where it must NOT pass: an empty model, an open High threat, a closed
 * threat that does not say how, and a status it does not recognise.
 */

const threat = (overrides) => ({
  number: 1,
  title: 'Example threat',
  status: 'Mitigated',
  severity: 'High',
  type: 'Tampering',
  mitigation: 'Blocked by the Code-stage ruleset.',
  ...overrides
})

/** A minimal Threat Dragon v2 model with the given threats on one element. */
const model = (threats, extraCells = []) => ({
  version: '2.6.2',
  summary: { title: 'Test model' },
  detail: {
    diagrams: [
      {
        title: 'Main',
        cells: [
          { data: { type: 'tm.BoundaryBox', name: 'Boundary' } },
          { data: { type: 'tm.Process', name: 'React SPA', threats } },
          ...extraCells
        ]
      }
    ]
  }
})

describe('parseModel', () => {
  test.each([
    ['empty text', ''],
    ['whitespace', '  \n'],
    ['undefined', undefined]
  ])('rejects %s', (_label, text) => {
    expect(() => parseModel(text)).toThrow(/empty/)
  })

  test('rejects invalid JSON', () => {
    expect(() => parseModel('{')).toThrow(/not valid JSON/)
  })

  test('rejects JSON that is not a Threat Dragon model', () => {
    expect(() => parseModel(JSON.stringify({ summary: {} }))).toThrow(/detail\.diagrams/)
  })

  test('accepts a Threat Dragon model', () => {
    expect(parseModel(JSON.stringify(model([]))).summary.title).toBe('Test model')
  })
})

describe('collectThreats', () => {
  test('gathers threats from every element of every diagram, ordered by number', () => {
    const m = model([threat({ number: 3 })], [{ data: { type: 'tm.Flow', name: 'API requests', threats: [threat({ number: 1 })] } }])
    m.detail.diagrams.push({ title: 'Second', cells: [{ data: { name: 'Store', threats: [threat({ number: 2 })] } }] })
    const found = collectThreats(m)
    expect(found.map((t) => t.number)).toEqual([1, 2, 3])
    expect(found.map((t) => t.element)).toEqual(['API requests', 'Store', 'React SPA'])
    expect(found[1].diagram).toBe('Second')
  })

  test('tolerates diagrams and cells with nothing in them', () => {
    const m = { detail: { diagrams: [{ cells: [{}, { data: {} }] }, {}] } }
    expect(collectThreats(m)).toEqual([])
  })

  test('falls back to the element type, then a placeholder, when an element has no name', () => {
    const m = { detail: { diagrams: [{ cells: [{ data: { type: 'tm.Store', threats: [threat()] } }, { data: { threats: [threat({ number: 2 })] } }] }] } }
    expect(collectThreats(m).map((t) => t.element)).toEqual(['tm.Store', 'unnamed element'])
    expect(collectThreats(m)[0].diagram).toBe('untitled diagram')
  })

  test('orders threats without a number first', () => {
    const m = model([threat({ number: 2 }), threat({ number: undefined, title: 'unnumbered' })])
    expect(collectThreats(m)[0].title).toBe('unnumbered')
  })
})

describe('evaluate', () => {
  test('passes a model whose threats are all mitigated with a stated mitigation', () => {
    const r = evaluate([threat(), threat({ number: 2, severity: 'Medium' })])
    expect(r.failed).toBe(false)
  })

  test('fails an empty model: modelling that has not been done', () => {
    const r = evaluate([])
    expect(r.empty).toBe(true)
    expect(r.failed).toBe(true)
  })

  test.each(['High', 'Critical', 'high', 'CRITICAL'])('blocks an open %s threat', (severity) => {
    const r = evaluate([threat({ status: 'Open', severity })])
    expect(r.failed).toBe(true)
    expect(r.blocking).toHaveLength(1)
  })

  test.each(['Medium', 'Low', 'TBD', ''])('records but does not block an open %p threat', (severity) => {
    const r = evaluate([threat({ status: 'Open', severity })])
    expect(r.failed).toBe(false)
    expect(r.openNonBlocking).toHaveLength(1)
  })

  test.each(['Mitigated', 'Accepted'])('fails a %s threat that does not say how', (status) => {
    for (const mitigation of ['', '   ', undefined]) {
      const r = evaluate([threat({ status, mitigation })])
      expect(r.failed).toBe(true)
      expect(r.incomplete).toHaveLength(1)
    }
  })

  test('lists accepted threats so the acceptance stays visible', () => {
    const r = evaluate([threat({ status: 'Accepted', title: 'Token in localStorage' })])
    expect(r.failed).toBe(false)
    expect(r.accepted.map((t) => t.title)).toEqual(['Token in localStorage'])
  })

  test.each(['NotApplicable', 'Not Applicable', 'not_applicable'])('ignores a threat ruled %p', (status) => {
    const r = evaluate([threat({ status, severity: 'High', mitigation: '' })])
    expect(r.failed).toBe(false)
    expect(r.blocking).toHaveLength(0)
  })

  test('treats an unrecognised or missing status as open, so it cannot hide a High threat', () => {
    expect(evaluate([threat({ status: 'In review' })]).blocking).toHaveLength(1)
    expect(evaluate([threat({ status: undefined })]).blocking).toHaveLength(1)
  })
})

describe('render', () => {
  test('annotates blocking, incomplete and empty results as errors', () => {
    const r = evaluate([
      threat({ status: 'Open', title: 'XSS' }),
      threat({ number: 2, status: 'Mitigated', mitigation: '', title: 'Secrets' })
    ])
    const text = render(r, 'M').join('\n')
    expect(text).toContain('::error::Open High threat blocks the Plan stage: #1 XSS [High]')
    expect(text).toContain('::error::Threat marked Mitigated without a mitigation: #2 Secrets')
    expect(text).toContain('threat model gate FAILED')
    expect(render(evaluate([]), 'M').join('\n')).toContain('contains no threats')
  })

  test('warns on open non-blocking threats and lists accepted risks', () => {
    const r = evaluate(
      collectThreats(
        model([
          threat({ status: 'Open', severity: 'Medium', title: 'Headers' }),
          threat({ number: 2, status: 'Accepted', title: 'Token' })
        ])
      )
    )
    const lines = render(r, 'Client model')
    expect(lines[0]).toBe('Threat model: Client model — 2 threat(s)')
    expect(lines).toContain('::warning::Open threat, recorded and not blocking: #1 Headers [Medium] — React SPA')
    expect(lines).toContain('  #2 Token [High] — React SPA')
    expect(lines.at(-1)).toMatch(/^Plan stage: no High or Critical threat is open/)
  })

  test('copes with missing titles, numbers and severities', () => {
    const lines = render(evaluate([{ status: 'Open', element: 'X' }]), undefined)
    expect(lines[0]).toBe('Threat model: untitled — 1 threat(s)')
    expect(lines).toContain('::warning::Open threat, recorded and not blocking: #? untitled threat [no severity] — X')
  })
})

describe('run — the workflow contract', () => {
  const harness = (files) => {
    const logged = []
    return { io: { readFile: (p) => { if (!(p in files)) throw new Error(`ENOENT: ${p}`); return files[p] }, log: (l) => logged.push(l) }, logged }
  }

  test('exits 0 for a model that passes, reading docs/threat-model.json by default', () => {
    const { io } = harness({ 'docs/threat-model.json': JSON.stringify(model([threat()])) })
    expect(run([], io)).toBe(0)
  })

  test('exits 1 when the gate fails', () => {
    const { io } = harness({ 'm.json': JSON.stringify(model([threat({ status: 'Open' })])) })
    expect(run(['m.json'], io)).toBe(1)
  })

  test('exits 2 when the model is missing or unreadable', () => {
    const { io, logged } = harness({ 'bad.json': '{' })
    expect(run(['missing.json'], io)).toBe(2)
    expect(run(['bad.json'], io)).toBe(2)
    expect(logged[0]).toMatch(/^::error::threat-model-gate: missing\.json/)
  })
})
