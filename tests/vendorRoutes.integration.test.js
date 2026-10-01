import { jest } from '@jest/globals'
import express from 'express'
import mongoose from 'mongoose'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { MongoMemoryServer } from 'mongodb-memory-server'

/**
 * Mass assignment on the vendor profile (jssecurity:S4684).
 *
 * This was the most serious of the mass-assignment findings: the route spread
 * req.body straight into `new Vendor(...)`, so a vendor could set any schema
 * field on their own profile — including `verification` and `financials`. In
 * practice that means self-verifying, or setting their own available balance.
 *
 * These assert the allow-list holds at the route, not just in pickFields().
 */

jest.setTimeout(120000)

const TEST_USER_ID = new mongoose.Types.ObjectId()

// vendorRoutes defines its own requireAuth using jwt.verify rather than
// importing the shared middleware, so mocking the middleware module has no
// effect. A real token is signed instead, which also exercises the auth path.
const authHeader = () => [
  'Authorization',
  `Bearer ${jwt.sign({ userId: TEST_USER_ID.toString(), id: TEST_USER_ID.toString() }, process.env.JWT_SECRET)}`
]

let mongod
let app
let Vendor
let User

beforeAll(async () => {
  mongod = await MongoMemoryServer.create()
  await mongoose.connect(mongod.getUri())

  const vendorRoutes = (await import('../routes/vendorRoutes.js')).default
  await import('../models/Vendor.js')
  await import('../models/User.js')
  Vendor = mongoose.model('Vendor')
  User = mongoose.model('User')

  await User.create({
    _id: TEST_USER_ID,
    name: 'Test Vendor',
    email: 'vendor@example.com',
    password: 'hashed-not-used-here',
    role: 'vendor'
  })

  app = express()
  app.use(express.json())
  app.use('/api/vendors', vendorRoutes)
})

afterEach(async () => {
  if (Vendor) await Vendor.deleteMany({})
})

afterAll(async () => {
  await mongoose.disconnect()
  if (mongod) await mongod.stop()
})

describe('PUT /api/vendors/profile — mass assignment', () => {
  test('creates a profile from the allowed fields', async () => {
    const res = await request(app)
      .put('/api/vendors/profile')
      .set(...authHeader())
      .send({ storeName: 'Kiln & Co', storeDescription: 'Stoneware' })

    expect([200, 201]).toContain(res.status)
    const saved = await Vendor.findOne({ user: TEST_USER_ID })
    expect(saved).toBeTruthy()
    expect(saved.storeName).toBe('Kiln & Co')
  })

  test('a vendor cannot self-verify', async () => {
    await request(app)
      .put('/api/vendors/profile')
      .set(...authHeader())
      .send({
        storeName: 'Kiln & Co',
        verification: { isVerified: true, verifiedAt: new Date() }
      })

    const saved = await Vendor.findOne({ user: TEST_USER_ID })
    expect(saved).toBeTruthy()
    // The field is either absent or at its schema default — never the value the
    // caller supplied.
    expect(saved.verification?.isVerified).not.toBe(true)
  })

  test('a vendor cannot set their own balance', async () => {
    await request(app)
      .put('/api/vendors/profile')
      .set(...authHeader())
      .send({
        storeName: 'Kiln & Co',
        financials: { availableBalance: 1000000, totalEarnings: 1000000 }
      })

    const saved = await Vendor.findOne({ user: TEST_USER_ID })
    expect(saved).toBeTruthy()
    expect(saved.financials?.availableBalance ?? 0).not.toBe(1000000)
  })

  test('a vendor cannot reassign the profile to another user', async () => {
    const otherUser = new mongoose.Types.ObjectId()
    await request(app)
      .put('/api/vendors/profile')
      .set(...authHeader())
      .send({ storeName: 'Kiln & Co', user: otherUser })

    const saved = await Vendor.findOne({ storeName: 'Kiln & Co' })
    expect(saved).toBeTruthy()
    expect(saved.user.toString()).toBe(TEST_USER_ID.toString())
  })
})
