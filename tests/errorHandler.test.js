import { jest } from '@jest/globals'
import { errorHandler } from '../middleware/errorHandler.js'

/**
 * The error handler previously wrote req.headers and req.body straight to the
 * log, which put Authorization tokens and raw passwords into log output, and
 * interpolated request values unescaped, which allowed forged log lines.
 *
 * These tests assert both properties. See docs/evidence/finding-ledger.md.
 */

const makeRes = () => {
  const res = {}
  res.status = jest.fn().mockReturnValue(res)
  res.json = jest.fn().mockReturnValue(res)
  return res
}

const makeReq = (overrides = {}) => ({
  method: 'POST',
  path: '/api/auth/login',
  headers: {},
  body: {},
  ...overrides
})

describe('errorHandler — credential redaction', () => {
  let logged

  beforeEach(() => {
    logged = []
    jest.spyOn(console, 'error').mockImplementation((...args) => {
      logged.push(args.map(String).join(' '))
    })
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  const run = (req) => errorHandler(new Error('boom'), req, makeRes(), () => {})

  test('never writes the Authorization header to the log', () => {
    run(makeReq({ headers: { authorization: 'Bearer super-secret-token' } }))
    const all = logged.join('\n')
    expect(all).not.toContain('super-secret-token')
    expect(all).toContain('[REDACTED]')
  })

  test('never writes a cookie header to the log', () => {
    run(makeReq({ headers: { cookie: 'session=abcdef123456' } }))
    expect(logged.join('\n')).not.toContain('abcdef123456')
  })

  test('never writes a password from the request body', () => {
    run(makeReq({ body: { email: 'a@b.com', password: 'hunter2-plaintext' } }))
    const all = logged.join('\n')
    expect(all).not.toContain('hunter2-plaintext')
    expect(all).toContain('[REDACTED]')
  })

  test('never writes card details from the request body', () => {
    run(makeReq({ body: { cardNumber: '4111111111111111', cvv: '123' } }))
    const all = logged.join('\n')
    expect(all).not.toContain('4111111111111111')
    expect(all).not.toContain('"123"')
  })

  test('keeps non-sensitive fields so the log is still useful', () => {
    run(makeReq({ body: { email: 'shopper@example.com', password: 'x' } }))
    expect(logged.join('\n')).toContain('shopper@example.com')
  })
})

describe('errorHandler — log injection', () => {
  let logged

  beforeEach(() => {
    logged = []
    jest.spyOn(console, 'error').mockImplementation((...args) => {
      logged.push(args.map(String).join(' '))
    })
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  test('a CRLF payload in the path cannot introduce a new log line', () => {
    errorHandler(
      new Error('boom'),
      makeReq({ path: '/api/x\r\n[CRITICAL] fabricated entry' }),
      makeRes(),
      () => {}
    )
    const pathLine = logged.find((l) => l.includes('Error in'))
    expect(pathLine).toBeDefined()
    expect(pathLine).not.toContain('\n')
    expect(pathLine).not.toContain('\r')
  })

  test('a CRLF payload in the error message is neutralised too', () => {
    const err = new Error('failed\r\n[INFO] all clear')
    errorHandler(err, makeReq(), makeRes(), () => {})
    const messageLine = logged.find((l) => l.includes('Error message'))
    expect(messageLine).not.toContain('\n')
  })
})

describe('errorHandler — response behaviour', () => {
  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  test('responds with a status and a JSON body', () => {
    const res = makeRes()
    errorHandler(new Error('boom'), makeReq(), res, () => {})
    expect(res.status).toHaveBeenCalled()
    expect(res.json).toHaveBeenCalled()
  })

  test('uses a distinct correlation id per invocation', () => {
    const seen = new Set()
    const captured = []
    jest.spyOn(console, 'error').mockImplementation((...args) => {
      captured.push(args.map(String).join(' '))
    })
    for (let i = 0; i < 5; i += 1) {
      errorHandler(new Error('boom'), makeReq(), makeRes(), () => {})
    }
    for (const line of captured) {
      const match = line.match(/\[([0-9a-f-]{36})\]/)
      if (match) seen.add(match[1])
    }
    // UUID v4 format, and different on each call — a predictable id would repeat.
    expect(seen.size).toBe(5)
  })
})
