# Artisan Market — Threat Model

**Stage:** Plan (Section 4.3.1) · **Tool:** OWASP Threat Dragon · **Status:** Reviewed

This document is the Plan-stage artifact required before a feature proceeds to Code.
It is exported/summarised from the OWASP Threat Dragon model for Artisan Market and
covers the core flows: browsing/search, account registration and login, cart and
checkout, and product reviews.

## Scope and trust boundaries

- **External entity:** Shopper (browser)
- **Process:** Express application (`src/app.js` and routers)
- **Data store:** SQLite database (`artisan_market.db`)
- **Trust boundary:** Public internet ↔ application process; application process ↔ database file

## STRIDE analysis (summary)

| # | Element | Threat (STRIDE) | Description | Mitigation / control |
|---|---|---|---|---|
| T1 | Search endpoint | Tampering | User-controlled `q` reaches SQL without parameterisation | SAST gate (SonarQube) at Code stage; rewrite as parameterised query |
| T2 | Review submission | Tampering / Elevation of Privilege | Unescaped review body renders as HTML/JS for later visitors (stored XSS) | SAST + DAST gates (SonarQube, OWASP ZAP); escape output in the view |
| T3 | Session handling | Information Disclosure | Hardcoded fallback session secret would let an attacker forge session cookies if the env var is ever unset | Secret-scanning gate (Gitleaks) at Code stage; remove fallback, fail fast if unset |
| T4 | Login/register | Spoofing | Credential stuffing / brute force against `/login` | Rate limiting — **not yet implemented**; tracked as a Chapter 5 finding, not a blocking gate today |
| T5 | Third-party packages | Tampering | A dependency could ship a known vulnerability (e.g. via transitive packages) | SCA gate (Snyk / `npm audit`) at Build stage |
| T6 | Container image | Tampering | Base image or installed OS packages could carry known CVEs | Container scan (Trivy) at Build stage |
| T7 | Deployment manifests | Tampering / Denial of Service | Misconfigured Kubernetes/compose manifests (e.g. missing resource limits, root containers) | IaC scan (Checkov) at Build stage |
| T8 | Order/checkout | Repudiation | No payment processor is integrated (mock checkout only); out of scope per Section 7.1 delineations | Documented limitation, not a control gap |

T1–T3 above are the three intentionally seeded "before" cases described in Chapter 4
(SAST-2024-01, SAST-2024-02, SECRET-2024-01), kept in the codebase so the pipeline
gates in this chapter have something real to catch and report on for Chapter 5.

## Sign-off

Reviewed and approved to proceed to the Code stage.

- **Reviewer:** _[supervisor / lead developer name]_
- **Date:** _[sign-off date]_
