# everlast-render Cloud Run Job image (FR-SI-01, specs/009 T013): LibreOffice (Writer/Impress) + ffmpeg.
# Build from the repository root: docker build -f apps/render/Dockerfile .
FROM node:26-slim AS build
WORKDIR /app
ENV CI=true
RUN corepack enable && corepack prepare pnpm@12.0.0 --activate
COPY . .
RUN pnpm install --frozen-lockfile --filter @everlast/render... \
  && find . -name node_modules -type d -prune -exec rm -rf {} + \
  && pnpm install --frozen-lockfile --prod --filter @everlast/render...

FROM node:26-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends libreoffice-writer-nogui libreoffice-impress-nogui ffmpeg fonts-dejavu-core \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app /app
USER node
# One execution per conversion; arguments arrive as RENDER_* environment overrides from the worker.
CMD ["node", "apps/render/src/main.ts"]
