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
     +-----------------+----------------+        +-----------------+-----------------+
                       |                                           |
         Relational DB | Redis Queue                               | Mounts
                       v                                           v
     +-----------------+----------------+        +-----------------+-----------------+
     | Neon PostgreSQL | Upstash Redis  |        | Fly.io Persistent Volume          |
     | (Serverless)    | (Serverless)   |        | (/data/repos)                     |
     +-----------------+----------------+        +-----------------------------------+
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

2. Configure production secrets on Fly.io:
   ```bash
   fly secrets set \
     DATABASE_URL="postgres://gitpub_owner:<password>@<endpoint>.neon.tech/gitpub?sslmode=require" \
     REDIS_URL="rediss://default:<password>@<endpoint>.upstash.io:6379" \
     JWT_SECRET="generate-a-strong-random-secret-key-32-chars-long" \
     GATEWAY_URL="https://gitpub-gateway.fly.dev" \
     GOOGLE_CLIENT_ID="<your-google-client-id>.apps.googleusercontent.com" \
     ALLOW_LOCAL_CI_FALLBACK="true"
   ```

3. Launch and deploy the service:
   ```bash
   fly launch --no-deploy
   fly deploy
   ```

4. Wire the API URL back to the Gateway:
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
