import { jest } from '@jest/globals'

jest.unstable_mockModule('../server.js', () => ({
  io: { emit: () => {}, to: () => ({ emit: () => {} }) },
  plaidClient: {}
}))

const { imageFileFilter } = await import('../routes/uploadRoutes.js')

/**
 * The upload route buffers files in memory, so what it accepts bounds how much
 * an unauthenticated-shaped request can cost (threat T10, javascript:S5693).
 *
 * These assert the MIME allow-list. Note what they do NOT claim: Content-Type
 * is caller-supplied, so passing this filter is not evidence a file is really
 * an image. The filter bounds the obvious cases; the size limits bound the
 * rest.
 */

const call = (mimetype) =>
  new Promise((resolve) => {
    imageFileFilter({}, { mimetype, originalname: 'x' }, (err, accepted) =>
      resolve({ err, accepted })
    )
  })

describe('imageFileFilter — MIME allow-list', () => {
  test.each(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])(
    'accepts %s',
    async (type) => {
      const { err, accepted } = await call(type)
      expect(err).toBeFalsy()
      expect(accepted).toBe(true)
    }
  )

  test.each([
    ['application/javascript', 'script'],
    ['text/html', 'HTML that could be served back'],
    ['application/x-httpd-php', 'PHP'],
    ['application/octet-stream', 'arbitrary binary'],
    ['image/svg+xml', 'SVG, which can carry script']
  ])('rejects %s (%s)', async (type) => {
    const { err } = await call(type)
    expect(err).toBeInstanceOf(Error)
    expect(err.message).toContain('Unsupported file type')
  })

  test('rejects a missing mimetype rather than defaulting to accept', async () => {
    const { err } = await call(undefined)
    expect(err).toBeInstanceOf(Error)
  })

  test('is case-sensitive, so a spoofed casing does not slip through the Set', async () => {
    // Documents current behaviour: the Set holds lowercase types, and multer
    // lowercases what it parses. A mixed-case value is rejected rather than
    // silently normalised.
    const { err } = await call('IMAGE/JPEG')
    expect(err).toBeInstanceOf(Error)
  })
})
