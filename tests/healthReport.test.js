import {
  formatUptime,
  formatHealthLines,
  healthWarnings,
  MEMORY_WARN_MB,
  HEALTHY_DB_STATUS
} from '../utils/healthReport.js'

/**
 * These assert the sanitisation that `monitor-server.js` could not be tested
 * for, because that module starts a timer at import. The log-injection cases are
 * the point (jssecurity:S5145): the health payload is supplied by the monitored
 * service, so a newline in any field must not be able to forge a log line.
 */

describe('formatUptime', () => {
  test.each([
    [0, '0m 0s'],
    [59, '0m 59s'],
    [60, '1m 0s'],
    [3661, '61m 1s']
  ])('renders %s seconds as %s', (input, expected) => {
    expect(formatUptime(input)).toBe(expected)
  })

  test.each([
    ['a missing field', undefined],
    ['a null', null],
    ['a string', '600'],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['a negative', -1]
  ])('degrades to "unknown" for %s rather than rendering NaN', (_label, input) => {
    expect(formatUptime(input)).toBe('unknown')
  })
})

describe('formatHealthLines', () => {
  const healthy = { uptime: 125, memory: { used: 210 }, database: { mongodb: 'connected' } }

  test('renders the expected four lines', () => {
    expect(formatHealthLines(healthy)).toEqual([
      '📊 Detailed health check:',
      '   Uptime: 2m 5s',
      '   Memory: 210MB used',
      '   Database: connected'
    ])
  })

  test.each([
    ['undefined', undefined],
    ['an empty object', {}],
    ['null members', { memory: null, database: null }]
  ])('does not throw on %s, and reports unknown', (_label, input) => {
    const lines = formatHealthLines(input)
    expect(lines).toHaveLength(4)
    expect(lines[2]).toBe('   Memory: unknownMB used')
    expect(lines[3]).toBe('   Database: unknown')
  })

  test('a newline in a field cannot forge a second log line', () => {
    const lines = formatHealthLines({
      database: { mongodb: 'connected\n🚨 SERVER APPEARS TO BE DOWN' }
    })
    const dbLine = lines[3]
    expect(dbLine).not.toContain('\n')
    expect(dbLine).not.toContain('\r')
    // The text survives — it is neutralised, not dropped, so the attempt stays
    // visible to whoever reads the log.
    expect(dbLine).toContain('SERVER APPEARS TO BE DOWN')
  })

  test('a carriage return in the memory field is stripped', () => {
    const [, , memLine] = formatHealthLines({ memory: { used: '1\r\n   Memory: 0' } })
    expect(memLine).not.toMatch(/[\r\n]/)
  })
})

describe('healthWarnings', () => {
  test.each([
    ['undefined', undefined],
    ['null', null]
  ])('does not throw on %s, and still reports the database as a problem', (_label, input) => {
    // A monitor that crashes on a malformed payload stops reporting entirely,
    // which is the worst outcome for the one process watching for failure.
    const warnings = healthWarnings(input)
    expect(warnings.some((w) => w.includes('Database issue'))).toBe(true)
  })

  test('is empty when the service is healthy', () => {
    expect(
      healthWarnings({ memory: { used: 10 }, database: { mongodb: HEALTHY_DB_STATUS } })
    ).toEqual([])
  })

  test(`warns above ${MEMORY_WARN_MB}MB and not at the threshold itself`, () => {
    const at = healthWarnings({
      memory: { used: MEMORY_WARN_MB },
      database: { mongodb: HEALTHY_DB_STATUS }
    })
    const over = healthWarnings({
      memory: { used: MEMORY_WARN_MB + 1 },
      database: { mongodb: HEALTHY_DB_STATUS }
    })
    expect(at).toEqual([])
    expect(over).toHaveLength(1)
    expect(over[0]).toContain('High memory usage')
  })

  test('warns on any database status other than connected', () => {
    const [warning] = healthWarnings({ database: { mongodb: 'disconnected' } })
    expect(warning).toContain('Database issue')
    expect(warning).toContain('disconnected')
  })

  test('treats a missing database status as a problem rather than assuming health', () => {
    expect(healthWarnings({}).some((w) => w.includes('Database issue'))).toBe(true)
  })

  test('reports both problems at once, in report order', () => {
    const warnings = healthWarnings({
      memory: { used: MEMORY_WARN_MB + 500 },
      database: { mongodb: 'down' }
    })
    expect(warnings).toHaveLength(2)
    expect(warnings[0]).toContain('High memory usage')
    expect(warnings[1]).toContain('Database issue')
  })

  test('a newline in the database status cannot forge a log line', () => {
    const [warning] = healthWarnings({ database: { mongodb: 'down\n✅ all clear' } })
    expect(warning).not.toMatch(/[\r\n]/)
  })
})
