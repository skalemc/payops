# ── Build stage ───────────────────────────────────────────────────────────────
FROM node:22-alpine AS base

WORKDIR /app

# Install dependencies first (cached layer)
COPY package.json ./
RUN npm install --omit=dev

# Copy source
COPY . .

# ── Production image ──────────────────────────────────────────────────────────
FROM node:22-alpine AS production

# Security: non-root user
RUN addgroup -g 1001 -S payops && adduser -u 1001 -S payops -G payops

WORKDIR /app

COPY --from=base --chown=payops:payops /app/node_modules ./node_modules
COPY --chown=payops:payops . .

USER payops

ENV NODE_ENV=production
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://localhost:4000/health || exit 1

CMD ["node", "index.js"]
