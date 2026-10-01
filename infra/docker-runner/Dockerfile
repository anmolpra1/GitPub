FROM node:20-bookworm-slim

# Install Python 3, pip, git, and core utilities for multi-language testing
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-venv \
    git \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Use non-root node user (uid 1000) for hardened sandboxing
USER node
WORKDIR /workspace
