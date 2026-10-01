# Multi-stage Dockerfile for GitPub REST API & BullMQ Queue Worker
FROM node:22-bookworm-slim AS builder

WORKDIR /app

# Install native compilation dependencies for node-gyp (argon2)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/

RUN npm run build

# Production runtime image
FROM node:22-bookworm-slim

# Install Git and build essentials for runtime native modules
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    ca-certificates \
    curl \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev && apt-get purge -y make g++ && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*

COPY migrations/ ./migrations/
COPY --from=builder /app/dist ./dist

# Create storage directories
RUN mkdir -p /data/repos /scratch

ENV PORT=8080
ENV NODE_ENV=production
ENV REPOS_ROOT=/data/repos
ENV SCRATCH_ROOT=/scratch

EXPOSE 8080

CMD ["sh", "-c", "npm run migrate:up && npm start"]
