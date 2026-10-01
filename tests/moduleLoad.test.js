import { jest } from '@jest/globals'

/**
 * Import smoke tests.
 *
 * Not filler: import-time failure is a demonstrated failure mode in this
 * codebase. utils/encryption.js and config/secrets.js call process.exit(1)
 * without their secrets, and routes/productRoutes.js boots the whole
 * application through its server.js import. Both were discovered the hard way —
 * the first broke CI, the second made a route untestable until stubbed.
 *
 * These assert that every router module loads and exposes a mountable Express
 * router, which is the cheapest possible guard against a repeat.
 */

jest.setTimeout(60000)

// Two routes import from server.js — productRoutes takes { io } and
// vendorBankRoutes takes { plaidClient } — so importing either boots the whole
// application. This test found the second one; a grep for the coupling had
// missed it. See docs/evidence/quality-gate.md.
jest.unstable_mockModule('../server.js', () => ({
  io: { emit: () => {}, to: () => ({ emit: () => {} }) },
  plaidClient: {
    linkTokenCreate: async () => ({ data: {} }),
    itemPublicTokenExchange: async () => ({ data: {} }),
    accountsGet: async () => ({ data: { accounts: [] } })
  }
}))

jest.unstable_mockModule('../config/redis.js', () => ({
  getCache: async () => null,
  setCache: async () => {},
  deleteCache: async () => {}
}))

const ROUTE_MODULES = [
  'adminRoutes',
  'authRoutes',
  'bankRoutes',
  'customerBalanceRoutes',
  'customerRoutes',
  'deliveryProofRoutes',
  'orderRoutes',
  'productRoutes',
  'uploadRoutes',
  'userRoutes',
  'vendorBalanceRoutes',
  'vendorBankRoutes',
  'vendorRoutes'
]

describe('route modules load without side effects', () => {
  test.each(ROUTE_MODULES)('%s exports a mountable router', async (name) => {
    const mod = await import(`../routes/${name}.js`)
    const router = mod.default
    expect(router).toBeDefined()
    // An Express router is a function with a .use method.
    expect(typeof router).toBe('function')
    expect(typeof router.use).toBe('function')
  })
})

describe('support modules load', () => {
  test('utils/sanitize.js exposes the expected sanitisers', async () => {
    const m = await import('../utils/sanitize.js')
    for (const fn of ['asString', 'asEnum', 'asPositiveInt', 'asSafeSearchRegex', 'forLog', 'pickFields']) {
      expect(typeof m[fn]).toBe('function')
    }
  })

  test('utils/encryption.js loads when BANK_ENCRYPTION_KEY is valid', async () => {
    // tests/setup.js supplies a 64-character key. Without it this module calls
    // process.exit(1), which is the intended fail-closed behaviour.
    const m = await import('../utils/encryption.js')
    expect(typeof m.encrypt).toBe('function')
  })

  test('config/secrets.js rejects a missing secret and returns a present one', async () => {
    const m = await import('../config/secrets.js')
    expect(typeof m.getJwtSecret).toBe('function')
    expect(m.getJwtSecret()).toBeTruthy()
    expect(() => m.requireSecret('DEFINITELY_NOT_SET_12345')).toThrow()
  })

  test('middleware/errorHandler.js exports the handler', async () => {
    const m = await import('../middleware/errorHandler.js')
    expect(typeof m.errorHandler).toBe('function')
  })
})
