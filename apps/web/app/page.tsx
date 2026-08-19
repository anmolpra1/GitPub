'use client';

import React, { useState, useEffect } from 'react';
import axios from 'axios';
import Editor from '@monaco-editor/react';
import ReactDiffViewer from 'react-diff-viewer-continued';

const API_BASE = 'http://localhost:8080/api';

interface Repository {
  id: number;
  name: string;
  is_private: boolean;
  owner_name: string;
  created_at: string;
}

interface PullRequest {
  id: number;
  title: string;
  status: string;
  source_branch: string;
  target_branch: string;
  author_name: string;
  created_at: string;
}

interface CIRun {
  id: number;
  commit_hash: string;
  status: string;
  log: string;
  created_at: string;
  finished_at: string | null;
}

export default function Home() {
  // Auth state
  const [token, setToken] = useState<string | null>(null);
  const [username, setUsername] = useState<string>('');
  const [email, setEmail] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [isRegister, setIsRegister] = useState<boolean>(false);
  const [currentUser, setCurrentUser] = useState<any>(null);

  // App state
  const [repos, setRepos] = useState<Repository[]>([]);
  const [selectedRepo, setSelectedRepo] = useState<Repository | null>(null);

  // File explorer state
  const [files, setFiles] = useState<string[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string>('');
  const [isEmptyRepo, setIsEmptyRepo] = useState<boolean>(false);

  // PR state
  const [prs, setPrs] = useState<PullRequest[]>([]);
  const [selectedPR, setSelectedPR] = useState<PullRequest | null>(null);
  const [prDiff, setPrDiff] = useState<string>('');
  const [newPrTitle, setNewPrTitle] = useState<string>('');
  const [newPrSource, setNewPrSource] = useState<string>('');
  const [newPrTarget, setNewPrTarget] = useState<string>('main');
  const [showNewPrModal, setShowNewPrModal] = useState<boolean>(false);

  // CI state
  const [ciRuns, setCiRuns] = useState<CIRun[]>([]);
  const [selectedCIRun, setSelectedCIRun] = useState<CIRun | null>(null);
  const [newCiRef, setNewCiRef] = useState<string>('main');
  const [showCiModal, setShowCiModal] = useState<boolean>(false);

  // UI helpers
  const [newRepoName, setNewRepoName] = useState<string>('');
  const [newRepoPrivate, setNewRepoPrivate] = useState<boolean>(false);
  const [showNewRepoModal, setShowNewRepoModal] = useState<boolean>(false);
  const [generatedPat, setGeneratedPat] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Load token from localStorage on mount
  useEffect(() => {
    const savedToken = localStorage.getItem('token');
    const savedUser = localStorage.getItem('user');
    if (savedToken && savedUser) {
      setToken(savedToken);
      setCurrentUser(JSON.parse(savedUser));
    }
  }, []);

  // Fetch repos when token changes
  useEffect(() => {
    if (token) {
      fetchRepos();
    }
  }, [token]);

  // Fetch repository metadata and child states when selectedRepo changes
  useEffect(() => {
    if (selectedRepo) {
      setSelectedFile(null);
      setFileContent('');
      setSelectedPR(null);
      setSelectedCIRun(null);
      fetchFiles();
      fetchPRs();
      fetchCIRuns();
    }
  }, [selectedRepo]);

  // Polling for CI updates
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (selectedRepo) {
      interval = setInterval(() => {
        fetchCIRuns();
      }, 5000);
    }
    return () => clearInterval(interval);
  }, [selectedRepo]);

  const getHeaders = () => ({
    headers: { Authorization: `Bearer ${token}` }
  });

  // Auth Operations
  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    try {
      if (isRegister) {
        await axios.post(`${API_BASE}/auth/register`, { username, email, password });
        setIsRegister(false);
        setSuccessMsg('Registration successful! Please login.');
      } else {
        const res = await axios.post(`${API_BASE}/auth/login`, { email, password });
        localStorage.setItem('token', res.data.token);
        localStorage.setItem('user', JSON.stringify(res.data.user));
        setToken(res.data.token);
        setCurrentUser(res.data.user);
        setSuccessMsg('Welcome back!');
      }
    } catch (err: any) {
      setErrorMsg(err.response?.data?.error || 'Authentication failed');
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setToken(null);
    setCurrentUser(null);
    setRepos([]);
    setSelectedRepo(null);
    setGeneratedPat(null);
  };

  const generatePAT = async () => {
    try {
      const res = await axios.post(`${API_BASE}/auth/pat`, {}, getHeaders());
      setGeneratedPat(res.data.pat);
      setSuccessMsg('PAT token created!');
    } catch (err: any) {
      setErrorMsg(err.response?.data?.error || 'Failed to generate PAT');
    }
  };

  // Repo Operations
  const fetchRepos = async () => {
    try {
      const res = await axios.get(`${API_BASE}/repos`, getHeaders());
      setRepos(res.data.repositories);
    } catch (err: any) {
      console.error(err);
    }
  };

  const createRepo = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    try {
      const res = await axios.post(`${API_BASE}/repos`, {
        name: newRepoName,
        is_private: newRepoPrivate
      }, getHeaders());
      setSuccessMsg(res.data.message);
      fetchRepos();
      setShowNewRepoModal(false);
      setNewRepoName('');
      setNewRepoPrivate(false);
      setSelectedRepo(res.data.repository);
    } catch (err: any) {
      setErrorMsg(err.response?.data?.error || 'Failed to create repository');
    }
  };

  // File Explorer Operations
  const fetchFiles = async () => {
    if (!selectedRepo) return;
    try {
      const res = await axios.get(`${API_BASE}/repos/${selectedRepo.owner_name}/${selectedRepo.name}/files`, getHeaders());
      setFiles(res.data.files);
      setIsEmptyRepo(res.data.isEmpty || false);
    } catch (err) {
      console.error(err);
    }
  };

  const viewFile = async (filePath: string) => {
    if (!selectedRepo) return;
    setSelectedFile(filePath);
    try {
      const res = await axios.get(
        `${API_BASE}/repos/${selectedRepo.owner_name}/${selectedRepo.name}/file-content?path=${encodeURIComponent(filePath)}`,
        getHeaders()
      );
      setFileContent(res.data.content);
    } catch (err) {
      console.error(err);
    }
  };

  // PR Operations
  const fetchPRs = async () => {
    if (!selectedRepo) return;
    try {
      const res = await axios.get(`${API_BASE}/pulls?repoId=${selectedRepo.id}`, getHeaders());
      setPrs(res.data.pullRequests);
    } catch (err) {
      console.error(err);
    }
  };

  const createPR = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    try {
      await axios.post(`${API_BASE}/pulls`, {
        repoId: selectedRepo?.id,
        title: newPrTitle,
        sourceBranch: newPrSource,
        targetBranch: newPrTarget
      }, getHeaders());
      setSuccessMsg('Pull Request opened!');
      fetchPRs();
      setShowNewPrModal(false);
      setNewPrTitle('');
      setNewPrSource('');
    } catch (err: any) {
      setErrorMsg(err.response?.data?.error || 'Failed to create Pull Request');
    }
  };

  const viewPRDetails = async (pr: PullRequest) => {
    setSelectedPR(pr);
    setPrDiff('');
    try {
      const res = await axios.get(`${API_BASE}/pulls/${pr.id}/diff`, getHeaders());
      setPrDiff(res.data.diff);
    } catch (err) {
      console.error(err);
    }
  };

  const mergePR = async (prId: number) => {
    setErrorMsg(null);
    try {
      await axios.post(`${API_BASE}/pulls/${prId}/merge`, {}, getHeaders());
      setSuccessMsg('PR merged successfully!');
      fetchPRs();
      setSelectedPR(null);
    } catch (err: any) {
      setErrorMsg(err.response?.data?.error || 'Failed to merge PR');
    }
  };

  // CI Operations
  const fetchCIRuns = async () => {
    if (!selectedRepo) return;
    try {
      const res = await axios.get(`${API_BASE}/ci?repoId=${selectedRepo.id}`, getHeaders());
      setCiRuns(res.data.ciRuns);
      if (selectedCIRun) {
        const updated = res.data.ciRuns.find((r: any) => r.id === selectedCIRun.id);
        if (updated) setSelectedCIRun(updated);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const triggerCI = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    try {
      await axios.post(`${API_BASE}/ci/trigger`, {
        repoId: selectedRepo?.id,
        branchOrCommit: newCiRef
      }, getHeaders());
      setSuccessMsg('CI run queued!');
      fetchCIRuns();
      setShowCiModal(false);
      setNewCiRef('main');
    } catch (err: any) {
      setErrorMsg(err.response?.data?.error || 'Failed to trigger CI');
    }
  };

  if (!token) {
    return (
      <main className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-4 relative overflow-hidden font-sans select-none">
        {/* Ambient background glows */}
        <div className="absolute top-1/4 left-1/4 w-[500px] h-[500px] bg-indigo-500/10 rounded-full blur-[120px] pointer-events-none animate-pulse"></div>
        <div className="absolute bottom-1/4 right-1/4 w-[400px] h-[400px] bg-purple-500/10 rounded-full blur-[100px] pointer-events-none animate-pulse"></div>

        <div className="w-full max-w-md bg-slate-900/40 backdrop-blur-xl border border-slate-800/80 p-8 rounded-2xl shadow-2xl relative z-10">
          <div className="text-center mb-8">
            <h1 className="text-4xl font-extrabold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-indigo-400 via-cyan-400 to-purple-400">
              GitPub
            </h1>
            <p className="text-slate-400 text-sm mt-2 font-medium tracking-wide">Minimal Bento VCS & CI Engine</p>
          </div>

          <form onSubmit={handleAuth} className="space-y-4">
            {isRegister && (
              <div>
                <label className="block text-3xs font-bold uppercase tracking-widest text-slate-400 mb-1">Username</label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full bg-slate-950/60 border border-slate-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 rounded-lg py-2 px-3 text-sm text-slate-100 placeholder-slate-600 outline-none transition"
                  placeholder="username"
                  required
                />
              </div>
            )}
            <div>
              <label className="block text-3xs font-bold uppercase tracking-widest text-slate-400 mb-1">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-slate-950/60 border border-slate-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 rounded-lg py-2 px-3 text-sm text-slate-100 placeholder-slate-600 outline-none transition"
                placeholder="developer@gitpub.io"
                required
              />
            </div>
            <div>
              <label className="block text-3xs font-bold uppercase tracking-widest text-slate-400 mb-1">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-slate-950/60 border border-slate-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 rounded-lg py-2 px-3 text-sm text-slate-100 placeholder-slate-600 outline-none transition"
                placeholder="••••••••"
                required
              />
            </div>

            {errorMsg && <p className="text-red-400 text-xs text-center bg-red-950/30 border border-red-900/40 py-2 px-3 rounded-lg">{errorMsg}</p>}
            {successMsg && <p className="text-green-400 text-xs text-center bg-green-950/30 border border-green-900/40 py-2 px-3 rounded-lg">{successMsg}</p>}

            <button
              type="submit"
              className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-bold py-2.5 rounded-lg shadow-lg hover:shadow-indigo-500/10 active:scale-[0.98] transition cursor-pointer text-center"
            >
              {isRegister ? 'Sign Up' : 'Sign In'}
            </button>
          </form>

          <div className="mt-6 text-center text-xs text-slate-400">
            {isRegister ? (
              <p>
                Have an account?{' '}
                <button onClick={() => { setIsRegister(false); setErrorMsg(null); }} className="text-indigo-400 hover:text-indigo-300 font-semibold cursor-pointer">
                  Log In
                </button>
              </p>
            ) : (
              <p>
                New to GitPub?{' '}
                <button onClick={() => { setIsRegister(true); setErrorMsg(null); }} className="text-indigo-400 hover:text-indigo-300 font-semibold cursor-pointer">
                  Create Account
                </button>
              </p>
            )}
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 text-slate-200 flex flex-col font-sans relative overflow-hidden select-none pb-8">
      {/* Background decoration */}
      <div className="absolute top-0 left-0 w-full h-[600px] bg-radial-at-t from-slate-900 via-slate-950/20 to-slate-950 pointer-events-none z-0"></div>

      {/* Global Toast Alert Banners */}
      {successMsg && (
        <div className="fixed bottom-4 right-4 z-50 bg-slate-900/90 backdrop-blur border border-green-900/50 text-green-400 text-xs py-2.5 px-4 rounded-xl shadow-2xl flex items-center gap-3">
          <span>✔️ {successMsg}</span>
          <button onClick={() => setSuccessMsg(null)} className="hover:text-green-200 font-bold cursor-pointer text-sm">×</button>
        </div>
      )}
      {errorMsg && (
        <div className="fixed bottom-4 right-4 z-50 bg-slate-900/90 backdrop-blur border border-red-900/50 text-red-400 text-xs py-2.5 px-4 rounded-xl shadow-2xl flex items-center gap-3">
          <span>❌ {errorMsg}</span>
          <button onClick={() => setErrorMsg(null)} className="hover:text-red-200 font-bold cursor-pointer text-sm">×</button>
        </div>
      )}

      {/* Modern Minimal Navigation Bar */}
      <nav className="bg-slate-900/40 backdrop-blur border-b border-slate-900/80 px-6 py-3.5 flex justify-between items-center z-10 shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-xl font-extrabold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-indigo-400 to-cyan-400">
            GitPub
          </span>
          <span className="text-[10px] font-bold tracking-widest text-slate-500 bg-slate-950/60 border border-slate-900 py-0.5 px-2 rounded-full">
            DASHBOARD
          </span>
        </div>

        {/* User profile controls */}
        <div className="flex items-center gap-4">
          {selectedRepo && (
            <div className="hidden sm:flex items-center gap-2 border border-slate-800/80 px-3 py-1 rounded-full bg-slate-950/40 text-xs text-slate-400 font-mono">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></span>
              {selectedRepo.owner_name} / {selectedRepo.name}
            </div>
          )}
          <button
            onClick={generatePAT}
            className="bg-indigo-650 hover:bg-indigo-600 text-slate-100 text-3xs uppercase font-extrabold tracking-widest py-1.5 px-3.5 border border-indigo-500/20 rounded-full transition cursor-pointer"
          >
            Generate PAT
          </button>
          <div className="flex items-center gap-2.5">
            <span className="text-xs font-semibold text-slate-400">@{currentUser?.username}</span>
            <button
              onClick={handleLogout}
              className="text-slate-500 hover:text-red-400 text-xs font-semibold cursor-pointer"
            >
              Exit
            </button>
          </div>
        </div>
      </nav>

      {/* Hashed PAT Display Alert */}
      {generatedPat && (
        <div className="max-w-7xl mx-auto w-full px-6 mt-4 z-10 shrink-0">
          <div className="bg-indigo-950/50 backdrop-blur border border-indigo-800/40 p-4 rounded-2xl flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div className="space-y-1">
              <h4 className="text-xs font-bold text-indigo-400 tracking-wide">Personal Access Token Generated</h4>
              <p className="text-3xs text-slate-400">Use this token as your password for Git CLI credentials. Save it now, you will never see it again:</p>
            </div>
            <div className="bg-slate-950/80 p-2 rounded-xl border border-slate-850 flex items-center justify-between gap-4 font-mono text-xs text-indigo-300 w-full md:w-auto shrink-0 select-text">
              <span>{generatedPat}</span>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(generatedPat);
                  setSuccessMsg('PAT copied!');
                }}
                className="text-slate-500 hover:text-slate-200 text-2xs cursor-pointer font-sans"
              >
                Copy
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bento Grid Layout */}
      <section className="flex-1 max-w-7xl mx-auto w-full px-6 mt-6 grid grid-cols-1 md:grid-cols-12 gap-6 z-10 overflow-hidden">
        
        {/* BENTO BOX 1: Repository Explorer (Col span: 3) */}
        <div className="md:col-span-3 bg-slate-900/25 border border-slate-900 rounded-2xl shadow-xl flex flex-col overflow-hidden backdrop-blur-sm h-[320px] md:h-[680px]">
          <div className="p-4 border-b border-slate-900 flex justify-between items-center bg-slate-900/10">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Repositories</span>
            <button
              onClick={() => setShowNewRepoModal(true)}
              className="bg-indigo-600/10 hover:bg-indigo-600/25 text-indigo-450 border border-indigo-500/20 rounded-full p-1.5 active:scale-95 transition cursor-pointer"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 4v16m8-8H4"></path></svg>
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-1">
            {repos.length === 0 ? (
              <p className="text-xs text-slate-500 italic p-3 text-center">No projects found</p>
            ) : (
              repos.map((repo) => (
                <button
                  key={repo.id}
                  onClick={() => setSelectedRepo(repo)}
                  className={`w-full text-left py-2 px-3 rounded-xl text-xs flex items-center justify-between cursor-pointer border transition ${
                    selectedRepo?.id === repo.id
                      ? 'bg-indigo-600/10 text-indigo-300 font-semibold border-indigo-500/30'
                      : 'bg-transparent text-slate-400 hover:text-slate-200 border-transparent hover:bg-slate-900/30'
                  }`}
                >
                  <span className="truncate">{repo.name}</span>
                  <span className="text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded-full border border-slate-800/80 bg-slate-950/60 text-slate-500">
                    {repo.is_private ? 'prv' : 'pub'}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>

        {/* RIGHT BENTO CONTENT AREA (Col span: 9) */}
        {selectedRepo ? (
          <div className="md:col-span-9 grid grid-cols-1 md:grid-cols-9 gap-6 overflow-hidden">
            
            {/* BENTO BOX 2: Repository Header & Setup Info (Col span: 9, Row span: 1) */}
            <div className="md:col-span-9 bg-slate-900/20 border border-slate-900 p-4 rounded-2xl shadow-xl flex flex-col md:flex-row justify-between items-start md:items-center gap-4 backdrop-blur-sm">
              <div className="space-y-1">
                <h3 className="text-md font-bold text-slate-100 flex items-center gap-2">
                  <span>{selectedRepo.name}</span>
                  <span className="text-[9px] font-extrabold uppercase tracking-widest text-slate-500 bg-slate-950 border border-slate-900 py-0.5 px-2 rounded-full">
                    {selectedRepo.is_private ? 'Private' : 'Public'}
                  </span>
                </h3>
                <p className="text-3xs text-slate-500 font-mono">Clone URL: http://localhost:8081/{selectedRepo.owner_name}/{selectedRepo.name}.git</p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowNewPrModal(true)}
                  className="bg-indigo-600/10 hover:bg-indigo-600/20 text-indigo-400 text-3xs uppercase font-extrabold tracking-widest py-1.5 px-3 border border-indigo-500/25 rounded-xl cursor-pointer"
                >
                  New PR
                </button>
                <button
                  onClick={() => setShowCiModal(true)}
                  className="bg-purple-600/10 hover:bg-purple-600/20 text-purple-400 text-3xs uppercase font-extrabold tracking-widest py-1.5 px-3 border border-purple-500/25 rounded-xl cursor-pointer"
                >
                  Run CI
                </button>
              </div>
            </div>

            {/* BENTO BOX 3: File Explorer (Col span: 3, Row span: 2) */}
            <div className="md:col-span-3 bg-slate-900/20 border border-slate-900 rounded-2xl shadow-xl flex flex-col overflow-hidden backdrop-blur-sm h-[300px] md:h-[570px]">
              <div className="p-3.5 border-b border-slate-900 bg-slate-900/10">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-400">File Explorer</span>
              </div>
              <div className="flex-1 overflow-y-auto p-3 space-y-1">
                {isEmptyRepo ? (
                  <div className="text-center p-4">
                    <p className="text-xs text-slate-500 italic">Repository is empty</p>
                  </div>
                ) : (
                  files.map((file) => (
                    <button
                      key={file}
                      onClick={() => viewFile(file)}
                      className={`w-full text-left py-1.5 px-2.5 rounded-lg text-xs font-mono truncate transition border cursor-pointer ${
                        selectedFile === file
                          ? 'bg-indigo-600/10 text-indigo-300 border-indigo-500/25'
                          : 'bg-transparent text-slate-400 border-transparent hover:bg-slate-900/30'
                      }`}
                    >
                      📁 {file}
                    </button>
                  ))
                )}
              </div>
            </div>

            {/* BENTO BOX 4: Monaco Code Editor / Content (Col span: 6, Row span: 2) */}
            <div className="md:col-span-6 bg-slate-900/25 border border-slate-900 rounded-2xl shadow-xl flex flex-col overflow-hidden backdrop-blur-sm h-[350px] md:h-[570px]">
              {selectedFile ? (
                <div className="flex-1 flex flex-col overflow-hidden">
                  <div className="bg-slate-900/20 border-b border-slate-900 px-4 py-2 text-xs font-mono text-slate-400">
                    {selectedFile}
                  </div>
                  <div className="flex-1 select-text">
                    <Editor
                      height="100%"
                      theme="vs-dark"
                      path={selectedFile}
                      value={fileContent}
                      options={{
                        readOnly: true,
                        fontSize: 13,
                        minimap: { enabled: false },
                        scrollbar: { vertical: 'visible', horizontal: 'visible' },
                        lineHeight: 20
                      }}
                    />
                  </div>
                </div>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center p-6 text-center text-slate-500">
                  <svg className="w-12 h-12 text-slate-800 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
                  <p className="text-xs">Select a file from the explorer tree to view its content</p>
                </div>
              )}
            </div>

            {/* BENTO BOX 5: Pull Request Center (Col span: 4) */}
            <div className="md:col-span-4 bg-slate-900/20 border border-slate-900 rounded-2xl shadow-xl p-4 flex flex-col justify-between backdrop-blur-sm h-[320px] overflow-hidden">
              <div className="flex-1 flex flex-col overflow-hidden">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-400 block mb-3">Pull Requests</span>
                <div className="flex-1 overflow-y-auto space-y-1.5">
                  {prs.length === 0 ? (
                    <p className="text-xs text-slate-500 italic p-2">No Pull Requests opened</p>
                  ) : (
                    prs.map((pr) => (
                      <button
                        key={pr.id}
                        onClick={() => viewPRDetails(pr)}
                        className={`w-full text-left p-2.5 rounded-xl border text-xs transition cursor-pointer flex flex-col gap-1 ${
                          selectedPR?.id === pr.id
                            ? 'bg-slate-800/60 border-slate-700 text-slate-100'
                            : 'bg-slate-950/20 border-slate-900 text-slate-400 hover:bg-slate-900/30'
                        }`}
                      >
                        <div className="flex justify-between items-center w-full">
                          <span className="font-semibold text-slate-200 truncate">{pr.title}</span>
                          <span className={`text-[8px] font-bold uppercase px-1 rounded-full ${
                            pr.status === 'merged' ? 'text-purple-400 border border-purple-900/30 bg-purple-950/20' : 'text-green-400 border border-green-900/30 bg-green-950/20'
                          }`}>{pr.status}</span>
                        </div>
                        <div className="flex justify-between items-center text-[9px] text-slate-500">
                          <span>{pr.source_branch} → {pr.target_branch}</span>
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </div>
            </div>

            {/* BENTO BOX 6: CI/CD Pipelines Execution Terminal (Col span: 5) */}
            <div className="md:col-span-5 bg-slate-900/20 border border-slate-900 rounded-2xl shadow-xl p-4 flex flex-col justify-between backdrop-blur-sm h-[320px] overflow-hidden">
              <div className="flex-1 flex flex-col overflow-hidden">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-400 block mb-3">CI/CD Terminal logs</span>
                <div className="flex-1 overflow-y-auto space-y-1.5">
                  {ciRuns.length === 0 ? (
                    <p className="text-xs text-slate-500 italic p-2">No builds triggered yet</p>
                  ) : (
                    ciRuns.map((run) => (
                      <button
                        key={run.id}
                        onClick={() => setSelectedCIRun(run)}
                        className={`w-full text-left p-2.5 rounded-xl border text-xs transition cursor-pointer flex flex-col gap-1 ${
                          selectedCIRun?.id === run.id
                            ? 'bg-slate-800/60 border-slate-700 text-slate-100'
                            : 'bg-slate-950/20 border-slate-900 text-slate-400 hover:bg-slate-900/30'
                        }`}
                      >
                        <div className="flex justify-between items-center w-full">
                          <span className="font-mono text-slate-300">Run #{run.id} ({run.commit_hash.slice(0, 7)})</span>
                          <span className={`text-[8px] font-bold uppercase px-1 rounded-full ${
                            run.status === 'success' ? 'text-green-400 border border-green-900/30 bg-green-950/20' : run.status === 'failed' ? 'text-red-400 border border-red-900/30 bg-red-950/20' : 'text-yellow-400 border border-yellow-900/30 bg-yellow-950/20 animate-pulse'
                          }`}>{run.status}</span>
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </div>
            </div>

            {/* MODAL / SUB-VIEW: PR Details Diff Container (Popup overlay when selectedPR exists) */}
            {selectedPR && (
              <div className="fixed inset-0 z-40 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-6">
                <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl w-full max-w-4xl shadow-2xl h-[85vh] flex flex-col overflow-hidden">
                  <div className="border-b border-slate-800 pb-4 mb-4 flex justify-between items-center shrink-0">
                    <div>
                      <div className="flex items-center gap-2.5">
                        <h3 className="text-md font-bold text-slate-100">{selectedPR.title}</h3>
                        <span className={`text-[9px] font-extrabold uppercase px-1.5 rounded-full ${
                          selectedPR.status === 'merged' ? 'text-purple-400 border border-purple-900/30' : 'text-green-400 border border-green-900/30'
                        }`}>{selectedPR.status}</span>
                      </div>
                      <p className="text-3xs text-slate-500 mt-1">Merge path: {selectedPR.source_branch} into {selectedPR.target_branch} • opened by @{selectedPR.author_name}</p>
                    </div>

                    <div className="flex items-center gap-2">
                      {selectedPR.status === 'open' && (
                        <button
                          onClick={() => mergePR(selectedPR.id)}
                          className="bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-3xs uppercase py-2 px-4 rounded-xl cursor-pointer"
                        >
                          Merge PR
                        </button>
                      )}
                      <button
                        onClick={() => setSelectedPR(null)}
                        className="bg-slate-800 hover:bg-slate-750 text-slate-400 hover:text-slate-200 py-1.5 px-3 rounded-xl text-xs cursor-pointer"
                      >
                        Close
                      </button>
                    </div>
                  </div>

                  <div className="flex-1 overflow-y-auto select-text font-mono text-xs">
                    {prDiff ? (
                      <ReactDiffViewer
                        oldValue=""
                        newValue={prDiff}
                        splitView={false}
                        useDarkTheme={true}
                        styles={{
                          variables: {
                            dark: {
                              diffViewerBackground: '#090d16',
                              addedBackground: '#0d2818',
                              addedColor: '#4fba74',
                              removedBackground: '#2d0f11',
                              removedColor: '#ff6b6b'
                            }
                          }
                        }}
                      />
                    ) : (
                      <p className="text-xs text-slate-500 italic">Loading changes diff...</p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* MODAL / SUB-VIEW: CI Logs Terminal Container (Popup overlay when selectedCIRun exists) */}
            {selectedCIRun && (
              <div className="fixed inset-0 z-40 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-6">
                <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl w-full max-w-4xl shadow-2xl h-[85vh] flex flex-col overflow-hidden">
                  <div className="border-b border-slate-800 pb-4 mb-4 flex justify-between items-center shrink-0">
                    <div>
                      <h3 className="text-md font-bold text-slate-100">CI Build Run #{selectedCIRun.id}</h3>
                      <p className="text-3xs text-slate-500 mt-1 font-mono">Commit: {selectedCIRun.commit_hash}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`text-[9px] font-extrabold uppercase py-1 px-2.5 rounded-full border ${
                        selectedCIRun.status === 'success' ? 'text-green-400 border-green-900/30' : selectedCIRun.status === 'failed' ? 'text-red-400 border-red-900/30' : 'text-yellow-400 border-yellow-900/30 animate-pulse'
                      }`}>{selectedCIRun.status}</span>
                      <button
                        onClick={() => setSelectedCIRun(null)}
                        className="bg-slate-800 hover:bg-slate-750 text-slate-400 hover:text-slate-200 py-1.5 px-3 rounded-xl text-xs cursor-pointer"
                      >
                        Close
                      </button>
                    </div>
                  </div>

                  <div className="flex-1 bg-slate-950 border border-slate-850 p-4 rounded-xl overflow-y-auto select-text font-mono text-xs text-slate-300 whitespace-pre-wrap leading-relaxed">
                    {selectedCIRun.log || '[CI Sandbox] Initializing job, waiting for execution logs...'}
                  </div>
                </div>
              </div>
            )}

          </div>
        ) : (
          /* Empty / Welcome State */
          <div className="md:col-span-9 flex flex-col items-center justify-center text-center p-8 space-y-6 max-w-xl mx-auto select-text">
            <h2 className="text-2xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-indigo-400 via-cyan-400 to-purple-400">
              Welcome to GitPub!
            </h2>
            <p className="text-slate-400 text-xs leading-relaxed">
              To get started, select an existing repository from the sidebar or click the plus button to initialize a new Git repository.
            </p>

            <div className="w-full bg-slate-900/20 border border-slate-900 p-6 rounded-2xl text-left font-mono text-xxs text-slate-400 space-y-3 shadow-xl backdrop-blur-sm">
              <p className="text-indigo-400 font-sans font-bold text-xs tracking-wide">Command Line Setup</p>
              
              <div className="space-y-1">
                <p className="text-slate-600 font-sans"># 1. Setup git authentication helper</p>
                <p className="bg-slate-950/70 p-2 rounded border border-slate-850 select-all">git config --global credential.helper store</p>
              </div>

              <div className="space-y-1">
                <p className="text-slate-600 font-sans"># 2. Clone a repository (input username & PAT token when prompted)</p>
                <p className="bg-slate-950/70 p-2 rounded border border-slate-850 select-all">git clone http://localhost:8081/&lt;username&gt;/&lt;repo_name&gt;.git</p>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Modals */}
      {/* 1. New Repository Modal */}
      {showNewRepoModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl w-full max-w-sm shadow-2xl relative">
            <h3 className="text-xs font-extrabold uppercase tracking-widest text-slate-400 mb-4">Create New Repository</h3>
            <form onSubmit={createRepo} className="space-y-4">
              <div>
                <label className="block text-3xs font-bold uppercase tracking-wider text-slate-500 mb-1">Repository Name</label>
                <input
                  type="text"
                  value={newRepoName}
                  onChange={(e) => setNewRepoName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 rounded-lg py-2 px-3 text-sm text-slate-200 outline-none"
                  placeholder="my-cool-project"
                  required
                />
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="is_private"
                  checked={newRepoPrivate}
                  onChange={(e) => setNewRepoPrivate(e.target.checked)}
                  className="rounded border-slate-800 text-indigo-650 focus:ring-indigo-500 bg-slate-950"
                />
                <label htmlFor="is_private" className="text-xs text-slate-400 cursor-pointer">Make this repository Private</label>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowNewRepoModal(false)}
                  className="bg-slate-800 hover:bg-slate-750 text-slate-300 text-xs font-semibold py-2 px-4 rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold py-2 px-4 rounded-lg cursor-pointer"
                >
                  Create Repo
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 2. New PR Modal */}
      {showNewPrModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl w-full max-w-sm shadow-2xl">
            <h3 className="text-xs font-extrabold uppercase tracking-widest text-slate-400 mb-4">Open Pull Request</h3>
            <form onSubmit={createPR} className="space-y-4">
              <div>
                <label className="block text-3xs font-bold uppercase tracking-wider text-slate-500 mb-1">PR Title</label>
                <input
                  type="text"
                  value={newPrTitle}
                  onChange={(e) => setNewPrTitle(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 rounded-lg py-2 px-3 text-sm text-slate-200 outline-none"
                  placeholder="feat: add cool database index"
                  required
                />
              </div>
              <div>
                <label className="block text-3xs font-bold uppercase tracking-wider text-slate-500 mb-1">Source Branch (Compare)</label>
                <input
                  type="text"
                  value={newPrSource}
                  onChange={(e) => setNewPrSource(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 rounded-lg py-2 px-3 text-sm text-slate-200 outline-none font-mono"
                  placeholder="feature-branch"
                  required
                />
              </div>
              <div>
                <label className="block text-3xs font-bold uppercase tracking-wider text-slate-500 mb-1">Target Branch (Base)</label>
                <input
                  type="text"
                  value={newPrTarget}
                  onChange={(e) => setNewPrTarget(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 rounded-lg py-2 px-3 text-sm text-slate-200 outline-none font-mono"
                  placeholder="main"
                  required
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowNewPrModal(false)}
                  className="bg-slate-800 hover:bg-slate-750 text-slate-300 text-xs font-semibold py-2 px-4 rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold py-2 px-4 rounded-lg cursor-pointer"
                >
                  Open PR
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 3. Run CI Modal */}
      {showCiModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl w-full max-w-sm shadow-2xl">
            <h3 className="text-xs font-extrabold uppercase tracking-widest text-slate-400 mb-4">Run CI/CD Build</h3>
            <form onSubmit={triggerCI} className="space-y-4">
              <div>
                <label className="block text-3xs font-bold uppercase tracking-wider text-slate-500 mb-1">Branch, Tag, or Commit SHA</label>
                <input
                  type="text"
                  value={newCiRef}
                  onChange={(e) => setNewCiRef(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 rounded-lg py-2 px-3 text-sm text-slate-200 outline-none font-mono"
                  placeholder="main"
                  required
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCiModal(false)}
                  className="bg-slate-800 hover:bg-slate-750 text-slate-300 text-xs font-semibold py-2 px-4 rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold py-2 px-4 rounded-lg cursor-pointer"
                >
                  Run Build
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}
