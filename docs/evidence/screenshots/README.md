# Screenshots to capture

The evidence documents reference these images. Each entry gives the exact URL
and what should be visible, so the capture matches what the surrounding text
claims. Save with the filename given — the documents already link to them.

Capture at a width that keeps text legible when the document is printed; a
browser window around 1400px wide is usually right. Crop to the panel described
rather than capturing the whole page.

> **Before capturing anything:** these pages show a real organisation. Check
> nothing sensitive is in frame — tokens in a URL bar, unrelated private
> repositories in a sidebar, email addresses in an account menu. Crop or blur
> rather than publishing them into a thesis appendix.

## Status

| File | State |
|---|---|
| `sonar-gate-passed-api.png` | captured, embedded in `quality-gate.md` |
| `sonar-coverage-api.png` | captured, embedded in `quality-gate.md` |
| `sonar-overview-api.png` | captured, embedded in `end-to-end-run.md` |
| `sonar-false-positive.png` | captured, embedded in `quality-gate.md` |
| `pipeline-six-stages-green.png` | captured, embedded in `end-to-end-run.md` |
| `seed-*-blocked.png` (7) | captured, embedded in `seeded-cases.md` |

Everything below is kept as the capture record. Two files arrived named
`*.png.png` and were renamed; save as `name.png`, not `name.png.png`, or the
embed will not resolve.

---

## 1. `sonar-gate-passed-api.png`

**Referenced by:** `quality-gate.md` — the Result section.

```
https://sonarcloud.io/dashboard?id=ImmanuelN_artisanmarket-api&pullRequest=10
```

Capture the **Quality Gate** panel showing **Passed**, with all six conditions
and their values visible. This is the central claim of the document — that the
project passes the unmodified default gate.

## 2. `sonar-coverage-api.png`

**Referenced by:** `quality-gate.md` — the coverage section.

Same page. Capture the **Coverage on New Code** measure showing **80.1%**
against the 80% threshold.

## 3. `sonar-overview-api.png`

**Referenced by:** `end-to-end-run.md`.

```
https://sonarcloud.io/dashboard?id=ImmanuelN_artisanmarket-api
```

The project overview with the Security, Reliability and Maintainability ratings.

> **Read this before capturing.** As of 2026-10-02 this page shows Security
> **E** with **13** open issues, not a clean rating, while the quality gate on
> the same page reads **Passed**. Both are correct and the difference is the
> point: the gate is evaluated on **New Code**, whereas the letter ratings are
> evaluated on the **whole codebase**, including code written before the
> pipeline existed.
>
> The 13 break down as 8 `jssecurity:S5147` of the same false-positive class
> already documented in `quality-gate.md` but not yet marked on the `main`
> branch, 4 `jssecurity:S5145` in `monitor-server.js`, and the 1 accepted
> `javascript:S5542`. See the "Overall ratings versus the gate" section of
> `quality-gate.md` before presenting this screenshot, because an examiner
> will read "Security E" as contradicting the remediation claim unless the
> New Code distinction is made explicitly.
>
> Capture the Quality Gate panel and the letter ratings **in the same frame**,
> so the two coexisting facts are visible together rather than appearing to
> contradict each other across two figures.

## 4. `pipeline-six-stages-green.png`

**Referenced by:** `end-to-end-run.md`.

```
https://github.com/ImmanuelN/artisanmarket-api/actions
```

Open the most recent successful run on `feat/sonar-activation` and capture the
job list showing all eight jobs green — Context, Plan, Code (SAST), Code (SCA),
Build, Staging/DAST, Deploy, Monitor. This is the Section 6.2 demonstration
evidence.

## 5. `seed-sast-01-blocked.png` … `seed-dast-01-blocked.png`

**Referenced by:** `seeded-cases.md`.

One per seeded case. Open each draft PR and capture the failed check, with the
**failing stage name visible** — the point is which gate caught it, not that
something was red.

| File | PR | Failing step to capture |
|---|---|---|
| `seed-sast-01-blocked.png` | [#3](https://github.com/ImmanuelN/artisanmarket-api/pull/3) | Code · **ESLint (security ruleset)** |
| `seed-secret-01-blocked.png` | [#4](https://github.com/ImmanuelN/artisanmarket-api/pull/4) | Code · **Gitleaks** |
| `seed-dast-01-blocked.png` | [#5](https://github.com/ImmanuelN/artisanmarket-api/pull/5) | Staging · **OWASP ZAP baseline** |
| `seed-sca-01-blocked.png` | [#7](https://github.com/ImmanuelN/artisanmarket-api/pull/7) | Build · **Trivy (filesystem)** |
| `seed-iac-01-blocked.png` | [#11](https://github.com/ImmanuelN/artisanmarket-api/pull/11) | Build · **Checkov (Kubernetes)** |
| `seed-image-01-blocked.png` | [#12](https://github.com/ImmanuelN/artisanmarket-api/pull/12) | Build · **Trivy (container image)** |
| `seed-sonar-01-blocked.png` | [#13](https://github.com/ImmanuelN/artisanmarket-api/pull/13) | Code · **SonarQube** |

Three of these need a passing step in the same frame as the failing one,
because the **contrast** is the finding rather than the failure:

| File | Must also show | Why |
|---|---|---|
| `seed-sca-01-blocked.png` | `npm audit` **passing** | one SCA tool reports the tree clean while the other blocks |
| `seed-image-01-blocked.png` | Trivy **filesystem** scan passing | the two Trivy modes inspect different things; only the image scan sees a vulnerable base |
| `seed-sonar-01-blocked.png` | ESLint, Gitleaks, npm audit **and the test step** all passing | this is the case that justifies SAST in the model — every other Code-stage gate is green |

For `seed-iac-01-blocked.png`, capture the **SonarQube step passing** alongside
the Checkov failure. SonarQube has Kubernetes rules of its own and catches a
subset of IaC misconfiguration; this case was deliberately chosen as one it
cannot see, so the pair of results is what demonstrates Checkov's distinct
contribution.

## 6. `sonar-false-positive.png`

**Referenced by:** `quality-gate.md` — the false positives section.

```
https://sonarcloud.io/project/issues?id=ImmanuelN_artisanmarket-api&pullRequest=10
```

Open the link, then filter to **Rule: `jssecurity:S5147`** and set the
resolution facet to include resolved issues — the facet names change between
SonarCloud releases, so navigate rather than relying on a query-string.

One of the two `S5147` issues showing the **False Positive** resolution **and
the comment explaining why**. The comment is the part that matters — it is what
distinguishes an analysed finding from a suppressed one.
