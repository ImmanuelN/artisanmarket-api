# ArtisanMarket API — Threat Model

**Stage:** Plan (Section 4.3.1) · **Tool:** OWASP Threat Dragon · **Status:** Reviewed

This document is the Plan-stage artifact required before a feature proceeds to Code.
It is exported/summarised from the OWASP Threat Dragon model for the ArtisanMarket
API (`artisanmarket-api`) and covers the core flows: authentication, product and
vendor management, orders and checkout, vendor/customer balances, bank account
linking, and media upload.

## System under review

- **Runtime:** Node.js 20, Express 4, ES modules — entrypoint `server.js`, listening on `PORT` (default 5000)
- **Data store:** MongoDB via Mongoose (`config/database.js`, `MONGODB_URI`)
- **Cache:** Redis, optional — skipped when `REDIS_URL` is unset (`config/redis.js`)
- **Realtime:** Socket.IO
- **Third parties:** Stripe (payments), Plaid (bank linking), Cloudinary and ImageKit (media)

### Trust boundaries

- **External entity:** Shopper / vendor / admin via the ArtisanMarket SPA (browser)
- **Process:** Express application (`server.js` plus `routes/`, `middleware/`, `models/`)
- **Data store:** MongoDB instance
- **Boundaries:** Public internet ↔ API process · API process ↔ MongoDB ·
  API process ↔ Stripe / Plaid / Cloudinary / ImageKit

## Branch promotion and gate coverage

The pipeline in `.github/workflows/pipeline.yml` applies these controls cumulatively:

| Branch | Stages | Gates applied |
|---|---|---|
| `dev` | Plan, Code | Threat model check, ESLint, Gitleaks, SonarQube, `npm audit` |
| `staging` | + Build, Staging | + Snyk, Trivy, Checkov, OWASP ZAP baseline DAST |
| `main` | + Deploy, Monitor | + Release gate, continuous compliance summary |

## STRIDE analysis (summary)

| # | Element | Threat (STRIDE) | Description | Mitigation / control |
|---|---|---|---|---|
| T1 | Product / vendor query endpoints | Tampering | User-controlled query values reaching Mongoose filters can smuggle query operators (`$ne`, `$gt`, `$where`) and alter the filter — NoSQL injection | SAST gate (SonarQube) at Code stage; validate and cast with `express-validator` before building filters |
| T2 | Review submission (`models/Review.js`) | Tampering / Elevation of Privilege | Review text is stored verbatim and served to the SPA; an unescaped render path would execute it as script for later visitors (stored XSS) | SAST + DAST gates (SonarQube, OWASP ZAP); sanitise on write, rely on React escaping on read |
| T3 | Admin token verification | Spoofing / Information Disclosure | `routes/adminRoutes.js:14` verifies with `process.env.JWT_SECRET \|\| 'fallback-secret'`. If `JWT_SECRET` is ever unset, admin tokens are verifiable against a public constant, letting an attacker mint admin sessions | Secret-scanning gate (Gitleaks) at Code stage; **open finding** — remove the fallback and fail fast when `JWT_SECRET` is absent |
| T4 | Login / register | Spoofing | Credential stuffing or brute force against `/api/auth` | **Mitigated** — `express-rate-limit` at `server.js:189` caps each IP at 100 requests per 15 min across `/api/`. Consider a stricter per-route limit on auth endpoints |
| T5 | Third-party packages | Tampering | A direct or transitive dependency could ship a known vulnerability | SCA gates: `npm audit` on every branch, Snyk at Build stage (staging and main) |
| T6 | Container image | Tampering | Base image or OS packages could carry known CVEs | Container scan (Trivy) at Build stage — **inactive**, no `Dockerfile` in the repository yet |
| T7 | Deployment manifests | Tampering / Denial of Service | Misconfigured Kubernetes/compose manifests (missing resource limits, root containers) | IaC scan (Checkov) at Build stage — **inactive**, no `k8s/` or `docker-compose.yml` yet |
| T8 | Bank account linking (`utils/encryption.js`) | Information Disclosure | Account details are encrypted at rest with AES via `BANK_ENCRYPTION_KEY`. A weak, short, or leaked key exposes stored financial data | Key length is asserted at load (64 hex characters); key held only in environment secrets and covered by the Gitleaks gate |
| T9 | Payments (Stripe, Plaid) | Repudiation / Tampering | Stripe webhooks mutate order and balance state; a forged webhook could mark orders paid | Raw-body handler at `server.js:247` preserves the signature payload; `STRIPE_WEBHOOK_SECRET` must be verified on every webhook — confirm during Code review |
| T10 | Media upload (`routes/uploadRoutes.js`) | Denial of Service / Tampering | Multer accepts up to 10 MB; unrestricted type or volume could exhaust storage or serve hostile files | Enforce MIME allow-listing and per-user quotas; DAST gate exercises the endpoint |

T3 is the live "before" case for Chapter 5: it is a real hardcoded fallback secret
in the current codebase, kept in place so the Code-stage Gitleaks and SonarQube gates
have something genuine to catch and report on. T6 and T7 are staged controls — the
pipeline steps exist and self-activate as soon as the container and IaC artifacts land.

## Sign-off

Reviewed and approved to proceed to the Code stage.

- **Reviewer:** _[supervisor / lead developer name]_
- **Date:** _[sign-off date]_
