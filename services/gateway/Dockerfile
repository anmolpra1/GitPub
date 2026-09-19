# Multi-stage Dockerfile for GitPub Go Protocol Gateway
FROM golang:1.22-alpine AS builder

WORKDIR /app

# Install build dependencies
RUN apk add --no-cache git

COPY go.mod ./
RUN go mod download || true

COPY . .

# Build statically linked binary
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o gateway cmd/server/main.go

# Production runtime image
FROM alpine:3.19

# Install Git and ca-certificates (REQUIRED for git upload-pack and git receive-pack subprocess streaming)
RUN apk add --no-cache git ca-certificates

WORKDIR /app

COPY --from=builder /app/gateway /app/gateway

# Create default storage directory for bare repositories
RUN mkdir -p /data/repos

ENV PORT=8081
ENV REPOS_ROOT=/data/repos
ENV API_URL=http://localhost:8080

EXPOSE 8081

CMD ["/app/gateway"]
