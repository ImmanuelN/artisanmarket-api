# Quality gate configuration

**Decision date:** 2026-10-01

The Code stage treats SonarQube as a **gate**, not a reporting step:
`sonar.qualitygate.wait=true` makes the scanner wait for the server-side result
and fail the build when it is `ERROR`. Without it the step uploads findings and
passes regardless — which is how a Security rating of **E** sat next to a green
pipeline on this project's first Sonar run.

## The gate is SonarCloud's default, "Sonar way"

| Condition | Threshold |
|---|---|
| `new_security_rating` | worse than A fails |
| `new_reliability_rating` | worse than A fails |
| `new_maintainability_rating` | worse than A fails |
| `new_coverage` | below 80% fails |
| `new_duplicated_lines_density` | above 3% fails |
| `new_security_hotspots_reviewed` | below 100% fails |

### Why not a custom gate

A custom gate — *Sonar way* without the coverage condition — was considered and
**rejected on cost**. SonarCloud restricts assigning any gate other than the
default to paid plans, and this project is bound by the open-source and
free-tooling constraint in Section 7.2 of the proposal.

The free tier therefore fixes the conditions, including the 80% coverage
threshold. The project meets them rather than relaxing them.

This is worth recording as a finding about tool selection rather than a
footnote: a free-tier hosted scanner can constrain engineering decisions in ways
the tool's feature list does not make obvious, and the constraint only surfaced
at the point of trying to act on it. The alternative that preserves custom gates
within the budget constraint is self-hosted SonarQube Community Edition, which
supports them — at the cost of running a server reachable from CI, judged
disproportionate for this prototype.

## Reaching the coverage threshold

The project had no tests at all when SonarQube was first wired in, so
`new_coverage` was 0% and the gate failed outright.

A suite was written rather than the threshold avoided:

| Suite | Tests | Target |
|---|---|---|
| `tests/sanitize.test.js` | 29 | the sanitisers, as security properties |
| `tests/errorHandler.test.js` | 9 | credential redaction and log injection |
| `tests/productRoutes.integration.test.js` | 9 | product query construction, real MongoDB |
| `tests/routes.integration.test.js` | 7 | auth and order query construction |

These assert security properties rather than chasing lines: that an injected
operator cannot change what a query matches, that a catastrophic regex is
matched literally, that card numbers never reach a log. A regression that
reintroduces a vulnerability fails the build here rather than only being
re-reported by the scanner.

The suite earned its place immediately by catching a real bug in work done
earlier in the same session: the error-handler redaction compared whole keys
against a camelCase list while lowercasing the key, so `cardNumber` became
`cardnumber`, never matched, and card and account numbers were still being
logged in full.

### A testability finding

Making the route tests runnable surfaced two properties of the codebase:

1. **Modules fail closed at import time.** `utils/encryption.js` and
   `config/secrets.js` call `process.exit(1)` without their secrets. That is
   correct — it is the threat T3 remediation — but it means anything importing
   them needs values present, which `tests/setup.js` generates per run.
2. **`routes/productRoutes.js` imports `{ io }` from `server.js`**, so importing
   that one route boots the whole application: `connectDB()`, the secret
   assertions and a listening socket. It is the **only** route that does; the
   others load cleanly. The coupling is stubbed at the test boundary rather than
   refactored, and recorded here as a design issue — that route was untestable
   in isolation until mocked.

Also corrected here: `tests/setup.js` was initially analysed as production
source, because `sonar.test.inclusions` only matched `*.test.js`. It contributed
six uncovered lines to the coverage calculation before the pattern was widened
to `tests/**/*`.

## Known false positives, marked in SonarCloud

Two `jssecurity:S5147` (NoSQL injection, BLOCKER) findings at
`routes/authRoutes.js` are marked **False Positive**. Marking issues is
available on the free tier; only custom gates are not.

They are genuinely not exploitable. The value reaching the Mongoose filter is
guarded by `typeof email === 'string'`, so `{ $ne: null }` becomes `undefined`
and the filter matches nothing. Both routes additionally run
`express-validator`'s `isEmail()` ahead of the query, and
`tests/routes.integration.test.js` asserts directly that an operator object
cannot authenticate.

Three forms were tried before concluding this: the raw value, a shared
`asString()` helper, and an inline `typeof` guard. Sonar reported the flow in
every case — **its taint analysis does not track sanitisation through a type
guard or a custom function.** Further restructuring would have made the code
worse to satisfy a tool rather than to improve security.

This is a reportable result in its own right: SAST false positives survive
correct remediation when the analyser cannot see the sanitiser, and a process
requiring every finding to reach zero will eventually pressure engineers into
contorting working code.
