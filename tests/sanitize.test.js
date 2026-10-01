import {
  asString,
  asEnum,
  asPositiveInt,
  asSafeSearchRegex,
  forLog,
  pickFields
} from '../utils/sanitize.js'

/**
 * These are security-control tests, not coverage filler. Each one asserts the
 * property that makes the corresponding SonarQube finding non-exploitable, so a
 * regression that reintroduces the vulnerability fails here rather than only
 * being re-reported by the scanner.
 *
 * See docs/evidence/finding-ledger.md for the original findings.
 */

describe('asString — NoSQL operator injection (jssecurity:S5147, threat T1)', () => {
  test('passes plain strings through', () => {
    expect(asString('artisan')).toBe('artisan')
    expect(asString('')).toBe('')
  })

  test('coerces scalars a query can safely use', () => {
    expect(asString(42)).toBe('42')
    expect(asString(true)).toBe('true')
  })

  test('rejects the operator objects Express builds from ?field[$ne]=x', () => {
    expect(asString({ $ne: null })).toBeUndefined()
    expect(asString({ $gt: '' })).toBeUndefined()
    expect(asString({ $where: 'return true' })).toBeUndefined()
  })

  test('rejects arrays, which Express builds from repeated query keys', () => {
    expect(asString(['a', 'b'])).toBeUndefined()
  })

  test('rejects null and undefined rather than stringifying them', () => {
    expect(asString(null)).toBeUndefined()
    expect(asString(undefined)).toBeUndefined()
  })

  test('never yields "[object Object]", which would silently match nothing', () => {
    expect(asString({ a: 1 })).not.toBe('[object Object]')
  })
})

describe('asEnum — constrains a filter to known values', () => {
  const STATUSES = ['pending', 'processing', 'shipped']

  test('allows a member of the set', () => {
    expect(asEnum('shipped', STATUSES)).toBe('shipped')
  })

  test('rejects a value outside the set', () => {
    expect(asEnum('deleted', STATUSES)).toBeUndefined()
  })

  test('rejects an injected operator object', () => {
    expect(asEnum({ $ne: null }, STATUSES)).toBeUndefined()
  })
})

describe('asPositiveInt — pagination bounds', () => {
  test('parses a normal value', () => {
    expect(asPositiveInt('5')).toBe(5)
  })

  test('falls back when unparseable', () => {
    expect(asPositiveInt('abc', { fallback: 1 })).toBe(1)
    expect(asPositiveInt(undefined, { fallback: 7 })).toBe(7)
  })

  test('clamps below the minimum, so a negative skip cannot be requested', () => {
    expect(asPositiveInt('-10', { min: 1 })).toBe(1)
  })

  test('clamps above the maximum, so one request cannot ask for the whole table', () => {
    expect(asPositiveInt('999999', { max: 100 })).toBe(100)
  })
})

describe('asSafeSearchRegex — ReDoS and regex injection (jssecurity:S2631)', () => {
  test('escapes every metacharacter so the term matches literally', () => {
    expect(asSafeSearchRegex('(a+)+').$regex).toBe('\\(a\\+\\)\\+')
    expect(asSafeSearchRegex('a.b*c').$regex).toBe('a\\.b\\*c')
  })

  test('produces a case-insensitive clause', () => {
    expect(asSafeSearchRegex('mug').$options).toBe('i')
  })

  test('the escaped pattern is safe to compile and run against a hostile input', () => {
    const { $regex } = asSafeSearchRegex('(a+)+$')
    const compiled = new RegExp($regex)
    const hostile = 'a'.repeat(40000)
    const started = Date.now()
    compiled.test(hostile)
    // Catastrophic backtracking would take seconds or hang; a literal match is
    // linear. A generous bound still fails loudly if the escaping regresses.
    expect(Date.now() - started).toBeLessThan(1000)
  })

  test('caps the length so a huge term cannot be submitted', () => {
    expect(asSafeSearchRegex('x'.repeat(5000)).$regex.length).toBeLessThanOrEqual(100)
  })

  test('returns undefined for empty or non-string input, so the clause is omitted', () => {
    expect(asSafeSearchRegex('')).toBeUndefined()
    expect(asSafeSearchRegex('   ')).toBeUndefined()
    expect(asSafeSearchRegex({ $ne: null })).toBeUndefined()
    expect(asSafeSearchRegex(undefined)).toBeUndefined()
  })
})

describe('forLog — log injection (jssecurity:S5145)', () => {
  test('strips CR and LF so a caller cannot forge a log line', () => {
    const forged = 'ok\r\n[ADMIN] deleted everything'
    const logged = forLog(forged)
    expect(logged).not.toContain('\n')
    expect(logged).not.toContain('\r')
  })

  test('strips other control characters', () => {
    expect(forLog('a\u0000b\u001Bc')).not.toMatch(/[\u0000-\u001F]/)
  })

  test('serialises objects to a single line rather than [object Object]', () => {
    expect(forLog({ user: 'x' })).toBe('{"user":"x"}')
  })

  test('survives a circular object instead of throwing inside the logger', () => {
    const circular = {}
    circular.self = circular
    expect(() => forLog(circular)).not.toThrow()
    expect(forLog(circular)).toBe('[unserialisable]')
  })

  test('truncates so one request cannot flood the log', () => {
    const logged = forLog('y'.repeat(5000))
    expect(logged.length).toBeLessThan(600)
    expect(logged).toContain('[truncated]')
  })

  test('renders a symbol without throwing', () => {
    // Symbols throw on implicit string conversion, so forLog must convert
    // explicitly or a logging call could crash the request it is describing.
    expect(() => forLog(Symbol('trace-id'))).not.toThrow()
    expect(forLog(Symbol('trace-id'))).toContain('trace-id')
  })

  test('renders null and undefined readably', () => {
    expect(forLog(null)).toBe('null')
    expect(forLog(undefined)).toBe('undefined')
  })
})

describe('pickFields — mass assignment (jssecurity:S4684)', () => {
  const ALLOWED = ['storeName', 'slogan']

  test('keeps allowed fields', () => {
    expect(pickFields({ storeName: 'Kiln', slogan: 'Handmade' }, ALLOWED))
      .toEqual({ storeName: 'Kiln', slogan: 'Handmade' })
  })

  test('drops fields outside the allow-list — the actual exploit', () => {
    const malicious = {
      storeName: 'Kiln',
      verification: { isVerified: true },
      financials: { availableBalance: 1000000 }
    }
    const picked = pickFields(malicious, ALLOWED)
    expect(picked).toEqual({ storeName: 'Kiln' })
    expect(picked.verification).toBeUndefined()
    expect(picked.financials).toBeUndefined()
  })

  test('omits absent keys rather than setting them undefined', () => {
    expect(pickFields({ storeName: 'Kiln' }, ALLOWED)).not.toHaveProperty('slogan')
  })

  test('does not inherit from the prototype chain', () => {
    const proto = { slogan: 'inherited' }
    const obj = Object.create(proto)
    obj.storeName = 'Kiln'
    expect(pickFields(obj, ALLOWED)).toEqual({ storeName: 'Kiln' })
  })

  test('handles non-object input safely', () => {
    expect(pickFields(null, ALLOWED)).toEqual({})
    expect(pickFields('nope', ALLOWED)).toEqual({})
  })
})
