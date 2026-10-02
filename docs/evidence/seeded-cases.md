# Detection evidence — seeded cases

**Purpose (Chapter 5):** establish that each gate detects the class of defect it
is responsible for. This is a claim about *detection*, deliberately separated
from the claim that the pipeline executes end to end, which is evidenced in
`end-to-end-run.md`.

## Method

Each case is a branch carrying one deliberate defect, raised as a pull request
against `staging` so the full deep-scan tier runs and every gate has the
opportunity to fire.

The cases were built in three rounds, as the pipeline itself was completed, so
they do not share a single baseline. Each branch is cut from whichever commit
was the verified-green tip at the time, and the isolation argument is made
against *that* commit:

| Baseline | Tag | Cases cut from it |
|---|---|---|
| `3266bab` | none — the commit that recorded the end-to-end run, a descendant of `evidence/end-to-end-green` | SEED-SAST-01, SEED-SECRET-01, SEED-DAST-01 |
| `ac035d2` | `evidence/sca-gate-blocking` | SEED-SCA-01 |
| `3e53799` | `evidence/all-gates-green` | SEED-IAC-01, SEED-IMAGE-01, SEED-SONAR-01 |

Because each branch differs from *its own* baseline by exactly one deliberate
change, any gate that fires is attributable to that change alone. No case
depends on a pre-existing failure.

| Case | Branch | PR | Baseline | Net diff vs baseline |
|---|---|---|---|---|
| SEED-SAST-01 | `seed/sast-01` | [#3](https://github.com/ImmanuelN/artisanmarket-api/pull/3) | `3266bab` | 1 file, +3 / −1 |
| SEED-SECRET-01 | `seed/secret-01` | [#4](https://github.com/ImmanuelN/artisanmarket-api/pull/4) | `3266bab` | 1 file, +19 |
| SEED-DAST-01 | `seed/dast-01` | [#5](https://github.com/ImmanuelN/artisanmarket-api/pull/5) | `3266bab` | 1 file, +10 / −4 |
| SEED-SCA-01 | `seed/sca-01` | [#7](https://github.com/ImmanuelN/artisanmarket-api/pull/7) | `ac035d2` | 2 files — manifest and lockfile only |
| SEED-IAC-01 | `seed/iac-01` | [#11](https://github.com/ImmanuelN/artisanmarket-api/pull/11) | `3e53799` | 2 files, +1 / −71 — NetworkPolicy deleted |
| SEED-IMAGE-01 | `seed/image-01` | [#12](https://github.com/ImmanuelN/artisanmarket-api/pull/12) | `3e53799` | 1 file, +5 / −2 |
| SEED-SONAR-01 | `seed/sonar-01` | [#13](https://github.com/ImmanuelN/artisanmarket-api/pull/13) | `3e53799` | 1 file, +12 / −3 |

`seed/iac-01` is the only branch with two commits. The abandoned first attempt
(`7558f7f`, described under "Two cases had to be re-seeded") is kept on the
branch for the record, and the re-seed commit reverts it — `k8s/deployment.yaml`
is byte-identical to the baseline at the branch tip. The net diff above is what
PR #11 actually scans, and it carries one defect.

## Results

| Case | Defect | Detecting gate | Stage | Result |
|---|---|---|---|---|
| SEED-SAST-01 | `process.env.JWT_SECRET \|\| '<literal>'` in the admin token path | ESLint security ruleset (`no-restricted-syntax`) | Code | **detected** |
| SEED-SECRET-01 | High-entropy secret committed as a standalone assignment | Gitleaks | Code | **detected** |
| SEED-DAST-01 | `helmet` middleware disabled | OWASP ZAP baseline | Staging | **detected** |
| SEED-SCA-01 | `multer` downgraded to a version with 10 HIGH CVEs | Trivy filesystem scan | Build | **detected** |
| SEED-IAC-01 | `k8s/networkpolicy.yaml` deleted | Checkov (`CKV2_K8S_6`) | Build | **detected** |
| SEED-IMAGE-01 | base image pinned back to `node:18.17-alpine` | Trivy image scan | Build | **detected** |
| SEED-SONAR-01 | mass assignment in an untested route | SonarQube (`jssecurity:S4684`) | Code | **detected** |

Every case failed the pipeline at its intended gate, and no case failed anywhere
else.

Screenshots of each blocked run are listed in `screenshots/README.md`; capture
them with the failing stage name visible, since which gate caught the defect is
the evidence, not that the run was red.

## Isolation

The two Code-stage cases cross over cleanly. Each scanner fires on its own defect
class and stays green on the other's:

| Case | ESLint | Gitleaks |
|---|---|---|
| SEED-SAST-01 | **failure** | success |
| SEED-SECRET-01 | success | **failure** |

This is only measurable because every Code-stage scanner is guarded with
`!cancelled()`. By default a failing step ends its job, so the untriggered
scanner would report `skipped` and could not be shown to have passed.

SEED-DAST-01 is isolated by construction: the change is syntactically valid,
contains no credential and introduces no dangerous sink, so Code and Build pass
in full and only the running-application scan observes it.

| Case | Plan | Code | Build | Staging |
|---|---|---|---|---|
| SEED-SAST-01 | pass | **fail** | skipped | skipped |
| SEED-SECRET-01 | pass | **fail** | skipped | skipped |
| SEED-DAST-01 | pass | pass | pass | **fail** |
| SEED-IAC-01 | pass | pass | **fail** | skipped |
| SEED-IMAGE-01 | pass | pass | **fail** | skipped |
| SEED-SONAR-01 | pass | **fail** | skipped | skipped |
| SEED-SCA-01 | pass | pass | **fail** | skipped |

## SEED-DAST-01 — measured delta

The ZAP baseline result against the green commit and against the seeded commit
differ by exactly one rule:

| | Green baseline | SEED-DAST-01 |
|---|---|---|
| Rule 10037 — *Server Leaks Information via `X-Powered-By`* | PASS | **WARN-NEW ×2** |
| Totals | `FAIL 0 · WARN 0 · IGNORE 1 · PASS 66` | `FAIL 0 · WARN 1 · IGNORE 1 · PASS 65` |

One rule moved from PASS to WARN; everything else is unchanged.

**Note on the detecting rule.** The case was predicted to fire the missing
security-header rules. It instead fired the `X-Powered-By` disclosure rule. The
reason is specific to this application's configuration: the `helmet` call already
set `contentSecurityPolicy: false` and `crossOriginEmbedderPolicy: false`, so
those headers were never being applied and their rules could not regress.
Removing `helmet` therefore changed exactly one observable behaviour — Express
re-adding its `X-Powered-By` header. The detection is valid and attributable, but
it evidences a narrower helmet protection than anticipated.

## Finding — a control upstream of the pipeline

SEED-SECRET-01 was first attempted with a Stripe-format live key. **GitHub push
protection rejected the `git push` outright**, matching the *Stripe API Key* and
*Highnote SK Live Key* partner patterns. The commit never reached the repository,
so no pipeline stage ran and the Gitleaks gate could not be evidenced at all.

Two consequences worth reporting:

1. Provider-format secrets are stopped at the push boundary, before any pipeline
   stage executes. A secret-scanning gate in CI is therefore a second line of
   defence for that class, not the first.
2. The gate's distinct value is in what push protection does **not**
   partner-match — generic high-entropy secrets, which is what the final
   SEED-SECRET-01 uses.

## SEED-SCA-01 — the tools are complementary, not redundant

This case isolates the Build stage and, in doing so, measures something the other
three cannot: the two SCA tools disagree.

`multer` was downgraded from `2.4.0` to `1.4.5-lts.1`, which carries ten HIGH
denial-of-service CVEs (`CVE-2025-47935`, `-47944`, `-48997`, `CVE-2025-7338`,
`CVE-2026-2359`, `-3304`, `-3520`, `-5079`, `-77078`, `-82333`). Only the manifest
and lockfile change; the single `multer({ storage: memoryStorage() })` call site
behaves identically on both versions.

| Tool | Database | Result on the same commit |
|---|---|---|
| `npm audit --audit-level=high` | GitHub Advisory DB | **PASS** — `multer` not listed at all |
| Trivy filesystem scan | NVD | **FAIL** — `Total: 10 (HIGH: 10, CRITICAL: 0)` |

In this case the gate that **passes** is as significant as the gate that fails. A
Build stage running only `npm audit` would ship ten HIGH CVEs in the file-upload
path.

This is not a constructed scenario. `multer@1.4.5-lts` was a real dependency of
this application and sat in `main` while `npm audit` reported the tree clean; it
was caught only when the dependency gates were restored from `continue-on-error`
to blocking, and only by Trivy. The seeded case reproduces that on demand.

Two conclusions follow for Chapter 5:

1. Defence in depth applies *within* a stage, not only across stages. Two SCA
   tools drawing on different vulnerability databases are not duplicated effort.
2. A relaxed gate does not merely delay detection — while `npm audit` and Trivy
   were both advisory, neither finding surfaced as a failure, and the vulnerable
   dependency reached `main`.

## Two cases had to be re-seeded, and both failures are findings

Neither attempt below was wasted. Each exposed a property of the pipeline that
only a controlled case could surface.

### SonarQube also scans Kubernetes, and an earlier gate masks a later one

The first SEED-IAC-01 weakened the container security context — `privileged`,
`allowPrivilegeEscalation` and `readOnlyRootFilesystem`. It did not isolate
Checkov. SonarQube flagged `kubernetes:S6428` and `kubernetes:S6430` at the
**Code** stage, which failed the job and skipped Build through the `needs`
chain, so Checkov never ran.

Two consequences:

1. **IaC coverage overlaps across stages.** SonarQube catches a subset of
   Kubernetes misconfiguration earlier than Checkov. That is useful defence in
   depth, and it was invisible until a seeded case exposed the ordering.
2. **An earlier gate masks a later one.** Because Build depends on Code, a
   defect both could catch is only ever attributed to the earlier. This is
   correct fail-fast behaviour, but it means "Checkov catches X" cannot be
   demonstrated for any X that SonarQube also catches.

The case was re-seeded as a deleted NetworkPolicy. `CKV2_K8S_6` is a **graph
check** — it reasons across resources, observing that a Deployment exists and
that no NetworkPolicy selects its pods. SonarQube analyses manifests
individually and has no equivalent, so nothing is wrong *within* any single
remaining file.

### The test suite detects a regression before the scanner does

The first SEED-SONAR-01 reintroduced NoSQL injection in `productRoutes`. This
project's own integration tests caught it, failing the Code stage at the **test**
step rather than at SonarQube.

That is defence in depth working as intended, and it inverts the usual
assumption about where a vulnerability is caught: the regression tests written
during remediation are a faster and more specific detector than the scanner, for
the specific defects they cover.

The case was re-seeded in `customerRoutes`, which `tests/moduleLoad.test.js`
imports to assert it exposes a router but never invokes. Verified before
pushing: ESLint clean, all 102 tests passing, `npm audit` passing — so when the
gate fails, nothing else can be credited.

## Scope limit

Every active gate now has an isolated seeded case. Nothing in the pipeline is
evidenced only incidentally.

One caveat on attribution: the stage matrix above shows `skipped` rather than
`pass` for stages after the failing one, because the `needs` chain stops them.
A case therefore demonstrates that its gate **catches** the defect, and that
every gate **before** it does not. It cannot demonstrate that a later gate would
have missed it. For SEED-SONAR-01 this matters least — it fails at Code, the
earliest automated stage, with every scanner in that stage passing alongside it.
