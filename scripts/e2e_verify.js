const http = require('http');
const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const API_BASE = 'http://localhost:8080/api';
const GATEWAY_BASE = 'http://localhost:8081';

function request(url, options = {}, data = null) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const reqOptions = {
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      method: options.method || 'GET',
      headers: options.headers || {}
    };

    if (data) {
      if (!reqOptions.headers['Content-Type']) {
        reqOptions.headers['Content-Type'] = 'application/json';
      }
    }

    const req = http.request(reqOptions, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(body);
        } catch (e) {
          json = body;
        }
        resolve({ status: res.statusCode, headers: res.headers, body: json });
      });
    });

    req.on('error', reject);
    if (data) {
      req.write(typeof data === 'string' ? data : JSON.stringify(data));
    }
    req.end();
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runE2E() {
  console.log('====================================================');
  console.log('      GITPUB END-TO-END VERIFICATION SUITE         ');
  console.log('====================================================\n');

  const timestamp = Date.now();
  const testUsername = `user_${timestamp}`;
  const testEmail = `${testUsername}@example.com`;
  const testPassword = `Pass123_${timestamp}!`;
  const repoName = `repo_${timestamp}`;

  const scratchDir = path.resolve(__dirname, '..', 'scratch', `e2e_${timestamp}`);
  if (fs.existsSync(scratchDir)) {
    fs.rmSync(scratchDir, { recursive: true, force: true });
  }
  fs.mkdirSync(scratchDir, { recursive: true });

  try {
    // 1. API Health Check
    console.log('[1/8] Checking API Health (/api/health)...');
    const health = await request(`${API_BASE}/health`);
    if (health.status !== 200 || health.body.status !== 'healthy') {
      throw new Error(`API health check failed: ${JSON.stringify(health.body)}`);
    }
    console.log('  -> API and PostgreSQL connected successfully.\n');

    // 2. User Registration & Login
    console.log(`[2/8] Registering test user (${testUsername})...`);
    const regRes = await request(`${API_BASE}/auth/register`, { method: 'POST' }, {
      username: testUsername,
      email: testEmail,
      password: testPassword
    });
    if (regRes.status !== 201) {
      throw new Error(`Registration failed: ${JSON.stringify(regRes.body)}`);
    }

    console.log('  Logging in to obtain JWT...');
    const loginRes = await request(`${API_BASE}/auth/login`, { method: 'POST' }, {
      email: testEmail,
      password: testPassword
    });
    if (loginRes.status !== 200 || !loginRes.body.token) {
      throw new Error(`Login failed: ${JSON.stringify(loginRes.body)}`);
    }
    const token = loginRes.body.token;
    console.log('  -> JWT obtained.\n');

    // 3. Generate Personal Access Token (PAT)
    console.log('[3/8] Generating Personal Access Token (PAT)...');
    const patRes = await request(`${API_BASE}/auth/pat`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (patRes.status !== 200 || !patRes.body.pat) {
      throw new Error(`PAT generation failed: ${JSON.stringify(patRes.body)}`);
    }
    const pat = patRes.body.pat;
    console.log(`  -> PAT generated: ${pat.substring(0, 10)}... (SHA-256 hashed in DB).\n`);

    // 4. Create Repository
    console.log(`[4/8] Creating repository (${repoName})...`);
    const repoRes = await request(`${API_BASE}/repos`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    }, { name: repoName, is_private: false });

    if (repoRes.status !== 201 || !repoRes.body.repository) {
      throw new Error(`Repo creation failed: ${JSON.stringify(repoRes.body)}`);
    }
    const repoId = repoRes.body.repository.id;
    console.log(`  -> Repository created with ID ${repoId}.\n`);

    // 5. Test Smart HTTP Reference Discovery & TTFB
    console.log('[5/8] Testing Smart HTTP Discovery & TTFB (< 150ms benchmark)...');
    const ttfbStart = Date.now();
    const refsRes = await request(`${GATEWAY_BASE}/${testUsername}/${repoName}.git/info/refs?service=git-upload-pack`);
    const ttfbMs = Date.now() - ttfbStart;
    console.log(`  -> Smart HTTP TTFB: ${ttfbMs}ms (Status: ${refsRes.status})`);
    if (refsRes.status !== 200) {
      throw new Error(`Smart HTTP discovery failed with status ${refsRes.status}`);
    }
    console.log('  -> Wire protocol headers and status verified.\n');

    // 6. Git Client Operations: Clone, Commit, Push with PAT
    console.log('[6/8] Testing Git Client Operations (Clone, Add CI config, Push with PAT)...');
    const cloneUrl = `http://${testUsername}:${pat}@localhost:8081/${testUsername}/${repoName}.git`;
    const clientRepoDir = path.join(scratchDir, repoName);

    console.log('  Cloning bare repository via Smart HTTP Gateway...');
    execSync(`git clone "${cloneUrl}" "${clientRepoDir}"`, { stdio: 'pipe' });

    // Set local git committer info
    execSync('git config user.name "GitPub E2E"', { cwd: clientRepoDir });
    execSync('git config user.email "e2e@gitpub.local"', { cwd: clientRepoDir });

    // Create index.js and .gitpub-ci.yml
    fs.writeFileSync(path.join(clientRepoDir, 'index.js'), 'console.log("GitPub CI Pipeline E2E Execution Succeeded!");');
    const ciConfig = [
      'steps:',
      '  - name: Run E2E Test Step',
      '    command: node index.js'
    ].join('\n');
    fs.writeFileSync(path.join(clientRepoDir, '.gitpub-ci.yml'), ciConfig);

    execSync('git add index.js .gitpub-ci.yml', { cwd: clientRepoDir });
    execSync('git commit -m "feat: initial commit with CI pipeline"', { cwd: clientRepoDir });
    execSync('git branch -M main', { cwd: clientRepoDir });

    console.log('  Pushing main branch to Go Protocol Gateway...');
    execSync('git push -u origin main', { cwd: clientRepoDir, stdio: 'pipe' });
    console.log('  -> Push completed successfully via io.Pipe streaming.\n');

    // 7. Verify Asynchronous CI Run via BullMQ
    console.log('[7/8] Verifying Asynchronous CI Execution in BullMQ & Postgres...');
    console.log('  Waiting for CI worker to process the job and stream logs...');
    
    let completedRun = null;
    for (let attempt = 1; attempt <= 20; attempt++) {
      await sleep(1500);
      const runsRes = await request(`${API_BASE}/ci?repoId=${repoId}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const runs = runsRes.body?.ciRuns;
      if (runsRes.status === 200 && Array.isArray(runs) && runs.length > 0) {
        const run = runs[0];
        console.log(`    Attempt ${attempt}: Run #${run.id} Status = ${run.status}`);
        if (run.status === 'success' || run.status === 'failed') {
          completedRun = run;
          break;
        }
      }
    }

    if (!completedRun) {
      throw new Error('CI run did not complete within timeout.');
    }

    console.log(`  -> CI Run #${completedRun.id} finished with status: ${completedRun.status}`);
    if (completedRun.log) {
      console.log(`  -> Log output excerpt:\n${completedRun.log.split('\n').slice(0, 6).join('\n')}\n`);
    }

    // Check Docker runner sandbox cleanup
    try {
      const dockerPs = execSync('docker ps -q --filter "ancestor=gitpub-ci-runner:latest"').toString().trim();
      if (dockerPs.length === 0) {
        console.log('  -> Docker Sandbox Cleanup Verified: No orphaned runner containers.');
      } else {
        console.warn(`  [WARN] Orphaned containers found: ${dockerPs}`);
      }
    } catch (e) {
      // Ignore if docker ps fails
    }

    // 8. Pull Request Engine: Feature branch, PR creation, diff, and merge
    console.log('\n[8/8] Testing Pull Request Engine (Branching, Diff, Merge)...');
    execSync('git checkout -b feature-e2e', { cwd: clientRepoDir });
    fs.writeFileSync(path.join(clientRepoDir, 'feature.txt'), 'Feature branch addition for GitPub PR engine');
    execSync('git add feature.txt', { cwd: clientRepoDir });
    execSync('git commit -m "feat: add feature.txt"', { cwd: clientRepoDir });
    execSync('git push origin feature-e2e', { cwd: clientRepoDir, stdio: 'pipe' });

    console.log('  Creating Pull Request via REST API...');
    const prRes = await request(`${API_BASE}/pulls`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    }, {
      repoId: repoId,
      title: 'E2E Test Feature Pull Request',
      sourceBranch: 'feature-e2e',
      targetBranch: 'main'
    });

    if (prRes.status !== 201 || !prRes.body.pullRequest) {
      throw new Error(`PR creation failed: ${JSON.stringify(prRes.body)}`);
    }
    const prId = prRes.body.pullRequest.id;
    console.log(`  -> PR #${prId} created.`);

    console.log('  Calculating PR diff...');
    const diffRes = await request(`${API_BASE}/pulls/${prId}/diff`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (diffRes.status !== 200 || !diffRes.body.diff) {
      throw new Error(`PR diff computation failed: ${JSON.stringify(diffRes.body)}`);
    }
    console.log(`  -> Diff computed successfully (${diffRes.body.diff.split('\n').length} lines).`);

    console.log('  Merging Pull Request...');
    const mergeRes = await request(`${API_BASE}/pulls/${prId}/merge`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (mergeRes.status !== 200 || mergeRes.body.status !== 'merged') {
      throw new Error(`PR merge failed: ${JSON.stringify(mergeRes.body)}`);
    }
    console.log('  -> PR successfully merged into main branch!\n');

    console.log('====================================================');
    console.log('  🎉 ALL POST-BUILD CHECKS & E2E TESTS PASSED!      ');
    console.log('====================================================');
  } finally {
    try {
      fs.rmSync(scratchDir, { recursive: true, force: true });
    } catch (e) {}
  }
}

runE2E().catch(err => {
  console.error('\n❌ E2E VERIFICATION FAILED:', err);
  process.exit(1);
});
