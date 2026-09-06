# Stage 1: Build & compile TypeScript and native dependencies
FROM node:20-bookworm-slim AS builder

WORKDIR /app

# Install compilation tools required for better-sqlite3
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Copy package manifests
COPY package*.json ./

# Install all dependencies (including devDependencies for tsc)
RUN npm ci

# Copy source code and build
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Remove devDependencies to keep final image minimal
RUN npm prune --omit=dev

# Stage 2: Minimal production image
FROM node:20-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    STATE_DIR=/app/state

# Copy runtime assets and compiled output
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY public ./public
COPY test-events ./test-events

# Create directory for persistent SQLite state
RUN mkdir -p /app/state

# Expose port
EXPOSE 3000

# Container healthcheck
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD node -e "fetch('http://localhost:3000/api/status').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

# Start application
CMD ["node", "dist/server.js"]
