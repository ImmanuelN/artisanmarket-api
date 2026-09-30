# ArtisanMarket API — production image
#
# Build stage installs production dependencies only; the runtime stage carries
# no npm cache, no dev dependencies and no build toolchain.
#
# No secrets are baked in and no fallback values are supplied. The application
# already fails closed on a missing secret (config/secrets.js
# assertRequiredSecrets, utils/encryption.js, config/database.js), and this
# image preserves that: a container started without JWT_SECRET,
# BANK_ENCRYPTION_KEY or MONGODB_URI exits rather than running degraded.

# ---------- dependencies ----------
FROM node:20-alpine AS deps

WORKDIR /app

# Copy manifests only, so the dependency layer is cached independently of source.
COPY package.json package-lock.json ./

# npm ci honours the lockfile exactly, which keeps the image reproducible and
# keeps what Trivy scans identical to what the SCA gate scanned.
RUN npm ci --omit=dev && npm cache clean --force

# ---------- runtime ----------
FROM node:20-alpine AS runtime

# dumb-init gives PID 1 correct signal handling, so SIGTERM reaches the app and
# the existing graceful-shutdown handlers in config/database.js actually run.
RUN apk add --no-cache dumb-init

ENV NODE_ENV=production \
    PORT=5000 \
    NPM_CONFIG_UPDATE_NOTIFIER=false

WORKDIR /app

# node:alpine ships an unprivileged `node` user (uid/gid 1000). Use it rather
# than creating another, and own the app directory so a read-only root
# filesystem is still viable.
COPY --chown=node:node --from=deps /app/node_modules ./node_modules
COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node server.js ./
COPY --chown=node:node config ./config
COPY --chown=node:node middleware ./middleware
COPY --chown=node:node models ./models
COPY --chown=node:node routes ./routes
COPY --chown=node:node utils ./utils

USER node

EXPOSE 5000

# The app exposes /health (server.js) reporting Mongo connectivity. Kubernetes
# probes are defined in k8s/ and take precedence there; this HEALTHCHECK covers
# plain `docker run`.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||5000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "server.js"]
