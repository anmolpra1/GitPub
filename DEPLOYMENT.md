# GitPub — Zero-Cost Production Deployment Guide (SRS § 7 & IDEcmd § 9)

This guide provides step-by-step instructions for deploying the **GitPub Platform** into production using free-tier serverless and cloud infrastructure:

- **Frontend**: [Vercel](https://vercel.com) (Next.js 16 + React 19)
- **Protocol Gateway (Go)**: [Fly.io](https://fly.io) (Persistent volume for Git repositories)
- **REST API & BullMQ CI Worker (Node.js)**: [Fly.io](https://fly.io)
- **Relational Database**: [Neon](https://neon.tech) (Serverless PostgreSQL)
- **Job Queue Orchestration**: [Upstash](https://upstash.com) (Serverless Redis)

---

## Architecture Topology

```
                              +--------------------------+
                              |   Vercel (apps/web)      |
                              |   Next.js 16 Dashboard   |
                              +-------------+------------+
                                            |
                         HTTPS REST API     |    Git Smart HTTP Clone/Push
                                            v
     +----------------------------------+        +-----------------------------------+
     |   Fly.io (services/api)          |        |   Fly.io (services/gateway)       |
     |   Express API & BullMQ Runner    | <----> |   Go Protocol Gateway             |
     +--------+-----------------+-------+        +-----------------+-----------------+
              |                 |                                  |
Relational DB |     Redis Queue |                                  | Mounts
              v                 v                                  | (/data/repos)
     +--------+--------+ +------+-------+                          |
     | Neon PostgreSQL | | Upstash Redis|                          |
     | (Serverless)    | | (Serverless) |                          |
     +-----------------+ +--------------+                          |
              |                                                    |
              | Mounts (/data/repos)                               |
              +----------------------------+   +-------------------+
                                           |   |
                                           v   v
                               +-----------------------------------+
                               | Fly.io Persistent Volume Storage  |
                               | (gitpub_repos -> /data/repos)     |
                               +-----------------------------------+
```

---

## 1. Prerequisites & Tooling

Install the Fly.io and Vercel command-line tools:

### Install Fly CLI (`flyctl`)
```powershell
# Windows (PowerShell)
iwr https://fly.io/install.ps1 -useb | iex

# Linux / macOS
curl -L https://fly.io/install.sh | sh
```
Log in to your Fly.io account:
```bash
fly auth login
```

### Install Vercel CLI
```bash
npm install -g vercel
vercel login
```

---

## 2. Step 1: Provision Managed Database & Redis

### 1. Neon Serverless PostgreSQL
1. Sign in to [Neon Console](https://console.neon.tech).
2. Click **Create Project** -> Name it `gitpub-db`.
3. Copy the pooled connection string:
   ```env
   postgres://gitpub_owner:<password>@<endpoint>.neon.tech/gitpub?sslmode=require
   ```

### 2. Upstash Serverless Redis
1. Sign in to [Upstash Console](https://console.upstash.com).
2. Click **Create Database** -> Name it `gitpub-redis` -> Select standard Redis.
3. Copy the Redis URI:
   ```env
   rediss://default:<password>@<endpoint>.upstash.io:6379
   ```

---

## 3. Step 2: Deploy Go Protocol Gateway (`services/gateway`)

The protocol gateway streams Git packs via `io.Pipe` and stores bare Git repositories in `/data/repos`.

1. Navigate to the gateway service:
   ```bash
   cd services/gateway
   ```

2. Create a persistent volume for Git repositories:
   ```bash
   fly volumes create gitpub_repos --size 1 --region iad
   ```

3. Launch and deploy the service:
   ```bash
   fly launch --no-deploy
   fly deploy
   ```

4. Note your gateway production URL (e.g., `https://gitpub-gateway.fly.dev`).

---

## 4. Step 3: Deploy REST API & CI Worker (`services/api`)

The Node.js API runs database migrations on startup, handles user auth, pull requests, and processes CI jobs.

1. Navigate to the API service:
   ```bash
   cd services/api
   ```

2. Create a persistent volume for Git repositories:
   ```bash
   fly volumes create gitpub_repos --size 1 --region iad
   ```

3. Configure production secrets on Fly.io:
   ```bash
   fly secrets set \
     DATABASE_URL="postgres://gitpub_owner:<password>@<endpoint>.neon.tech/gitpub?sslmode=require" \
     REDIS_URL="rediss://default:<password>@<endpoint>.upstash.io:6379" \
     JWT_SECRET="generate-a-strong-random-secret-key-32-chars-long" \
     GATEWAY_URL="https://gitpub-gateway.fly.dev" \
     GOOGLE_CLIENT_ID="<your-google-client-id>.apps.googleusercontent.com" \
     ALLOW_LOCAL_CI_FALLBACK="true"
   ```

4. Launch and deploy the service:
   ```bash
   fly launch --no-deploy
   fly deploy
   ```

5. Wire the API URL back to the Gateway:
   ```bash
   cd ../gateway
   fly secrets set API_URL="https://gitpub-api.fly.dev"
   ```

---

## 5. Step 4: Deploy Next.js Web Dashboard (`apps/web`)

Deploy the frontend dashboard to Vercel:

1. Navigate to the web application directory:
   ```bash
   cd apps/web
   ```

2. Link and deploy to Vercel:
   ```bash
   vercel
   ```

3. Set Environment Variables in your Vercel project dashboard (or via CLI):
   ```bash
   vercel env add NEXT_PUBLIC_API_URL production
   # Value: https://gitpub-api.fly.dev

   vercel env add NEXT_PUBLIC_GATEWAY_URL production
   # Value: https://gitpub-gateway.fly.dev

   vercel env add NEXT_PUBLIC_GOOGLE_CLIENT_ID production
   # Value: <your-google-client-id>.apps.googleusercontent.com
   ```

4. Deploy production build:
   ```bash
   vercel --prod
   ```

---

## 6. Verification & Post-Deploy Health Check

### 1. Check API Health
```bash
curl https://gitpub-api.fly.dev/api/health
# Expected response: {"status":"healthy","database":"connected",...}
```

### 2. Verify Smart HTTP Gateway TTFB
```bash
curl -w "TTFB: %{time_starttransfer}s\n" -s https://gitpub-gateway.fly.dev/<owner>/<repo>.git/info/refs?service=git-upload-pack
```

### 3. Test Remote Git Operations with PAT
```bash
# Clone
git clone https://<username>:<pat>@gitpub-gateway.fly.dev/<username>/<repo>.git

# Push with CI workflow
cd <repo>
git add . && git commit -m "Production test push"
git push origin main
```
Output will trigger the BullMQ CI runner and stream logs live to the Vercel dashboard!

---

## 7. Unified Storage Architecture & Multi-Service Volume Patterns

GitPub decouples the Git wire protocol (Go Smart HTTP Gateway) from the business logic and CI orchestration (Node.js API & BullMQ). However, both services operate directly on the same bare Git repositories stored on disk under `REPOS_ROOT` (`/data/repos`).

### 1. Unified Volume Pattern & Bare Repository Sharing
- **Go Gateway (`services/gateway`)**:
  - Serves Git Smart HTTP transfer protocols (`git-upload-pack`, `git-receive-pack`).
  - Writes pushed commits and packfiles directly into the bare repository (`<REPOS_ROOT>/<owner>/<repo>.git`).
  - Fires the internal push webhook to `POST /api/ci/internal/on-push` after receiving objects.
- **Node.js REST API & CI Runner (`services/api`)**:
  - Initializes new bare repositories on disk (`git init --bare`) via `POST /api/repos`.
  - Reads repository trees and file contents (`git ls-tree`, `git show`).
  - Calculates branch diffs for Pull Requests (`git diff base...head`).
  - Executes merge operations by cloning the bare repository to a temporary workspace under `SCRATCH_ROOT/temp-merges`, performing `git merge`, and pushing back to the bare repository.
  - CI Worker clones the bare repository to isolated scratch directories under `SCRATCH_ROOT/ci-runs` to execute build pipelines.

Because both services interact with the exact same repositories, `REPOS_ROOT` must point to the identical filesystem location across both processes.

### 2. Fly.io Storage Topology & Production Deployment Models
On Fly.io, persistent NVMe volumes (`[[mounts]]`) are host-local block devices tied to an individual Fly Machine:

- **Model A: Single-Host / Process Co-Location (Recommended for Free / Starter Tier)**:
  - Both Gateway and API run within the same Fly Machine or multi-process container sharing `/data/repos`.
  - Alternatively, each service mounts a volume named `gitpub_repos` in the same region (`iad`).
- **Model B: Distributed Shared Network Volume (Recommended for Scaled Production Clusters)**:
  - When scaling horizontally across multiple machines or regions, mount a distributed POSIX-compliant shared network filesystem (such as AWS EFS, NFSv4, or a distributed volume driver like JuiceFS) to `/data/repos` on both `services/gateway` and `services/api`.
  - This ensures all API and Gateway replicas share concurrent, consistent read-write access to all bare Git repositories.

### 3. Docker Compose Named Volume Alignment
For containerized local development or on-premises Docker deployments, use a shared named volume in `docker-compose.yml`:

```yaml
version: '3.8'

services:
  gateway:
    build:
      context: ./services/gateway
    ports:
      - "8081:8081"
    environment:
      - PORT=8081
      - REPOS_ROOT=/data/repos
      - API_URL=http://api:8080
    volumes:
      - gitpub_repos:/data/repos

  api:
    build:
      context: ./services/api
    ports:
      - "8080:8080"
    environment:
      - PORT=8080
      - REPOS_ROOT=/data/repos
      - SCRATCH_ROOT=/scratch
      - REDIS_URL=redis://redis:6379
      - DATABASE_URL=postgres://gitpub:gitpub@postgres:5432/gitpub
      - GATEWAY_URL=http://gateway:8081
    volumes:
      - gitpub_repos:/data/repos

volumes:
  gitpub_repos:
    driver: local
```

### 4. Storage Environment Variables Reference
| Variable | Default Value (Local Dev) | Container / Production Value | Description |
|---|---|---|---|
| `REPOS_ROOT` | `<monorepo_root>/data/repos` | `/data/repos` | Path to persistent storage containing bare Git repositories (`<owner>/<repo>.git`) |
| `SCRATCH_ROOT` | `<monorepo_root>/scratch` | `/scratch` | Path to ephemeral workspace for temporary PR merges (`temp-merges`) and CI builds (`ci-runs`) |
