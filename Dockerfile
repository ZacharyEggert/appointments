FROM node:26-alpine
RUN apk add --no-cache openssl && npm install --global pnpm@11.25.0
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm prisma generate && pnpm build
ENV NODE_ENV=production
EXPOSE 3000
CMD ["pnpm", "run", "docker-start"]
