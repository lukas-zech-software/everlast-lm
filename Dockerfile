# Everlast LM v1 runtime image (Cloud Run api + worker; SERVICE_ROLE selects the service).
FROM node:26-slim AS build
WORKDIR /app
ENV CI=true
RUN npm install --global pnpm@12.0.0
COPY . .
RUN pnpm install --frozen-lockfile && node scripts/build-web.mjs \
  && find . -name node_modules -type d -prune -exec rm -rf {} + \
  && pnpm install --frozen-lockfile --prod

FROM node:26-slim
WORKDIR /app
ENV NODE_ENV=production WEB_DIST_DIR=/app/apps/web/dist PORT=8080
COPY --from=build /app /app
USER node
EXPOSE 8080
CMD ["node", "scripts/start.mjs"]
