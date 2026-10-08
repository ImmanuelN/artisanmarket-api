# ArtisanMarket API — Threat Model

**Stage:** Plan (Section 4.3.1) · **Tool:** OWASP Threat Dragon · **Status:** Reviewed

This document is the Plan-stage artifact required before a feature proceeds to Code.
It covers the core flows of the ArtisanMarket API (`artisanmarket-api`):
authentication, product and vendor management, orders and checkout,
vendor/customer balances, bank account linking, and media upload.

**The authoritative model is `docs/threat-model.json`**, an OWASP Threat Dragon v2
model with one data-flow diagram, four trust boundaries and threats T1–T12 attached
to the elements they affect. This file is its narrative companion. The Plan stage
enforces the JSON model, not this file: `scripts/threat-model-gate.js` fails the
pipeline if any High or Critical threat is Open, if any threat marked Mitigated or
Accepted does not state its mitigation, or if the model contains no threats.

Every mitigation below was checked against the code on 2026-10-08. Where the
earlier version of this document claimed a control that the code did not have,
the entry now says what is actually there.

## System under review

- **Runtime:** Node.js 20, Express 4, ES modules — entrypoint `server.js`, listening on `PORT` (default 5000)
- **Data store:** MongoDB via Mongoose (`config/database.js`, `MONGODB_URI`)
- **Cache:** Redis, optional — skipped when `REDIS_URL` is unset (`config/redis.js`)
- **Realtime:** Socket.IO
- **Third parties:** Stripe (payments), Plaid (bank linking), ImageKit (media).
  Cloudinary was removed as an unused dependency.

### Trust boundaries

- **Public internet:** shoppers, vendors and administrators via the ArtisanMarket SPA
- **ArtisanMarket backend:** the Express application, MongoDB, the optional Redis
  cache, environment secrets and application logs
- **Third parties:** Stripe, Plaid, ImageKit
- **Build & delivery:** the npm registry, the CI pipeline and the Kubernetes runtime

## Branch promotion and gate coverage

The pipeline in `.github/workflows/pipeline.yml` applies these controls cumulatively:

| Branch | Stages | Gates applied |
|---|---|---|
| `dev` | Plan, Code | Threat model gate, ESLint, tests, Gitleaks, SonarQube, `npm audit` (audit gate) |
| `staging` | + Build, Staging | + Trivy (dependencies and image), Checkov, OWASP ZAP baseline DAST. Snyk optional, not configured |
| `main` | + Deploy, Monitor | + Release gate, compliance report. `main` is also re-verified daily |

## STRIDE analysis (summary)

| # | Element | STRIDE | Threat | Status | Mitigation / control |
|---|---|---|---|---|---|
| T1 | API requests | Tampering | NoSQL operator injection: `?x[$ne]=` reaching a Mongoose filter; `new RegExp(input)` as a ReDoS vector | Mitigated | `utils/sanitize.js` (`asString`, `asEnum`, `asSafeSearchRegex`) across eight route files, with `express-validator`; integration tests assert an operator object cannot authenticate or alter a query. 8 `jssecurity:S5147` SonarQube findings on guarded sites are documented false positives |
| T2 | Content returned for rendering | Tampering | Stored XSS through product descriptions, store names and review comments | Mitigated (at the client) | The SPA's React escaping and Code-stage rules (client T2). **The API does not sanitise on write**; any non-React consumer must escape on output. No review-submission endpoint exists at present |
| T3 | Environment secrets | Spoofing | Hard-coded credential fallbacks made sessions forgeable when `JWT_SECRET` was unset | Mitigated | `getJwtSecret()` and `assertRequiredSecrets()` in `config/secrets.js`; the process will not start without the secret. Auth routes read `JWT_SECRET` directly, safe because startup asserts it. `routes/mockApi.js` deleted. ESLint blocks the pattern (SEED-SAST-01) |
| T4 | Login / register | Spoofing | Credential stuffing and brute force | Mitigated, with residual | `express-rate-limit` on `/api/`: 100 requests per IP per 15 min. No stricter per-route limit on `/api/auth`, and a distributed attack is not slowed |
| T5 | Third-party packages | Tampering | Vulnerable or compromised dependency, including build tooling | Mitigated | npm audit through `scripts/audit-gate.js` on every branch, and a Trivy dependency scan at Build, over the full tree; re-run daily. Caught critical `proxy-addr` and `shell-quote` advisories (fixed); `braces` accepted until 2026-12-05 |
| T6 | Container runtime | Tampering | Vulnerable base image | Mitigated | Trivy image scan at Build; npm removed from the runtime stage; openssl patched; non-root UID 10001 (SEED-IMAGE-01) |
| T7 | Deployment manifests | Tampering | Root containers, missing limits, open network paths | Mitigated | Checkov at Build; restricted Pod Security Standard enforced at admission; NetworkPolicy (SEED-IAC-01). Exceptions: `CKV_K8S_43` (digest set at deploy) and `CKV_K8S_35` (env-var secrets, accepted and tracked) |
| T8 | MongoDB (bank details) | Information Disclosure | AES-256-CBC gives no integrity: stored ciphertext can be altered undetected (`javascript:S5542`) | **Accepted** | Migration to AES-256-GCM requires re-encrypting every record. Compensating controls: key never committed, exactly 64 hex characters, process exits without it. Tracked in `docs/evidence/finding-ledger.md` |
| T9 | Stripe webhook | Spoofing | A forged webhook marking an order paid | Mitigated | `stripe.webhooks.constructEvent` with `STRIPE_WEBHOOK_SECRET` over a raw body; an invalid signature or missing secret returns 400 before any state change |
| T10 | Image upload | Denial of Service | Upload volume exhausting memory or storage | **Open (Medium)** | Per request: MIME allow-list (SVG rejected), 4 files × 5 MB, part limits (`tests/uploadFilter.test.js`). **No per-user quota**: total volume is bounded only by the global rate limit |
| T11 | Application logs | Information Disclosure | Tokens and card or account numbers logged; forged log lines | Mitigated | `middleware/errorHandler.js` redacts sensitive headers and body fields — its tests caught camelCase names such as `cardNumber` slipping through — and `forLog` strips control characters at every logging site |
| T12 | Responses | Information Disclosure | Missing security headers; `X-Powered-By` disclosure | Mitigated | `helmet` with a strict CSP for a JSON API (`default-src 'none'`); CORS origin allow-list; ZAP baseline at Staging (SEED-DAST-01) |

### What changed from the previous version

- **T1** named `express-validator` as the control. The controls actually doing the
  work are the coercion functions in `utils/sanitize.js`.
- **T2** claimed "sanitise on write". The API does not; the protection is at the
  client's render boundary, and the entry now says so.
- **T3** said all five JWT sites call `getJwtSecret()`. Two do; two read the
  variable directly, safe only because of the startup assertion.
- **T4** cited a line number in `server.js` that had moved. Line numbers are no
  longer used.
- **T5** listed Snyk at the Build stage. Snyk has never run here.
- **T8** described key handling but not the cipher mode. The mode is the risk,
  and it is accepted, not mitigated.
- **T9** said signature verification needed confirming. It is confirmed, and it
  fails closed.
- **T10** asked for MIME allow-listing and per-user quotas. The first exists; the
  second does not, so the threat stays Open.
- **T11** and **T12** are new. Both are real controls in the code, each with
  evidence (a test-caught redaction bug; a seeded DAST case), and neither was
  modelled.

## T3 as the measured "before" figure

T3 was the measured "before" figure for the remediation chapter: eleven real
hardcoded credential fallbacks, found by the Code-stage ESLint security ruleset
(`.eslintrc.json`) and since remediated, taking the Code stage from eleven blocking
findings to zero. These were pre-existing technical debt in the application, not
seeded test cases.

### Dependency gate status

All gates are blocking. The dependency tree was cleared before the gates were
restored: `npm audit fix` resolved the non-breaking advisories, and `cloudinary`
and `nodemailer` were **removed outright** — neither was imported or required
anywhere in the codebase, and between them they carried both remaining
high-severity advisories. You do not upgrade what you do not use.

| | Before | After |
|---|---|---|
| critical | 1 | 0 |
| high | 20 | 0 |
| moderate | 10 | 2 |
| low | 3 | 0 |
| **total** | **34** | **2** |

Since then, advisories published against unchanged code have turned the gate red
several times. Each was fixed when a fix existed, or accepted in
`.audit-allowlist.json` with a reason and a review date when none did. The
moderates that remain (`imagekit` and its transitive `uuid`, and `sprintf-js` in
the test tooling) sit below the `high` threshold and are reported on every run.
