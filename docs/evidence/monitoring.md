# Monitor stage — continuous compliance reporting

**Purpose:** record what the Monitor stage does, why it was rebuilt, and what it
found the first time it was tested. This is the source for the Monitor
component in the model design chapter.

## What it was, and why that was not acceptable

The first Monitor job wrote a fixed block of text to the run summary. It did not
read any result. Two consequences, both observed:

- On the `main` run of 2026-10-05 (run `37274448884`), the dependency audit
  failed and the Deploy stage was **skipped**. Monitor still succeeded and
  printed `Release gate (Deploy): passed`.
- It listed `Snyk on staging and main` as an active control. Snyk is not
  configured in this repository and has never run.

A monitoring stage that reports controls which did not run is worse than none,
because it is read as evidence.

## What it is now

`scripts/compliance-report.js`, run by the Monitor job, reads the **outcome of
every control's own step** — exported by each job as an output — and reports
each one as `passed`, `FAILED` or `not run`. A control that was skipped,
cancelled, or whose job never ran is `not run`, never `passed`.

| Stage | Control | Tool | PCI DSS v4.0.1 | GDPR |
|---|---|---|---|---|
| Plan | Threat model gate | OWASP Threat Dragon model, `docs/threat-model.json` | 6.2.1 | Art. 25(1) |
| Code | Security lint ruleset | ESLint | 6.2.4 | Art. 25(1) |
| Code | Security regression tests | Jest | 6.2.4 | Art. 32(1)(d) |
| Code | Secret scanning | Gitleaks | 8.6.2 | Art. 32(1)(b) |
| Code | Static analysis and quality gate | SonarQube (SonarCloud) | 6.2.3, 6.2.4 | Art. 25(1) |
| Code | Dependency audit | npm audit + audit gate | 6.3.1, 6.3.3 | Art. 32(1)(b) |
| Build | Dependency analysis *(optional)* | Snyk | 6.3.1 | Art. 32(1)(b) |
| Build | Dependency and config scan | Trivy (filesystem) | 6.3.1, 6.3.2 | Art. 32(1)(b) |
| Build | Container image scan | Trivy (image) | 6.3.1, 6.3.3 | Art. 32(1)(b) |
| Build | Infrastructure-as-code scan | Checkov | 1.3.1, 2.2.1 | Art. 32(1)(b) |
| Staging | Dynamic scan of the running app | OWASP ZAP (baseline) | 6.2.4 | Art. 32(1)(d) |
| Deploy | Release gate | `needs` chain | 6.5.1 | Art. 32(1)(d) |

The job **fails unless every required control passed**. Snyk is reported but
marked optional, so its absence is visible without failing every run.

It also prints the **accepted-risk register**: each advisory the dependency gate
is currently allowed to pass, with its review date, warning 14 days before it
falls due.

Every report is stored as a run artifact (`compliance-report.md` and `.json`)
for 90 days, so the posture has a dated history rather than only a latest state.

### The compliance columns are an alignment, not an assessment

Each automated control *supports* part of the requirement cited. None satisfies
a requirement on its own, and most of PCI DSS — people, process, physical
security — cannot be evidenced by any pipeline. The report says so on every run.

One mapping needs particular care. A ZAP **baseline** scan is passive: it crawls
the application and inspects responses; it does not attack it. It supports
PCI DSS 6.2.4 but does **not** satisfy 6.4.2, which requires an automated
technical solution that continually detects and prevents web-based attacks.

> The clause numbers were chosen against PCI DSS v4.0.1 and GDPR as published.
> Verify each against the standard's own text before citing them in the thesis.

## Continuous: a daily schedule

The workflow now also runs on `schedule` (daily, 02:23 UTC) and on
`workflow_dispatch`. A scheduled run on the default branch resolves to
production, so every stage runs and Monitor reports on the result.

The reason is evidenced, not assumed. A commit that passes every gate can become
vulnerable later, with no change to the repository, when an advisory is published
against something it already ships. That happened twice in this project:

| Advisory | Package | Surfaced by |
|---|---|---|
| CVE-2026-103111 | `pcre2` (client base image) | an unrelated docs merge |
| GHSA-vfj7-8cjw-p6xm | `braces` (dev tooling, both repos) | an unrelated coverage fix |

Both were found only because a commit happened to trigger a run. A schedule
removes the dependence on that coincidence.

GitHub disables scheduled workflows in a public repository after 60 days without
activity. If that happens, re-enable the workflow from the Actions tab.

## What the first full-history scan found

On push and pull-request events Gitleaks scans only the commits being
introduced. On a scheduled or manual run it scans the **entire history**. That
had never been done, so it was run locally first, with the same Gitleaks version
the action uses (8.24.3), against a fresh clone.

### 1. History that had never been scanned

`main` contained **11 hits** in `test-vendor-bank-curl.md`, a curl how-to added
on 2025-08-08 — before the pipeline existed — and still in the tree. Every hit
was a placeholder bearer token: `YOUR_VENDOR_TOKEN` (×9), `CUSTOMER_TOKEN`,
`INVALID_TOKEN`. No live credential.

The finding is not the placeholders; it is that a file present in the tree for
two months had never been examined. Commit-range scanning only ever sees new
commits, so anything committed before the scanner was introduced is outside its
view until something scans history in full.

The three names are allowlisted exactly in `.gitleaks.toml` — not the file and
not the rule — so a real token in the same file still fails the stage.

### 2. The seeded cases would have made every scheduled run fail

`actions/checkout` with `fetch-depth: 0` fetches every branch, and a full scan
covers every ref it finds. That includes the seeded-case branches, which are
deliberately vulnerable and unmerged: `seed/secret-01` carries a committed
secret by design, so every nightly run would have failed on a test fixture.

The Code stage now drops all other branch refs before Gitleaks runs on a
scheduled or manual trigger, scoping the history scan to the branch being
verified. Tags are kept; all of them point at commits on `main`.

### Verification

| Scan | Findings |
|---|---|
| Full history, all refs, new config | 1 — `config/legacy-session.example.js` on `seed/secret-01` |
| Full history, scoped to `main` (a scheduled run) | **0** |

The first row matters as much as the second. The one remaining hit is the
seeded secret, which shows that the allowlist suppresses only the documented
placeholders and still detects a real-shaped secret.
