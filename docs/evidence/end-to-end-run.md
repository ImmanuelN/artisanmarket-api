# Demonstration evidence — pipeline operates end to end

**Purpose (Section 6.2):** establish that the six-stage DevSecOps model executes
from Plan through Monitor. This is a claim about the *mechanism*, deliberately
separated from any claim about vulnerability detection, which is evidenced
separately by the seeded-case runs.

## Run under evidence

| | |
|---|---|
| Repository | `ImmanuelN/artisanmarket-api` |
| Run | [35996052235](https://github.com/ImmanuelN/artisanmarket-api/actions/runs/35996052235) |
| Commit | `8eda0eb689ba53145090d67f2dbbad6d1199bceb` |
| Event | `pull_request`, base `main` |
| Started | 2026-09-24T11:57:17Z |
| Completed | 2026-09-24T12:00:52Z |
| Duration | ~3.5 minutes |
| Conclusion | **success** |

The `pull_request` event with base `main` resolves `production=true`, so all six
stages execute without modifying `main`.

## Stage results

| Stage (Chapter 4) | Job | Result |
|---|---|---|
| — | Context · resolve promotion stage | success |
| Plan (4.3.1) | Plan · threat model present | success |
| Code (4.3.2, 4.3.3) | Code · SAST + secret scanning | success |
| Code (4.3.4) | Code · SCA baseline (npm audit) | success |
| Build (4.3.4–4.3.6) | Build · SCA + container + IaC scanning | success |
| Staging (4.3.7) | Staging · DAST | success |
| Deploy (4.3.8) | Deploy · production release gate | success |
| Monitor (4.3.9) | Monitor · compliance summary | success |

## DAST result

OWASP ZAP baseline against the live Express API, started in CI against a
`mongo:7` service container and confirmed healthy at `/health` before scanning:

```
FAIL-NEW: 0   FAIL-INPROG: 0   WARN-NEW: 0   WARN-INPROG: 0
INFO: 0       IGNORE: 1        PASS: 66
```

66 application-layer rules passed across 3 URLs — the unauthenticated surface
(`/health`, `/ping` and the API error responses). Authenticated routes are out of
scope for a baseline scan. The single `IGNORE` is a cache-header rule scoped out
in `.zap/rules.tsv` with justification.

## Security remediation evidenced by this run

All 11 hardcoded credential fallbacks (threat T3) are remediated, and the Code
stage passes with the ESLint rule that forbids the pattern still active:

- Five `JWT_SECRET` fallbacks replaced by `getJwtSecret()` (`config/secrets.js`),
  which throws when the variable is absent. `assertRequiredSecrets()` refuses to
  start the process rather than verifying tokens against a source-level constant.
- Stripe and Plaid clients are constructed only when their credentials exist.
  The CI startup log shows the intended behaviour: *"STRIPE_SECRET_KEY not set.
  Stripe payment routes are disabled."*

## Validity caveats

These must be stated wherever this run is cited:

1. **Two gates were relaxed for this run.** `npm audit` and the Trivy filesystem
   scan are marked `continue-on-error`, tagged `DEMO-GATE-RELAXED` in the
   workflow. 21 pre-existing critical/high advisories remain, three requiring
   semver-major upgrades (`cloudinary`, `nodemailer`, and a transitive chain).
   The run evidences stage execution, **not** a vulnerability-free dependency
   tree.
2. **The DAST job uses ephemeral CI-only secrets.** `JWT_SECRET` and
   `BANK_ENCRYPTION_KEY` are generated per run and never reused.
3. **One Gitleaks exception exists.** `.gitleaks.toml` allowlists the exact
   literal `sk_test_placeholder`, which appears in the threat model's own
   description of the remediated pattern. A real Stripe key committed to this
   repository still fails the Code stage.

## Newly-active Build-stage coverage (2026-09-30)

The Build stage previously guarded its container and IaC steps on file
detection, and both self-skipped because no `Dockerfile` or `k8s/` existed. Both
artifacts now exist and both scanners execute against them.

| Scanner | First run | After remediation |
|---|---|---|
| Trivy (image) | 26 findings, 1 CRITICAL | **clean** at CRITICAL/HIGH |
| Checkov (`k8s/`) | 86 passed, 4 failed | **88 passed, 0 failed, 2 skipped** |

### What the image findings were, and why they were fixable

22 of the 26 came from **npm's own bundled dependency tree** inside
`node:20-alpine` — `pacote`, `sigstore`, `tar`, `cross-spawn`, `glob`,
`minimatch`, `ip-address`, `brace-expansion` — including the only CRITICAL. npm
is never invoked at runtime: dependencies install in the build stage and the
entrypoint is `node server.js`. Deleting it removed the findings outright.
The remaining four were openssl (`libcrypto3`, `libssl3`) at 3.5.6-r0, patched
to 3.5.8-r0 in the image rather than waiting for a rebuilt base.

Both are remediations, not suppressions: unused tooling removed and stale
packages patched, with nothing allowlisted.

### Checkov: three fixed, two accepted

| Check | Outcome |
|---|---|
| `CKV_K8S_40` — high UID | Fixed. Runs as uid 10001; the base image's `node` user is 1000, inside the range a host assigns to real users |
| `CKV2_K8S_6` — NetworkPolicy | Fixed. Default-deny plus explicit allows: ingress from the ingress controller only; egress limited to DNS, outbound 443 and in-cluster MongoDB |
| `CKV_K8S_43` — image digest | Accepted. The digest does not exist until the Build stage produces the image; a committed placeholder would deploy something other than what was scanned |
| `CKV_K8S_35` — secrets as files | **Accepted, and a genuine control gap.** The app reads secrets from the environment, so migrating requires changing the `config/secrets.js` contract that the DAST job also depends on. Compensating: the Secret is never committed, no service-account token is mounted, the namespace enforces restricted PSS, and a missing secret fails the process closed. Remediation path: support `<NAME>_FILE` and mount the Secret as a volume |

Both exceptions are recorded in-band as `checkov.io/skip` annotations with
reasons, matching how the ESLint and ZAP exceptions in this project are handled.

### A recurrence of the step-suppression defect

The first run exposed the same defect previously fixed in the Code stage, now in
the Build stage: the image scan failing **ended its job**, so the Trivy
filesystem scan and both Checkov steps reported `skipped`. A base-image CVE was
therefore suppressing both dependency scanning and all IaC scanning — meaning
Checkov appeared wired but had never executed. All four Build scanners now carry
`!cancelled()`, so the stage fails on the union of findings rather than the
first one.

This is the eighth instance of the same underlying issue and the second
independent one, which is worth stating as a finding in its own right: in
GitHub Actions, step-level failure semantics silently narrow scanner coverage,
and each stage must be checked for it separately.

## Defects found by reaching each stage

Five pipeline defects were only discoverable once each stage unblocked the next.
They are recorded because they bear on the Section 6.2 argument: a pipeline that
stays red for unrelated reasons cannot evidence that its later stages are even
correctly configured.

| # | Defect | Stage exposed |
|---|---|---|
| 1 | `aquasecurity/trivy-action@0.24.0` does not exist; release tags carry a `v` prefix. Job failed at *Set up job* before any scanner ran | Build |
| 2 | Gitleaks fired on `docs/threat-model.md` — documenting a remediated fallback reproduced a literal matching the Stripe key rule | Code |
| 3 | `utils/encryption.js` calls `process.exit(1)` unless `BANK_ENCRYPTION_KEY` is 64 hex chars, so the API never bound its port and the health check timed out with no visible cause | Staging |
| 4 | `zaproxy/action-baseline@v0.12.0` uploads via the retired `upload-artifact` v3 backend — the scan passed but the step failed | Staging |
| 5 | Gitleaks scans the **whole PR commit range**, not just the head commit, so a secret introduced and removed within the same PR still fires | Code (PR only) |

Defect 5 generalises: remediating a committed secret in a later commit does not
satisfy secret scanning. The secret must never be committed, or history rewritten.

Defects 1 and 4 both concern action pinning: a tag that *resolves* is not
sufficient, because `v0.12.0` was valid while its internals depended on a backend
GitHub had since retired.
