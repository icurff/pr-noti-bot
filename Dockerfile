# Stage 1: Build TypeScript & download prebuilt dependencies
FROM node:22-bookworm-slim AS builder

WORKDIR /app

# Copy package manifests
COPY package*.json ./

# Install dependencies (Node 22 matches official better-sqlite3 prebuilt binaries - NO C++ compilation needed!)
RUN npm ci

# Copy source and build TypeScript
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Remove devDependencies to keep final image minimal
RUN npm prune --omit=dev

# Stage 2: Minimal production image
FROM node:22-bookworm-slim

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
