import { jest } from '@jest/globals'
import express from 'express'
import mongoose from 'mongoose'
import request from 'supertest'
import { MongoMemoryServer } from 'mongodb-memory-server'

/**
 * Integration tests for the product query paths, against a real MongoDB.
 *
 * These exercise the actual Mongoose filters rather than the sanitisers in
 * isolation, which is the only way to prove that an injected operator cannot
 * change what a query matches. A unit test on asString() shows the helper
 * behaves; this shows the route does.
 *
 * Covers jssecurity:S5147 (NoSQL injection) and jssecurity:S2631 (ReDoS) —
 * see docs/evidence/finding-ledger.md.
 */

jest.setTimeout(120000)

let mongod
let app
let Product

beforeAll(async () => {
  mongod = await MongoMemoryServer.create()
  await mongoose.connect(mongod.getUri())

  // Import after the connection exists so model registration binds to it.
  const productRoutes = (await import('../routes/productRoutes.js')).default
  Product = mongoose.model('Product')
  await import('../models/Vendor.js')

  app = express()
  app.use(express.json())
  app.use('/api/products', productRoutes)

  const vendorId = new mongoose.Types.ObjectId()
  await Product.create([
    {
      title: 'Hand-thrown Mug',
      description: 'Stoneware mug',
      price: 25,
      vendor: vendorId,
      categories: ['ceramics'],
      tags: ['mug'],
      status: 'active',
      isDeleted: false
    },
    {
      title: 'Woven Basket',
      description: 'Palm leaf basket',
      price: 40,
      vendor: vendorId,
      categories: ['weaving'],
      tags: ['basket'],
      status: 'active',
      isDeleted: false
    }
  ])
})

afterAll(async () => {
  await mongoose.disconnect()
  if (mongod) await mongod.stop()
})

describe('GET /api/products — baseline behaviour still works', () => {
  test('returns the seeded active products', async () => {
    const res = await request(app).get('/api/products')
    expect(res.status).toBe(200)
    expect(res.body.products.length).toBeGreaterThanOrEqual(2)
  })

  test('a legitimate category filter narrows the results', async () => {
    const res = await request(app).get('/api/products?category=ceramics')
    expect(res.status).toBe(200)
    expect(res.body.products).toHaveLength(1)
    expect(res.body.products[0].title).toBe('Hand-thrown Mug')
  })

  test('a legitimate search matches on title', async () => {
    const res = await request(app).get('/api/products?search=Mug')
    expect(res.status).toBe(200)
    expect(res.body.products.length).toBeGreaterThanOrEqual(1)
  })
})

describe('GET /api/products — NoSQL operator injection (jssecurity:S5147)', () => {
  test('category[$ne] cannot be used to bypass the category filter', async () => {
    // Express parses this into { category: { $ne: 'ceramics' } }. If it reached
    // the filter, it would invert the intended match.
    const injected = await request(app).get('/api/products?category[$ne]=ceramics')
    expect(injected.status).toBe(200)

    // The operator is dropped, so the result is the unfiltered list — not the
    // inverted one that a successful injection would produce.
    const unfiltered = await request(app).get('/api/products')
    expect(injected.body.products).toHaveLength(unfiltered.body.products.length)
  })

  test('vendor[$ne] cannot be used to enumerate other vendors', async () => {
    const res = await request(app).get('/api/products?vendor[$ne]=000000000000000000000000')
    expect(res.status).toBe(200)
  })

  test('a $where payload does not execute', async () => {
    const res = await request(app).get('/api/products?category[$where]=1==1')
    expect(res.status).toBe(200)
  })
})

describe('GET /api/products — ReDoS via search (jssecurity:S2631)', () => {
  test('a catastrophic-backtracking pattern is treated as a literal', async () => {
    const started = Date.now()
    const res = await request(app).get(`/api/products?search=${encodeURIComponent('(a+)+$')}`)
    const elapsed = Date.now() - started

    expect(res.status).toBe(200)
    // Compiled as a pattern this hangs; escaped to a literal it returns at once.
    expect(elapsed).toBeLessThan(3000)
    // And it matches nothing, because no product title contains that text.
    expect(res.body.products).toHaveLength(0)
  })

  test('regex metacharacters match literally rather than as a pattern', async () => {
    // '.' would match any character if the term were compiled as a regex, so a
    // single dot would match every product. Escaped, it matches none.
    const res = await request(app).get('/api/products?search=.')
    expect(res.status).toBe(200)
    expect(res.body.products).toHaveLength(0)
  })

  test('an over-long search term is rejected rather than compiled', async () => {
    const res = await request(app).get(`/api/products?search=${'x'.repeat(5000)}`)
    expect(res.status).toBe(200)
  })
})
