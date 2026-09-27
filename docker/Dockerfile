FROM oven/bun:1.3.14-alpine AS build

WORKDIR /app

COPY package.json bun.lock ./
COPY server/package.json ./server/package.json

COPY server ./server
COPY database ./database
COPY web ./web

RUN bun install --frozen-lockfile
RUN bun run --cwd server build

FROM build AS migrate

CMD ["bun", "run", "--cwd", "server", "migrate"]

FROM node:22-alpine AS api

WORKDIR /app

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/server/node_modules ./server/node_modules
COPY --from=build /app/server/package.json ./server/package.json
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/web ./web

WORKDIR /app/server

# The API only needs to read its built files and listen on an unprivileged
# port. Keep the runtime container away from root even when the host is VPS.
USER node

CMD ["node", "dist/index.js"]
