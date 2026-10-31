FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates python3 make g++ && rm -rf /var/lib/apt/lists/*
RUN npm install -g pnpm@11.25.0
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile && pnpm --filter @partneros/database generate && pnpm build && touch .env && chown -R node:node /app
USER node
ENV NODE_ENV=production HOST=127.0.0.1 WEB_HOST=0.0.0.0 PORT=4000 WEB_PORT=3000
EXPOSE 3000
CMD ["node", "deploy/container-start.mjs"]
