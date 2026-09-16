# GitPub — Self-Hosted Git VCS & CI Sandbox Platform

**GitPub** is a modern, high-performance, self-hosted Git version control system (VCS) and continuous integration (CI) sandbox platform. Designed with a microservice architecture, GitPub couples a native Go protocol streaming gateway with a Node.js/Express relational API, an automated Docker container sandbox runner, and a Next.js Bento Grid dashboard.

---

## Architecture Overview

```
                        +----------------------------+
                        |  Git CLI / Git Client      |
                        +--------------+-------------+
                                       |
                   HTTP Smart Protocol | (clone / push / fetch)
                                       v
                     +---------------------------------+
                     |   Go Protocol Gateway (:8081)   |
                     |   - Smart HTTP (upload/receive) |
                     |   - io.Pipe Zero-RAM Buffering  |
                     |   - RBAC & Basic Auth Check     |
                     +----------------+----------------+
                                      |
                     REST Auth & Hook | Verification & On-Push Hook
                                      v
+------------------+       +---------------------+       +--------------------+
|  Next.js Web UI  | ----> | Express REST API    | ----> | PostgreSQL (Data)  |
|  (:3000)         | <---- | (:8080)             |       | Users, Repos,      |
|  - Bento Grid    |       | - JWT & Google Auth |       | PRs, CI Runs       |
|  - Monaco Editor |       | - PAT (SHA-256)     |       +--------------------+
|  - Diff & Merge  |       | - Merge & Diff Eng. |       +--------------------+
|  - Realtime Logs |       | - BullMQ Queue      | ----> | Redis (:6379)      |
+------------------+       +----------+----------+       | Job Orchestration  |
                                      |                  +--------------------+
                                      v
                     +---------------------------------+
                     | CI Sandbox Runner (Docker/Local)|
                     | - gitpub-ci-runner (Isolated)   |
                     | - --cap-drop=ALL, --network none|
                     | - Auto-cleanup & Live Streaming |
                     +---------------------------------+
```

### Components

1. **Protocol Gateway (Go)** (`services/gateway`):
   - Handles Git Smart HTTP wire protocol endpoints:
     - `GET /:owner/:repo.git/info/refs?service=git-upload-pack` (Fetch discovery)
     - `GET /:owner/:repo.git/info/refs?service=git-receive-pack` (Push discovery)
     - `POST /:owner/:repo.git/git-upload-pack` (Packfile fetch stream)
     - `POST /:owner/:repo.git/git-receive-pack` (Packfile push stream)
   - Streams directly between HTTP request/response bodies and `git` subprocesses using `io.Pipe` to eliminate memory buffering on large repository pushes (50MB+).
   - Enforces RBAC through the REST API via HTTP Basic Auth.
   - Automatically triggers the CI build pipeline upon successful `git push` completion.

2. **Application API (Node.js / Express / TypeScript)** (`services/api`):
   - **Authentication**: Argon2id password hashing, JWT user sessions, Google OAuth ID Token verification, and SHA-256 hashed Personal Access Tokens (PATs) for Git CLI authentication.
   - **Repository Management**: Initialize bare repositories (`data/repos/<owner>/<repo>.git`), browse commit trees, view files, and enforce public/private repository access.
   - **Diff & Pull Request Engine**: Calculates branch deltas using `git diff base...head`, detects conflicts, and cleanly merges branches via isolated scratch clones.
   - **CI Orchestration**: Enqueues build jobs into Redis via BullMQ, tracks execution states, and live-streams logs to PostgreSQL.

3. **Web Application (Next.js 16 / React 19 / Tailwind CSS)** (`apps/web`):
   - Bento Grid layout with responsive sidebar and repository explorer.
   - Interactive code viewer powered by Monaco Editor (`@monaco-editor/react`).
   - Side-by-side and unified diff viewer (`react-diff-viewer-continued`) for pull request reviews.
   - One-click PR merge buttons, PAT generation modal, and live polling CI console output.

4. **CI Sandbox Runner** (`infra/docker-runner`):
   - Spawns hardened containers with dropped Linux capabilities (`--cap-drop=ALL`), no new privileges, memory/CPU quotas, and disabled network access (`--network none`).
   - Includes automatic local fallback mode when Docker Desktop is offline for rapid local testing.

---

## Prerequisites

- **Node.js**: v20+ and `npm`
- **Go**: v1.21+
- **Git**: Installed and available in your `PATH`
- **PostgreSQL**: v16+ (or run via Docker Compose)
- **Redis**: v7+ (or run via Docker Compose)
- **Docker** (Optional, recommended for sandboxed CI runs)

---

## Getting Started

### 1. Start Infrastructure (PostgreSQL & Redis)

Run the database and Redis instances using Docker Compose:

```bash
docker compose up -d
```

Verify that PostgreSQL (`5432`) and Redis (`6379`) are running:

```bash
docker compose ps
```

### 2. Configure Environment Variables

**API Service** (`services/api/.env`):
```env
PORT=8080
DATABASE_URL=postgres://gitpub:devpass@localhost:5432/gitpub
REDIS_URL=redis://localhost:6379
JWT_SECRET=gitpub-dev-secret-key-change-in-production
ALLOW_LOCAL_CI_FALLBACK=true
GOOGLE_CLIENT_ID=<your-google-client-id>.apps.googleusercontent.com
```

**Protocol Gateway** (`services/gateway/.env`):
```env
PORT=8081
REPOS_ROOT=../../data/repos
API_URL=http://localhost:8080
```

**Web App** (`apps/web/.env.local`):
```env
NEXT_PUBLIC_GOOGLE_CLIENT_ID=<your-google-client-id>.apps.googleusercontent.com
```

### 3. Run the Services

You can launch each service from the root monorepo:

```bash
# Terminal 1: Protocol Gateway (Go)
npm run gateway:dev

# Terminal 2: REST API & BullMQ Worker (Node.js)
npm run api:dev

# Terminal 3: Web Dashboard (Next.js)
npm run web:dev
```

The Web UI will be available at [http://localhost:3000](http://localhost:3000).

---

## Git Client Operations

### 1. Authenticate with a Personal Access Token (PAT)

1. Navigate to the web dashboard at `http://localhost:3000`.
2. Register or log in to your account.
3. Click **"Generate Token"** in the top navigation to create a new Personal Access Token.
4. Copy the raw token (`pat_...`).

### 2. Clone a Repository

```bash
# Public repository
git clone http://localhost:8081/<username>/<repo-name>.git

# Private repository (provide username and PAT when prompted)
git clone http://<username>:<pat>@localhost:8081/<username>/<repo-name>.git
```

### 3. Push Commits & Trigger CI

```bash
cd <repo-name>
git checkout -b feature/demo
echo "console.log('Hello GitPub CI!');" > index.js

# Configure CI pipeline
cat << 'EOF' > .gitpub-ci.yml
steps:
  - name: Run Node.js Tests
    command: node index.js
EOF

git add .
git commit -m "Add index.js and CI workflow"
git push origin feature/demo
```

Upon a successful `git push`, the Go Protocol Gateway notifies the API at `/api/ci/internal/on-push`, which reads `.gitpub-ci.yml` from the commit and launches a CI run.

---

## CI Configuration (`.gitpub-ci.yml`)

Add a `.gitpub-ci.yml` file to the root of your repository:

```yaml
steps:
  - name: Install dependencies
    command: npm install --production
  - name: Run test suite
    command: npm test
```

When pushes arrive, each step command is executed sequentially inside the runner. Output is streamed live to the database and displayed in the GitPub UI.

---

## Project Structure

```
.
├── apps/
│   └── web/                   # Next.js 16 Web Dashboard & Monaco Editor
├── services/
│   ├── api/                   # Express REST API, Auth, PR Engine & BullMQ CI Worker
│   └── gateway/               # Go Smart HTTP Git Gateway (streaming & RBAC)
├── infra/
│   ├── docker-runner/         # Hardened CI Runner Dockerfile
│   ├── postgres/              # PostgreSQL schema and initialization
│   └── redis/                 # Redis config
├── data/
│   └── repos/                 # On-disk bare repositories (<owner>/<repo>.git)
├── scratch/                   # Temporary merge workspaces and CI worktrees
├── IDEcmd.md                  # Detailed build sequence & reference guide
├── docker-compose.yml         # Local Postgres + Redis dev stack
└── package.json               # Root monorepo workspace scripts
```

---

## Verification & Type Safety

Run build checks across all workspaces:

```bash
# Verify API TypeScript compilation
npm run api:check

# Verify Frontend TypeScript compilation
npm run web:check

# Verify Protocol Gateway Go build
npm run gateway:build
```
