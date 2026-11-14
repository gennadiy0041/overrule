# --- build: install everything, bundle the web app ---------------------------
FROM oven/bun:1 AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

# --- runtime: production dependencies, server source, data, built web app ----
FROM oven/bun:1 AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production
COPY --from=build /app/dist ./dist
COPY src ./src
COPY data/occupations.json data/alt-titles.json data/modern-titles.json ./data/
COPY data/pool ./data/pool
EXPOSE 3000
CMD ["bun", "src/server/index.ts"]
