/**
 * SEED-SECRET-01: deliberately committed high-entropy credential.
 *
 * Controlled seeded case for Chapter 5. A synthetic, non-functional secret is
 * committed here so the Code-stage secret scanner has a single, individually
 * attributable defect to catch.
 *
 * Design notes:
 *  - Written as a standalone assignment, not an environment-variable fallback,
 *    so it does NOT match the ESLint credential-fallback rule.
 *  - Deliberately a GENERIC high-entropy secret rather than a provider-format
 *    key. A Stripe-format key is blocked by GitHub push protection at the push
 *    boundary and never reaches CI, so it cannot evidence the Gitleaks gate.
 */

export const LEGACY_SESSION_SIGNING_SECRET =
  'hq3Vb7XpLm2RdKfW9tZcYnAeJsQuGiOxPaSdFgHjKlZxCvBnMqWeRtYuIoP1a2b3'

export default { LEGACY_SESSION_SIGNING_SECRET }
