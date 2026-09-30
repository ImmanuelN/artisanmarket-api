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
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# ---------- runtime ----------
FROM node:20-alpine AS runtime

# dumb-init gives PID 1 correct signal handling, so SIGTERM reaches the app and
# the existing graceful-shutdown handlers in config/database.js actually run.
#
# libcrypto3/libssl3 are upgraded explicitly: the pinned base still carries
# openssl 3.5.6-r0, which Trivy flags for CVE-2026-14456 (DoS) and
# CVE-2026-45447 (heap use-after-free), both fixed in 3.5.8-r0. Patching here
# rather than waiting for a rebuilt base image.
RUN apk add --no-cache dumb-init \
    && apk add --no-cache --upgrade libcrypto3 libssl3

# Run as a high UID (>10000) so the container user cannot collide with a real
# user on the host (CKV_K8S_40). The base image's `node` user is uid 1000, which
# is inside the range a host is likely to assign.
RUN addgroup -g 10001 -S app \
    && adduser -u 10001 -S app -G app

ENV NODE_ENV=production \
    PORT=5000 \
    NPM_CONFIG_UPDATE_NOTIFIER=false

WORKDIR /app

# Remove npm from the runtime image. Dependencies are installed in the deps
# stage and the entrypoint is `node server.js`, so npm is never invoked here —
# but the base image bundles it along with its own dependency tree (pacote,
# sigstore, tar, cross-spawn, glob, minimatch, ip-address, brace-expansion),
# which accounted for 22 of the image's Trivy findings including the only
# CRITICAL. Deleting unused tooling is the fix; suppressing the findings is not.
RUN rm -rf /usr/local/lib/node_modules/npm \
    /usr/local/bin/npm \
    /usr/local/bin/npx \
    /opt/yarn-* \
    /usr/local/bin/yarn \
    /usr/local/bin/yarnpkg

# Files are owned by the high-UID app user so a read-only root filesystem is
# still viable and nothing needs to be writable at runtime except /tmp.
COPY --chown=10001:10001 --from=deps /app/node_modules ./node_modules
COPY --chown=10001:10001 package.json package-lock.json ./
COPY --chown=10001:10001 server.js ./
COPY --chown=10001:10001 config ./config
COPY --chown=10001:10001 middleware ./middleware
COPY --chown=10001:10001 models ./models
COPY --chown=10001:10001 routes ./routes
COPY --chown=10001:10001 utils ./utils

USER 10001

EXPOSE 5000

# The app exposes /health (server.js) reporting Mongo connectivity. Kubernetes
# probes are defined in k8s/ and take precedence there; this HEALTHCHECK covers
# plain `docker run`.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||5000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "server.js"]
