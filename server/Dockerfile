# syntax=docker/dockerfile:1
# Express + Mongoose API. Build context MUST be the repo root (npm workspaces):
#   docker build -f server/Dockerfile -t scp-server .

# ---------- Build: install all deps, compile TS -> dist ----------
FROM node:20-alpine AS build
WORKDIR /app
# Manifests first so `npm ci` is cached until a package.json/lockfile changes.
COPY package.json package-lock.json ./
COPY server/package.json ./server/package.json
COPY mobile/package.json ./mobile/package.json
RUN npm ci
COPY server ./server
RUN npm run build -w server

# ---------- Production deps only (no devDependencies) ----------
FROM node:20-alpine AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json ./server/package.json
COPY mobile/package.json ./mobile/package.json
RUN npm ci --omit=dev

# ---------- Runtime: minimal, non-root ----------
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -S app && adduser -S app -G app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/server/dist ./server/dist
COPY package.json ./package.json
COPY server/package.json ./server/package.json
# Coach/avatar media uploads are written under here at runtime (services/media.ts
# mkdirSync's it on import) — must exist and be writable by the non-root user
# *before* USER switches, since /app itself is root-owned.
RUN mkdir -p /app/uploads && chown -R app:app /app/uploads
USER app
EXPOSE 4000
# Reads config from env (MONGODB_URI, JWT_*, CORS_ORIGIN, PORT) — see server/src/config/env.ts
CMD ["node", "server/dist/index.js"]
