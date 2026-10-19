# Everlast LM v1 runtime image (Cloud Run api + worker; SERVICE_ROLE selects the service).
FROM node:24-slim AS build
WORKDIR /app
ENV CI=true
RUN corepack enable && corepack prepare pnpm@10.31.0 --activate
COPY . .
RUN pnpm install --frozen-lockfile && node scripts/build-web.mjs \
  && find . -name node_modules -type d -prune -exec rm -rf {} + \
  && pnpm install --frozen-lockfile --prod

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production WEB_DIST_DIR=/app/apps/web/dist PORT=8080
COPY --from=build /app /app
USER node
EXPOSE 8080
CMD ["node", "scripts/start.mjs"]
