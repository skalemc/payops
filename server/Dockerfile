FROM node:22-alpine AS base
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY . .

FROM node:22-alpine AS production
RUN addgroup -g 1001 -S payops && adduser -u 1001 -S payops -G payops
WORKDIR /app
COPY --from=base --chown=payops:payops /app/node_modules ./node_modules
COPY --chown=payops:payops . .
USER payops
ENV NODE_ENV=production
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s \
  CMD wget -qO- http://localhost:8080/health || exit 1
CMD ["node", "index.js"]
