# genesis — portal image.
#
# Three stages so the runtime layer carries only the standalone server plus the
# two things Next's output tracing does not copy for us: the SQLite driver's
# native binding, and the schema the app reads at boot.
FROM node:22-alpine AS deps
WORKDIR /app
# better-sqlite3 is a native module with no prebuilt binary for musl, so it is
# compiled here. The toolchain lives in this stage only — the runtime layer
# copies the built module, not the compiler.
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-alpine AS run
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# The standalone server, its traced dependencies, and the static assets.
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
# better-sqlite3 is a native module and is marked serverExternalPackages, so it
# is not traced into the standalone bundle — copy it explicitly.
COPY --from=build /app/node_modules/better-sqlite3 ./node_modules/better-sqlite3
# The schema is read from disk at first connection, and the migrations run after
# it — the EIN filing column has to reach a database created before it existed.
COPY --from=build /app/scripts/schema.sql ./scripts/schema.sql
COPY --from=build /app/scripts/migrations ./scripts/migrations

RUN mkdir -p /app/data
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
