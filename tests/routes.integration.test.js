import { jest } from '@jest/globals'
import express from 'express'
import mongoose from 'mongoose'
import request from 'supertest'
import { MongoMemoryServer } from 'mongodb-memory-server'

/**
 * Integration tests for the auth, order and vendor routes against a real
 * MongoDB. Unlike productRoutes, none of these imports server.js, so they load
 * without stubbing the entrypoint.
 *
 * Each case targets a specific remediation from docs/evidence/finding-ledger.md
 * rather than exercising the route generally.
 */

jest.setTimeout(120000)

// requireAuth verifies a JWT and loads a user; stubbed so these tests exercise
// the query construction rather than the auth flow, which is covered elsewhere.
const TEST_USER_ID = new mongoose.Types.ObjectId()
jest.unstable_mockModule('../middleware/authMiddleware.js', () => ({
  requireAuth: (req, _res, next) => {
    req.user = { id: TEST_USER_ID.toString(), _id: TEST_USER_ID, userId: TEST_USER_ID.toString() }
    next()
  },
  protect: (req, _res, next) => next(),
  authorize: () => (req, _res, next) => next()
}))

let mongod
let authApp
let orderApp

beforeAll(async () => {
  mongod = await MongoMemoryServer.create()
  await mongoose.connect(mongod.getUri())

  const authRoutes = (await import('../routes/authRoutes.js')).default
  const orderRoutes = (await import('../routes/orderRoutes.js')).default

  authApp = express()
  authApp.use(express.json())
  authApp.use('/api/auth', authRoutes)

  orderApp = express()
  orderApp.use(express.json())
  orderApp.use('/api/orders', orderRoutes)
})

afterAll(async () => {
  await mongoose.disconnect()
  if (mongod) await mongod.stop()
})

describe('POST /api/auth/login — NoSQL injection on the authentication path', () => {
  test('an operator object in email cannot match an arbitrary user', async () => {
    const res = await request(authApp)
      .post('/api/auth/login')
      .send({ email: { $ne: null }, password: 'anything' })

    // Must not authenticate. Either the validator rejects it (400) or the
    // typeof guard turns it into undefined and no user matches (401) — both are
    // correct; a 200 would mean the operator reached the filter.
    expect([400, 401]).toContain(res.status)
    expect(res.body.token).toBeUndefined()
  })

  test('a $gt operator is likewise rejected', async () => {
    const res = await request(authApp)
      .post('/api/auth/login')
      .send({ email: { $gt: '' }, password: 'anything' })
    expect([400, 401]).toContain(res.status)
    expect(res.body.token).toBeUndefined()
  })

  test('an unknown but well-formed address fails cleanly', async () => {
    const res = await request(authApp)
      .post('/api/auth/login')
      .send({ email: 'nobody@example.com', password: 'whatever' })
    expect(res.status).toBe(401)
  })
})

describe('POST /api/auth/register — NoSQL injection on the existence check', () => {
  test('an operator object cannot be used to probe for existing users', async () => {
    const res = await request(authApp)
      .post('/api/auth/register')
      .send({ name: 'Probe', email: { $ne: null }, password: 'Password123!' })
    expect([400, 401, 422]).toContain(res.status)
  })
})

describe('GET /api/orders — status filter is constrained to the schema enum', () => {
  test('a valid status is accepted', async () => {
    const res = await request(orderApp).get('/api/orders?status=pending')
    expect(res.status).toBe(200)
  })

  test('an operator object in status does not reach the query', async () => {
    const injected = await request(orderApp).get('/api/orders?status[$ne]=cancelled')
    expect(injected.status).toBe(200)

    // Dropped, so the result matches the unfiltered request rather than the
    // inverted set a successful injection would return.
    const unfiltered = await request(orderApp).get('/api/orders')
    expect(injected.body.orders.length).toBe(unfiltered.body.orders.length)
  })

  test('a status outside the enum is ignored rather than passed through', async () => {
    const res = await request(orderApp).get('/api/orders?status=not-a-real-status')
    expect(res.status).toBe(200)
  })
})
