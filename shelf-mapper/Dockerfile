# Shelf Mapper — production Docker image (DigitalOcean / Hyperspace stack)
FROM node:20-slim AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

ARG NEXT_PUBLIC_PERSISTENCE=api
ENV NEXT_PUBLIC_PERSISTENCE=${NEXT_PUBLIC_PERSISTENCE}
ENV NEXT_PUBLIC_API_BASE=

RUN npm run build

FROM node:20-slim

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

EXPOSE 3000

CMD ["node", "server.js"]
