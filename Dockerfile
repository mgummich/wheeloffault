# syntax=docker/dockerfile:1
FROM node:26-alpine AS build
WORKDIR /app
RUN npm install -g pnpm@11.24.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:26-alpine
ENV NODE_ENV=production PORT=3000 DATA_DIR=/data
WORKDIR /app
COPY --from=build /app/dist/web ./dist/web
COPY --from=build /app/src/domain ./src/domain
COPY --from=build /app/src/server ./src/server
RUN find src -name '*.test.ts' -delete
COPY package.json ./
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "src/server/main.ts"]
