# Detection evidence — seeded cases

**Purpose (Chapter 5):** establish that each gate detects the class of defect it
is responsible for. This is a claim about *detection*, deliberately separated
from the claim that the pipeline executes end to end, which is evidenced in
`end-to-end-run.md`.

## Method

Each case is a single commit branched from tag `evidence/end-to-end-green`
(`8eda0eb689ba53145090d67f2dbbad6d1199bceb`) — the commit verified green through
all six stages. Each is raised as a pull request against `staging`, so the full
deep-scan tier runs and every gate has the opportunity to fire.

Because each branch differs from the green baseline by exactly one deliberate
change, any gate that fires is attributable to that change alone. No case
depends on a pre-existing failure.

| Case | Branch | PR | Diff vs baseline |
|---|---|---|---|
| SEED-SAST-01 | `seed/sast-01` | [#3](https://github.com/ImmanuelN/artisanmarket-api/pull/3) | 1 file, +3 / −1 |
| SEED-SECRET-01 | `seed/secret-01` | [#4](https://github.com/ImmanuelN/artisanmarket-api/pull/4) | 1 file, +15 |
| SEED-DAST-01 | `seed/dast-01` | [#5](https://github.com/ImmanuelN/artisanmarket-api/pull/5) | 1 file, +10 / −4 |

## Results

| Case | Defect | Detecting gate | Stage | Result |
|---|---|---|---|---|
| SEED-SAST-01 | `process.env.JWT_SECRET \|\| '<literal>'` in the admin token path | ESLint security ruleset (`no-restricted-syntax`) | Code | **detected** |
| SEED-SECRET-01 | High-entropy secret committed as a standalone assignment | Gitleaks | Code | **detected** |
| SEED-DAST-01 | `helmet` middleware disabled | OWASP ZAP baseline | Staging | **detected** |

Every case failed the pipeline at its intended gate, and no case failed anywhere
else.

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

## Scope limit

No seeded case covers the **SCA** gate. `npm audit` and the Trivy filesystem scan
are currently `continue-on-error` (tagged `DEMO-GATE-RELAXED`), so a seeded
vulnerable dependency would be reported but would not fail the pipeline.
Evidencing that gate requires restoring both to blocking, which in turn requires
clearing or formally accepting the 21 pre-existing critical/high advisories —
three of which need semver-major upgrades.

Neither does any case cover SonarQube, which is skipped while `SONAR_TOKEN` and
`SONAR_HOST_URL` are unset, or Checkov, which is inactive until Kubernetes or
compose manifests exist.
