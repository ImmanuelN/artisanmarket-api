# Kubernetes manifests — ArtisanMarket API

Applied in order:

```sh
# SEED-IAC-01: k8s/networkpolicy.yaml is deliberately absent.
kubectl apply -f k8s/namespace.yaml
# create the Secret (below) before the Deployment, or pods will CrashLoopBackOff
kubectl apply -f k8s/deployment.yaml
kubectl apply -f k8s/service.yaml
```

## The Secret is deliberately not in this directory

There is no `secret.yaml` here, and that is intentional. A committed Secret
manifest is a committed secret — base64 is encoding, not encryption — and it is
the same class of problem as the hardcoded `JWT_SECRET` fallbacks that threat
T3 records and that `config/secrets.js` now prevents. It would also be caught
by the Code-stage Gitleaks gate, correctly.

Create it out of band instead:

```sh
kubectl create secret generic artisanmarket-api-secrets \
  --namespace artisanmarket \
  --from-literal=MONGODB_URI='mongodb+srv://...' \
  --from-literal=JWT_SECRET="$(openssl rand -hex 32)" \
  --from-literal=BANK_ENCRYPTION_KEY="$(openssl rand -hex 32)"
```

For anything beyond a demonstration cluster, source these from a real secret
store (Sealed Secrets, External Secrets Operator, or the cloud provider's
manager) rather than `--from-literal`.

## Required keys

These three are **hard** requirements — the application calls `process.exit(1)`
rather than starting degraded if any is absent:

| Key | Enforced by | Notes |
|---|---|---|
| `JWT_SECRET` | `config/secrets.js` → `assertRequiredSecrets()` at `server.js:48` | Any non-empty value |
| `BANK_ENCRYPTION_KEY` | `utils/encryption.js` | Must be **exactly 64 hex characters** (32 bytes) |
| `MONGODB_URI` | `config/database.js` | Exits when unreachable unless `NODE_ENV=development` |

Optional keys, added to the same Secret as needed. Each degrades gracefully when
absent — the feature disables itself rather than running on a placeholder:

`REDIS_URL` · `STRIPE_SECRET_KEY` · `STRIPE_PUBLISHABLE_KEY` ·
`STRIPE_WEBHOOK_SECRET` · `PLAID_CLIENT_ID` · `PLAID_SECRET` · `PLAID_ENV` ·
`IMAGEKIT_PUBLIC_KEY` · `IMAGEKIT_PRIVATE_KEY` · `IMAGEKIT_URL_ENDPOINT` ·
`CLIENT_URL` · `CORS_ORIGINS`

## Hardening applied

Scanned by Checkov in the Build stage. The namespace enforces the `restricted`
Pod Security Standard, so these are rejected at admission rather than only
flagged:

| Control | Setting |
|---|---|
| Non-root | `runAsNonRoot: true`, `runAsUser: 1000` (the `node` user in the image) |
| Privilege escalation | `allowPrivilegeEscalation: false`, `privileged: false` |
| Filesystem | `readOnlyRootFilesystem: true`, with an `emptyDir` at `/tmp` |
| Capabilities | `drop: [ALL]` |
| Syscalls | `seccompProfile: RuntimeDefault` |
| Resources | explicit CPU, memory and ephemeral-storage requests **and** limits |
| API credential | `automountServiceAccountToken: false` |
| Image | pinned tag, never `:latest`; `imagePullPolicy: Always` |
| Probes | startup, readiness (`/health`, gates on Mongo) and liveness (`/ping`) |

## Deliberate non-hardening

`readOnlyRootFilesystem` requires the `/tmp` `emptyDir` mount. Removing that
mount would break `os.tmpdir()` writes; removing the read-only flag instead
would be the weaker trade.
