# Stage 1: Build
FROM node:20-alpine AS builder

WORKDIR /app

# Install build tools for native modules
RUN apk add --no-cache python3 make g++

COPY package.json package-lock.json ./
RUN npm install --ignore-scripts=false

COPY . .
RUN npm run build

# Stage 2: Production
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=5000

# Copy built output, node_modules, and startup script from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/scripts/migrate-and-start.sh ./migrate-and-start.sh

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- http://localhost:5000/api/health || exit 1

CMD ["sh", "./migrate-and-start.sh"]
