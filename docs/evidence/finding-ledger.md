# Finding ledger — SonarQube baseline

**Captured:** 2026-09-30, from the first SonarCloud analysis of `artisanmarket-api`.

This is the **pre-remediation baseline**: every vulnerability SonarQube reported
before any of it was fixed. It exists so each finding can be deliberately
reintroduced later as a controlled seeded case, in the same isolated one-commit
style as SEED-SAST-01 through SEED-SCA-01.

Once a finding is fixed SonarCloud stops reporting it, and this detail cannot be
reconstructed from the platform afterwards — which is why it is recorded here
rather than left implicit.

Each entry gives the rule, the affected sites, the weakness, and how to put it
back. **Threat** links the finding to `docs/threat-model.md` where one applies.

**Total: 57 vulnerabilities** — BLOCKER 14, CRITICAL 6, MAJOR 19, MINOR 18


## `jssecurity:S5145` — Log injection

**17 site(s)** · severity MINOR · threat: —

Unsanitised user input is written to logs, allowing forged log entries or log-viewer XSS.

| File | Line |
|---|---|
| `middleware/errorHandler.js` | 5 |
| `middleware/errorHandler.js` | 11 |
| `middleware/errorHandler.js` | 12 |
| `monitor-server.js` | 96 |
| `monitor-server.js` | 97 |
| `monitor-server.js` | 101 |
| `monitor-server.js` | 106 |
| `routes/bankRoutes.js` | 162 |
| `routes/deliveryProofRoutes.js` | 23 |
| `routes/vendorBalanceRoutes.js` | 168 |
| `routes/vendorBalanceRoutes.js` | 274 |
| `routes/vendorBalanceRoutes.js` | 410 |
| `routes/vendorBankRoutes.js` | 370 |
| `server.js` | 249 |
| `server.js` | 276 |
| `server.js` | 295 |
| `server.js` | 409 |

**To reintroduce:** Log a raw req field directly.


## `jssecurity:S5147` — NoSQL injection

**12 site(s)** · severity BLOCKER · threat: T1

User-controlled values reach a Mongoose filter, allowing query operators ($ne, $gt, $where) to be smuggled in.

| File | Line |
|---|---|
| `routes/authRoutes.js` | 29 |
| `routes/authRoutes.js` | 104 |
| `routes/orderRoutes.js` | 20 |
| `routes/orderRoutes.js` | 27 |
| `routes/orderRoutes.js` | 259 |
| `routes/orderRoutes.js` | 266 |
| `routes/productRoutes.js` | 71 |
| `routes/productRoutes.js` | 81 |
| `routes/productRoutes.js` | 89 |
| `routes/productRoutes.js` | 108 |
| `routes/productRoutes.js` | 113 |
| `routes/productRoutes.js` | 119 |

**To reintroduce:** Pass req.query/req.body straight into a find() filter without casting to String.


## `githubactions:S7637` — Action not SHA-pinned

**8 site(s)** · severity MAJOR · threat: —

A workflow references an action by tag, which is mutable, so the code executed can change without the workflow changing.

| File | Line |
|---|---|
| `.github/workflows/pipeline.yml` | 110 |
| `.github/workflows/pipeline.yml` | 116 |
| `.github/workflows/pipeline.yml` | 182 |
| `.github/workflows/pipeline.yml` | 197 |
| `.github/workflows/pipeline.yml` | 205 |
| `.github/workflows/pipeline.yml` | 215 |
| `.github/workflows/pipeline.yml` | 223 |
| `.github/workflows/pipeline.yml` | 282 |

**To reintroduce:** Replace a SHA ref with a tag. Directly relevant: two pipeline defects in this project were action-version problems.


## `githubactions:S6505` — npm lifecycle scripts allowed

**6 site(s)** · severity MAJOR · threat: —

npm ci / npx run package lifecycle scripts, executing third-party code at build time.

| File | Line |
|---|---|
| `.github/workflows/pipeline.yml` | 95 |
| `.github/workflows/pipeline.yml` | 133 |
| `.github/workflows/pipeline.yml` | 156 |
| `.github/workflows/pipeline.yml` | 246 |
| `.github/workflows/pipeline.yml` | 249 |
| `.github/workflows/pipeline.yml` | 271 |

**To reintroduce:** Drop --ignore-scripts.


## `javascript:S2245` — Insecure randomness

**2 site(s)** · severity MAJOR · threat: —

Math.random() is not cryptographically secure.

| File | Line |
|---|---|
| `middleware/errorHandler.js` | 3 |
| `server.js` | 274 |

**To reintroduce:** Use Math.random() where a token or id is generated.


## `jssecurity:S2631` — ReDoS via user input

**2 site(s)** · severity CRITICAL · threat: T1

User input is compiled into a regex, so a crafted pattern causes exponential backtracking.

| File | Line |
|---|---|
| `routes/productRoutes.js` | 38 |
| `routes/productRoutes.js` | 188 |

**To reintroduce:** Build `new RegExp(req.query.q)` in a search route.


## `jssecurity:S4684` — Mass assignment

**2 site(s)** · severity CRITICAL · threat: —

A request body is passed wholesale into a model update, so a caller can set fields they should not.

| File | Line |
|---|---|
| `routes/customerRoutes.js` | 253 |
| `routes/vendorRoutes.js` | 49 |

**To reintroduce:** Use `Model.findByIdAndUpdate(id, req.body)`.


## `secrets:S8215` — Hardcoded credential hash

**2 site(s)** · severity BLOCKER · threat: T3

A bcrypt password hash is committed in source.

| File | Line |
|---|---|
| `routes/mockApi.js` | 14 |
| `routes/mockApi.js` | 22 |

**To reintroduce:** Commit a bcrypt hash literal. Note generic high-entropy secrets are what Gitleaks catches; provider-format keys are blocked earlier by GitHub push protection.


## `docker:S6505` — npm lifecycle scripts allowed in image build

**1 site(s)** · severity MAJOR · threat: T6

Same as the workflow case, inside the Dockerfile.

| File | Line |
|---|---|
| `Dockerfile` | 22 |

**To reintroduce:** Drop --ignore-scripts from the image build.


## `githubactions:S8233` — Over-broad workflow permission

**1 site(s)** · severity MAJOR · threat: —

A write permission is granted workflow-wide rather than to the job that needs it.

| File | Line |
|---|---|
| `.github/workflows/pipeline.yml` | 32 |

**To reintroduce:** Move a permission up to workflow level.


## `javascript:S5542` — Unauthenticated cipher mode

**1 site(s)** · severity CRITICAL · threat: T8

AES-CBC gives confidentiality but not integrity, so ciphertext can be tampered with undetected.

| File | Line |
|---|---|
| `utils/encryption.js` | 28 |

**To reintroduce:** Switch createCipheriv back to a -cbc suite.


## `javascript:S5693` — No request size limit

**1 site(s)** · severity MAJOR · threat: T10

An upload route accepts unbounded content.

| File | Line |
|---|---|
| `routes/uploadRoutes.js` | 55 |

**To reintroduce:** Remove the multer limits option.


## `javascript:S5728` — CSP disabled

**1 site(s)** · severity MINOR · threat: T5

helmet is configured with contentSecurityPolicy: false.

| File | Line |
|---|---|
| `server.js` | 190 |

**To reintroduce:** Set contentSecurityPolicy: false in the helmet options.


## `javascript:S5852` — ReDoS regex

**1 site(s)** · severity CRITICAL · threat: —

A static regex is vulnerable to exponential backtracking.

| File | Line |
|---|---|
| `models/User.js` | 17 |

**To reintroduce:** Restore a nested-quantifier regex.
