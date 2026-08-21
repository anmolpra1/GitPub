'use client';

import React, { useState, useEffect } from 'react';
import axios from 'axios';
import Editor from '@monaco-editor/react';
import ReactDiffViewer from 'react-diff-viewer-continued';
import Script from 'next/script';

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
  const [googleInitialized, setGoogleInitialized] = useState<boolean>(false);

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

  // Load/initialize Google Sign-in client
  const initGoogle = () => {
    if (googleInitialized) return;
    const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || 'dummy-client-id.apps.googleusercontent.com';
    
    const win = window as any;
    if (win.google?.accounts?.id) {
      win.google.accounts.id.initialize({
        client_id: clientId,
        callback: async (response: any) => {
          try {
            setErrorMsg(null);
            const res = await axios.post(`${API_BASE}/auth/google`, {
              credential: response.credential
            });
            localStorage.setItem('token', res.data.token);
            localStorage.setItem('user', JSON.stringify(res.data.user));
            setToken(res.data.token);
            setCurrentUser(res.data.user);
            setSuccessMsg('Signed in with Google successfully!');
          } catch (err: any) {
            setErrorMsg(err.response?.data?.error || 'Google Sign-In failed');
          }
        }
      });
      setGoogleInitialized(true);
    }
  };

  useEffect(() => {
    const win = window as any;
    if (typeof window !== 'undefined' && win.google?.accounts?.id) {
      initGoogle();
    }
  }, [token]);

  useEffect(() => {
    const win = window as any;
    if (googleInitialized && !token) {
      const container = document.getElementById('google-signin-btn');
      if (container) {
        win.google.accounts.id.renderButton(
          container,
          { theme: 'outline', size: 'large', width: 384 }
        );
      }
    }
  }, [googleInitialized, token, isRegister]);

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
        setSuccessMsg('Authentication successful!');
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
      setSuccessMsg('PAT token created successfully!');
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
      if (err.response?.status === 401 || err.response?.status === 403) {
        handleLogout();
      }
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
    } catch (err: any) {
      console.error(err);
      if (err.response?.status === 401 || err.response?.status === 403) {
        handleLogout();
      }
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
    } catch (err: any) {
      console.error(err);
      if (err.response?.status === 401 || err.response?.status === 403) {
        handleLogout();
      }
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
    } catch (err: any) {
      console.error(err);
      if (err.response?.status === 401 || err.response?.status === 403) {
        handleLogout();
      }
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
      <main className="min-h-screen bg-[#0d0b0a] text-slate-100 flex items-center justify-center p-4 relative overflow-hidden font-sans select-none">
        <Script src="https://accounts.google.com/gsi/client" onLoad={initGoogle} strategy="afterInteractive" />
        {/* Progra.AI Amber Glow */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[350px] bg-gradient-to-b from-[#ff5d22]/10 to-transparent rounded-full blur-[120px] pointer-events-none"></div>

        <div className="w-full max-w-md bg-[#131110]/60 backdrop-blur-xl border border-stone-850 p-8 rounded-2xl shadow-2xl relative z-10">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-light tracking-wide text-white">
              ( <span className="font-extrabold bg-clip-text text-transparent bg-gradient-to-r from-[#ff5d22] to-[#ff7a45]">GitPub</span> )
            </h1>
            <p className="text-stone-400 text-xs mt-3 tracking-wider font-mono">AI-POWERED CODE REPOSITORY</p>
          </div>

          <form onSubmit={handleAuth} className="space-y-4">
            {isRegister && (
              <div>
                <label className="block text-3xs font-bold uppercase tracking-widest text-stone-500 mb-1">Username</label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full bg-[#0d0b0a] border border-stone-850 focus:border-[#ff5d22] rounded-lg py-2 px-3 text-sm text-slate-100 placeholder-stone-700 outline-none transition"
                  placeholder="username"
                  required
                />
              </div>
            )}
            <div>
              <label className="block text-3xs font-bold uppercase tracking-widest text-stone-500 mb-1">Email Address</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-[#0d0b0a] border border-stone-850 focus:border-[#ff5d22] rounded-lg py-2 px-3 text-sm text-slate-100 placeholder-stone-700 outline-none transition"
                placeholder="developer@gitpub.io"
                required
              />
            </div>
            <div>
              <label className="block text-3xs font-bold uppercase tracking-widest text-stone-500 mb-1">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-[#0d0b0a] border border-stone-850 focus:border-[#ff5d22] rounded-lg py-2 px-3 text-sm text-slate-100 placeholder-stone-700 outline-none transition"
                placeholder="••••••••"
                required
              />
            </div>

            {errorMsg && <p className="text-red-400 text-xs text-center bg-red-950/20 border border-red-900/30 py-2 px-3 rounded-lg">{errorMsg}</p>}
            {successMsg && <p className="text-green-400 text-xs text-center bg-green-950/20 border border-green-900/30 py-2 px-3 rounded-lg">{successMsg}</p>}

            <button
              type="submit"
              className="w-full bg-gradient-to-r from-[#e23b00] to-[#ff5d22] hover:brightness-110 text-white font-bold py-2.5 rounded-lg shadow-lg shadow-[#ff5d22]/10 active:scale-[0.98] transition cursor-pointer text-center text-xs tracking-wider uppercase"
            >
              {isRegister ? 'Create Account' : 'Sign In'}
            </button>
          </form>

          <div className="mt-4 space-y-4">
            <div className="relative flex py-1 items-center">
              <div className="flex-grow border-t border-stone-850"></div>
              <span className="flex-shrink mx-4 text-stone-500 text-3xs font-bold uppercase tracking-widest font-mono">or</span>
              <div className="flex-grow border-t border-stone-850"></div>
            </div>
            <div className="w-full flex justify-center">
              <div id="google-signin-btn" className="w-full flex justify-center min-h-[40px]"></div>
            </div>
          </div>

          <div className="mt-6 text-center text-xs text-stone-400">
            {isRegister ? (
              <p>
                Already have an account?{' '}
                <button onClick={() => { setIsRegister(false); setErrorMsg(null); }} className="text-[#ff5d22] hover:text-[#ff7a45] font-semibold cursor-pointer">
                  Sign In
                </button>
              </p>
            ) : (
              <p>
                Ready to Code Smarter?{' '}
                <button onClick={() => { setIsRegister(true); setErrorMsg(null); }} className="text-[#ff5d22] hover:text-[#ff7a45] font-semibold cursor-pointer">
                  Register
                </button>
              </p>
            )}
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#0d0b0a] text-stone-300 flex flex-col font-sans relative overflow-hidden select-none pb-8">
      {/* Top ambient orange glow */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[1000px] h-[300px] bg-gradient-to-b from-[#ff5d22]/5 to-transparent rounded-full blur-[140px] pointer-events-none z-0"></div>

      {/* Toast notifications */}
      {successMsg && (
        <div className="fixed bottom-4 right-4 z-50 bg-[#131110] border border-green-900/40 text-green-400 text-xs py-2.5 px-4 rounded-xl shadow-2xl flex items-center gap-3">
          <span>✔️ {successMsg}</span>
          <button onClick={() => setSuccessMsg(null)} className="hover:text-green-200 font-bold text-sm cursor-pointer">×</button>
        </div>
      )}
      {errorMsg && (
        <div className="fixed bottom-4 right-4 z-50 bg-[#131110] border border-red-900/40 text-red-400 text-xs py-2.5 px-4 rounded-xl shadow-2xl flex items-center gap-3">
          <span>❌ {errorMsg}</span>
          <button onClick={() => setErrorMsg(null)} className="hover:text-red-200 font-bold text-sm cursor-pointer">×</button>
        </div>
      )}

      {/* Progra.AI Themed Navigation Bar */}
      <nav className="bg-[#131110]/30 border-b border-stone-900/80 px-6 py-4 flex justify-between items-center z-10 shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-lg font-light tracking-wide text-white">
            ( <span className="font-extrabold bg-clip-text text-transparent bg-gradient-to-r from-[#ff5d22] to-[#ff7a45]">GitPub</span> )
          </span>
          <span className="text-[9px] font-bold tracking-widest text-[#ff5d22] bg-[#ff5d22]/5 border border-[#ff5d22]/20 py-0.5 px-2 rounded-full">
            PROGRA ENGINE
          </span>
        </div>

        <div className="flex items-center gap-4">
          {selectedRepo && (
            <div className="hidden sm:flex items-center gap-2 border border-stone-850 px-3.5 py-1 rounded-full bg-[#131110]/40 text-xxs text-stone-400 font-mono">
              <span className="w-1.5 h-1.5 rounded-full bg-[#ff5d22] shadow-[0_0_8px_#ff5d22] animate-pulse"></span>
              {selectedRepo.owner_name} / {selectedRepo.name}
            </div>
          )}
          <button
            onClick={generatePAT}
            className="border border-[#ff5d22]/40 hover:bg-[#ff5d22]/5 text-[#ff5d22] text-[10px] font-bold uppercase tracking-widest py-1.5 px-4 rounded-full transition cursor-pointer"
          >
            Generate PAT
          </button>
          <div className="flex items-center gap-3">
            <span className="text-xs font-semibold text-stone-400">@{currentUser?.username}</span>
            <button
              onClick={handleLogout}
              className="text-stone-500 hover:text-[#ff5d22] text-xs font-semibold cursor-pointer"
            >
              Exit
            </button>
          </div>
        </div>
      </nav>

      {/* PAT Display banner */}
      {generatedPat && (
        <div className="max-w-7xl mx-auto w-full px-6 mt-4 z-10 shrink-0">
          <div className="bg-[#131110]/40 border border-stone-850 p-4 rounded-2xl flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div className="space-y-0.5">
              <h4 className="text-xs font-bold text-[#ff5d22] tracking-wide">Personal Access Token Generated</h4>
              <p className="text-[10px] text-stone-400">Use this token as your git password when pushing/cloning. Copy it now, you will never see it again:</p>
            </div>
            <div className="bg-[#0d0b0a] p-2 rounded-xl border border-stone-850 flex items-center justify-between gap-4 font-mono text-xs text-[#ff7a45] w-full md:w-auto shrink-0 select-text">
              <span>{generatedPat}</span>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(generatedPat);
                  setSuccessMsg('Token copied to clipboard!');
                }}
                className="text-stone-500 hover:text-white text-2xs cursor-pointer font-sans"
              >
                Copy
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Progra-Style Bento Grid */}
      <section className="flex-1 max-w-7xl mx-auto w-full px-6 mt-6 grid grid-cols-1 md:grid-cols-12 gap-6 z-10 overflow-hidden">
        
        {/* BENTO BOX 1: Repositories List */}
        <div className="md:col-span-3 bg-[#131110]/40 border border-stone-900 rounded-2xl flex flex-col overflow-hidden backdrop-blur-sm h-[320px] md:h-[680px]">
          <div className="p-4 border-b border-stone-900 flex justify-between items-center bg-[#131110]/20">
            <span className="text-[10px] font-bold uppercase tracking-wider text-stone-400">( Repositories )</span>
            <button
              onClick={() => setShowNewRepoModal(true)}
              className="border border-[#ff5d22]/30 hover:bg-[#ff5d22]/5 text-[#ff5d22] rounded-full p-1.5 active:scale-95 transition cursor-pointer"
              title="Add Repository"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 4v16m8-8H4"></path></svg>
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-1">
            {repos.length === 0 ? (
              <p className="text-xs text-stone-600 italic p-3 text-center">No projects found</p>
            ) : (
              repos.map((repo) => (
                <button
                  key={repo.id}
                  onClick={() => setSelectedRepo(repo)}
                  className={`w-full text-left py-2 px-3.5 rounded-xl text-xs flex items-center justify-between cursor-pointer border transition ${
                    selectedRepo?.id === repo.id
                      ? 'bg-[#ff5d22]/5 text-[#ff7a45] font-semibold border-[#ff5d22]/20'
                      : 'bg-transparent text-stone-450 hover:text-white border-transparent hover:bg-[#131110]/20'
                  }`}
                >
                  <span className="truncate">{repo.name}</span>
                  <span className="text-[8px] uppercase tracking-widest px-2 py-0.5 rounded-full border border-stone-850 bg-[#0d0b0a] text-stone-500">
                    {repo.is_private ? 'prv' : 'pub'}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>

        {/* RIGHT CONTENT COLUMN */}
        {selectedRepo ? (
          <div className="md:col-span-9 grid grid-cols-1 md:grid-cols-9 gap-6 overflow-hidden">
            
            {/* BENTO BOX 2: Repository Info Header */}
            <div className="md:col-span-9 bg-[#131110]/40 border border-stone-900 p-4 rounded-2xl flex flex-col md:flex-row justify-between items-start md:items-center gap-4 backdrop-blur-sm">
              <div className="space-y-1">
                <h3 className="text-base font-light tracking-wide text-white">
                  ( <span className="font-extrabold text-[#ff7a45]">{selectedRepo.name}</span> )
                  <span className="text-[9px] font-extrabold uppercase tracking-widest text-stone-500 bg-[#0d0b0a] border border-stone-850 py-0.5 px-2 rounded-full ml-2">
                    {selectedRepo.is_private ? 'Private' : 'Public'}
                  </span>
                </h3>
                <p className="text-[10px] text-stone-500 font-mono">Clone URL: http://localhost:8081/{selectedRepo.owner_name}/{selectedRepo.name}.git</p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowNewPrModal(true)}
                  className="border border-[#ff5d22]/40 hover:bg-[#ff5d22]/5 text-[#ff5d22] text-[10px] uppercase font-bold tracking-wider py-1.5 px-4 rounded-xl cursor-pointer"
                >
                  New PR
                </button>
                <button
                  onClick={() => setShowCiModal(true)}
                  className="border border-purple-500/40 hover:bg-purple-500/5 text-purple-400 text-[10px] uppercase font-bold tracking-wider py-1.5 px-4 rounded-xl cursor-pointer"
                >
                  Run CI
                </button>
              </div>
            </div>

            {/* BENTO BOX 3: File Explorer */}
            <div className="md:col-span-3 bg-[#131110]/40 border border-stone-900 rounded-2xl flex flex-col overflow-hidden backdrop-blur-sm h-[300px] md:h-[570px]">
              <div className="p-3.5 border-b border-stone-900 bg-[#131110]/20">
                <span className="text-[10px] font-bold uppercase tracking-wider text-stone-400">( File Explorer )</span>
              </div>
              <div className="flex-1 overflow-y-auto p-3 space-y-1">
                {isEmptyRepo ? (
                  <div className="text-center p-4">
                    <p className="text-xs text-stone-500 italic">Repo is empty</p>
                  </div>
                ) : (
                  files.map((file) => (
                    <button
                      key={file}
                      onClick={() => viewFile(file)}
                      className={`w-full text-left py-2 px-3 rounded-lg text-xs font-mono truncate transition border cursor-pointer ${
                        selectedFile === file
                          ? 'bg-[#ff5d22]/5 text-[#ff7a45] border-[#ff5d22]/20'
                          : 'bg-transparent text-stone-400 border-transparent hover:bg-[#131110]/20'
                      }`}
                    >
                      📁 {file}
                    </button>
                  ))
                )}
              </div>
            </div>

            {/* BENTO BOX 4: Monaco Code Editor */}
            <div className="md:col-span-6 bg-[#131110]/40 border border-stone-900 rounded-2xl flex flex-col overflow-hidden backdrop-blur-sm h-[350px] md:h-[570px]">
              {selectedFile ? (
                <div className="flex-1 flex flex-col overflow-hidden">
                  <div className="bg-[#131110]/20 border-b border-stone-900 px-4 py-2.5 text-xs font-mono text-stone-400">
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
                <div className="flex-1 flex flex-col items-center justify-center p-6 text-center text-stone-500">
                  <div className="text-3xl text-stone-700 mb-2 font-light select-none">
                    ( &lt; &gt; )
                  </div>
                  <p className="text-xs tracking-wider">Select a file from tree explorer to view code</p>
                </div>
              )}
            </div>

            {/* BENTO BOX 5: Pull Request Center */}
            <div className="md:col-span-4 bg-[#131110]/40 border border-stone-900 rounded-2xl p-4 flex flex-col justify-between backdrop-blur-sm h-[320px] overflow-hidden">
              <div className="flex-1 flex flex-col overflow-hidden">
                <span className="text-[10px] font-bold uppercase tracking-wider text-stone-400 block mb-3">( Pull Requests )</span>
                <div className="flex-1 overflow-y-auto space-y-1.5">
                  {prs.length === 0 ? (
                    <p className="text-xs text-stone-600 italic p-2">No active PRs</p>
                  ) : (
                    prs.map((pr) => (
                      <button
                        key={pr.id}
                        onClick={() => viewPRDetails(pr)}
                        className={`w-full text-left p-2.5 rounded-xl border text-xs transition cursor-pointer flex flex-col gap-1 ${
                          selectedPR?.id === pr.id
                            ? 'bg-[#131110] border-stone-750 text-slate-100'
                            : 'bg-transparent border-stone-900 text-stone-400 hover:bg-[#131110]/30'
                        }`}
                      >
                        <div className="flex justify-between items-center w-full">
                          <span className="font-bold text-stone-200 truncate">{pr.title}</span>
                          <span className={`text-[8px] font-bold uppercase px-2 py-0.5 rounded-full ${
                            pr.status === 'merged' ? 'text-purple-400 border border-purple-900/30 bg-purple-950/20' : 'text-green-400 border border-green-900/30 bg-green-950/20'
                          }`}>{pr.status}</span>
                        </div>
                        <div className="flex justify-between items-center text-[9px] text-stone-500">
                          <span>{pr.source_branch} → {pr.target_branch}</span>
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </div>
            </div>

            {/* BENTO BOX 6: CI/CD Execution Log Monitor */}
            <div className="md:col-span-5 bg-[#131110]/40 border border-stone-900 rounded-2xl p-4 flex flex-col justify-between backdrop-blur-sm h-[320px] overflow-hidden">
              <div className="flex-1 flex flex-col overflow-hidden">
                <span className="text-[10px] font-bold uppercase tracking-wider text-stone-400 block mb-3">( CI/CD Pipelines )</span>
                <div className="flex-1 overflow-y-auto space-y-1.5">
                  {ciRuns.length === 0 ? (
                    <p className="text-xs text-stone-600 italic p-2">No pipeline runs queued</p>
                  ) : (
                    ciRuns.map((run) => (
                      <button
                        key={run.id}
                        onClick={() => setSelectedCIRun(run)}
                        className={`w-full text-left p-2.5 rounded-xl border text-xs transition cursor-pointer flex flex-col gap-1 ${
                          selectedCIRun?.id === run.id
                            ? 'bg-[#131110] border-stone-750 text-slate-100'
                            : 'bg-transparent border-stone-900 text-stone-400 hover:bg-[#131110]/30'
                        }`}
                      >
                        <div className="flex justify-between items-center w-full">
                          <span className="font-mono text-stone-350">Run #{run.id} ({run.commit_hash.slice(0, 7)})</span>
                          <span className={`text-[8px] font-bold uppercase px-2 py-0.5 rounded-full border ${
                            run.status === 'success' ? 'text-green-400 border-green-900/30 bg-green-950/20' : run.status === 'failed' ? 'text-red-400 border-red-900/30 bg-red-950/20' : 'text-[#ff5d22] border-[#ff5d22]/30 bg-[#ff5d22]/5 animate-pulse'
                          }`}>{run.status}</span>
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </div>
            </div>

            {/* OVERLAY MODAL: PR Details & Diffs */}
            {selectedPR && (
              <div className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm flex items-center justify-center p-6">
                <div className="bg-[#0f0e0d] border border-stone-850 p-6 rounded-2xl w-full max-w-4xl h-[85vh] flex flex-col overflow-hidden shadow-2xl">
                  <div className="border-b border-stone-850 pb-4 mb-4 flex justify-between items-center shrink-0">
                    <div>
                      <div className="flex items-center gap-3">
                        <h3 className="text-md font-bold text-white">{selectedPR.title}</h3>
                        <span className={`text-[9px] font-bold uppercase px-2 py-0.5 rounded-full ${
                          selectedPR.status === 'merged' ? 'text-purple-400 border border-purple-900/30 bg-purple-950/20' : 'text-green-400 border border-green-900/30 bg-green-950/20'
                        }`}>{selectedPR.status}</span>
                      </div>
                      <p className="text-[10px] text-stone-500 mt-1">Merge path: {selectedPR.source_branch} into {selectedPR.target_branch} • opened by @{selectedPR.author_name}</p>
                    </div>

                    <div className="flex items-center gap-2">
                      {selectedPR.status === 'open' && (
                        <button
                          onClick={() => mergePR(selectedPR.id)}
                          className="bg-gradient-to-r from-[#e23b00] to-[#ff5d22] hover:brightness-110 text-white font-bold text-xxs uppercase tracking-wider py-2 px-5 rounded-xl cursor-pointer shadow-lg"
                        >
                          Merge PR
                        </button>
                      )}
                      <button
                        onClick={() => setSelectedPR(null)}
                        className="bg-[#1c1a19] hover:bg-[#282625] text-stone-400 hover:text-white py-1.5 px-4 rounded-xl text-xs cursor-pointer border border-stone-800"
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
                              diffViewerBackground: '#0d0b0a',
                              addedBackground: '#0d2818',
                              addedColor: '#4fba74',
                              removedBackground: '#2d0f11',
                              removedColor: '#ff6b6b'
                            }
                          }
                        }}
                      />
                    ) : (
                      <p className="text-xs text-stone-500 italic">Calculating file diffs...</p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* OVERLAY MODAL: CI Logs Terminal View */}
            {selectedCIRun && (
              <div className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm flex items-center justify-center p-6">
                <div className="bg-[#0f0e0d] border border-stone-850 p-6 rounded-2xl w-full max-w-4xl h-[85vh] flex flex-col overflow-hidden shadow-2xl">
                  <div className="border-b border-stone-850 pb-4 mb-4 flex justify-between items-center shrink-0">
                    <div>
                      <h3 className="text-md font-bold text-white">CI Build Run #{selectedCIRun.id}</h3>
                      <p className="text-[10px] text-stone-550 font-mono mt-1">Commit: {selectedCIRun.commit_hash}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className={`text-[9px] font-bold uppercase py-1 px-3 rounded-full border ${
                        selectedCIRun.status === 'success' ? 'text-green-450 border-green-900/30 bg-green-950/20' : selectedCIRun.status === 'failed' ? 'text-red-450 border-red-900/30 bg-red-950/20' : 'text-[#ff5d22] border-[#ff5d22]/30 bg-[#ff5d22]/5 animate-pulse'
                      }`}>{selectedCIRun.status}</span>
                      <button
                        onClick={() => setSelectedCIRun(null)}
                        className="bg-[#1c1a19] hover:bg-[#282625] text-stone-400 hover:text-white py-1.5 px-4 rounded-xl text-xs cursor-pointer border border-stone-800"
                      >
                        Close
                      </button>
                    </div>
                  </div>

                  <div className="flex-1 bg-[#050404] border border-stone-900 p-5 rounded-xl overflow-y-auto select-text font-mono text-xs text-stone-300 whitespace-pre-wrap leading-relaxed">
                    {selectedCIRun.log || '[CI Sandbox] Initializing job, waiting for execution logs...'}
                  </div>
                </div>
              </div>
            )}

          </div>
        ) : (
          /* Welcome View */
          <div className="md:col-span-9 flex flex-col items-center justify-center text-center p-8 space-y-6 max-w-xl mx-auto select-text">
            <h2 className="text-2xl font-light tracking-wide text-white">
              ( <span className="font-extrabold bg-clip-text text-transparent bg-gradient-to-r from-[#ff5d22] to-[#ff7a45]">Code Smarter</span> )
            </h2>
            <p className="text-stone-400 text-xs leading-relaxed max-w-md">
              GitPub is a secure, light-weight self-hosted version control service. Create a repository using the folder icon in the sidebar, or push from your local Git clients to get started.
            </p>

            <div className="w-full bg-[#131110]/30 border border-stone-900 p-6 rounded-2xl text-left font-mono text-xxs text-stone-400 space-y-3 shadow-xl backdrop-blur-sm">
              <p className="text-[#ff5d22] font-sans font-bold text-xs tracking-wider uppercase">Command Line Setup</p>
              
              <div className="space-y-1">
                <p className="text-stone-600 font-sans"># 1. Setup git authentication helper</p>
                <p className="bg-[#0d0b0a] p-2 rounded-xl border border-stone-850 select-all">git config --global credential.helper store</p>
              </div>

              <div className="space-y-1">
                <p className="text-stone-600 font-sans"># 2. Clone a repository (input username & PAT token when prompted)</p>
                <p className="bg-[#0d0b0a] p-2 rounded-xl border border-stone-850 select-all">git clone http://localhost:8081/&lt;username&gt;/&lt;repo_name&gt;.git</p>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Modals */}
      {/* 1. New Repository Modal */}
      {showNewRepoModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#0f0e0d] border border-stone-850 p-6 rounded-2xl w-full max-w-sm shadow-2xl relative">
            <h3 className="text-xs font-bold uppercase tracking-widest text-stone-400 mb-4">( Create Repository )</h3>
            <form onSubmit={createRepo} className="space-y-4">
              <div>
                <label className="block text-3xs font-bold uppercase tracking-wider text-stone-500 mb-1">Repository Name</label>
                <input
                  type="text"
                  value={newRepoName}
                  onChange={(e) => setNewRepoName(e.target.value)}
                  className="w-full bg-[#0d0b0a] border border-stone-850 focus:border-[#ff5d22] rounded-lg py-2 px-3 text-sm text-slate-200 outline-none"
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
                  className="rounded border-stone-800 text-[#ff5d22] focus:ring-[#ff5d22] bg-[#0d0b0a]"
                />
                <label htmlFor="is_private" className="text-xs text-stone-450 cursor-pointer">Make this repository Private</label>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowNewRepoModal(false)}
                  className="bg-[#1c1a19] hover:bg-[#282625] text-stone-300 text-xs font-semibold py-2 px-4 rounded-lg cursor-pointer border border-stone-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="bg-gradient-to-r from-[#e23b00] to-[#ff5d22] text-white text-xs font-semibold py-2 px-4 rounded-lg cursor-pointer shadow-lg"
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
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#0f0e0d] border border-stone-850 p-6 rounded-2xl w-full max-w-sm shadow-2xl">
            <h3 className="text-xs font-bold uppercase tracking-widest text-stone-400 mb-4">( Open Pull Request )</h3>
            <form onSubmit={createPR} className="space-y-4">
              <div>
                <label className="block text-3xs font-bold uppercase tracking-wider text-stone-500 mb-1">PR Title</label>
                <input
                  type="text"
                  value={newPrTitle}
                  onChange={(e) => setNewPrTitle(e.target.value)}
                  className="w-full bg-[#0d0b0a] border border-stone-850 focus:border-[#ff5d22] rounded-lg py-2 px-3 text-sm text-slate-200 outline-none"
                  placeholder="feat: add cool database index"
                  required
                />
              </div>
              <div>
                <label className="block text-3xs font-bold uppercase tracking-wider text-stone-500 mb-1">Source Branch (Compare)</label>
                <input
                  type="text"
                  value={newPrSource}
                  onChange={(e) => setNewPrSource(e.target.value)}
                  className="w-full bg-[#0d0b0a] border border-stone-850 focus:border-[#ff5d22] rounded-lg py-2 px-3 text-sm text-slate-200 outline-none font-mono"
                  placeholder="feature-branch"
                  required
                />
              </div>
              <div>
                <label className="block text-3xs font-bold uppercase tracking-wider text-stone-500 mb-1">Target Branch (Base)</label>
                <input
                  type="text"
                  value={newPrTarget}
                  onChange={(e) => setNewPrTarget(e.target.value)}
                  className="w-full bg-[#0d0b0a] border border-stone-850 focus:border-[#ff5d22] rounded-lg py-2 px-3 text-sm text-slate-200 outline-none font-mono"
                  placeholder="main"
                  required
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowNewPrModal(false)}
                  className="bg-[#1c1a19] hover:bg-[#282625] text-stone-300 text-xs font-semibold py-2 px-4 rounded-lg cursor-pointer border border-stone-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="bg-gradient-to-r from-[#e23b00] to-[#ff5d22] text-white text-xs font-semibold py-2 px-4 rounded-lg cursor-pointer shadow-lg"
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
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#0f0e0d] border border-stone-850 p-6 rounded-2xl w-full max-w-sm shadow-2xl">
            <h3 className="text-xs font-bold uppercase tracking-widest text-stone-400 mb-4">( Run CI/CD Build )</h3>
            <form onSubmit={triggerCI} className="space-y-4">
              <div>
                <label className="block text-3xs font-bold uppercase tracking-wider text-stone-500 mb-1">Branch, Tag, or Commit SHA</label>
                <input
                  type="text"
                  value={newCiRef}
                  onChange={(e) => setNewCiRef(e.target.value)}
                  className="w-full bg-[#0d0b0a] border border-stone-850 focus:border-[#ff5d22] rounded-lg py-2 px-3 text-sm text-slate-200 outline-none font-mono"
                  placeholder="main"
                  required
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCiModal(false)}
                  className="bg-[#1c1a19] hover:bg-[#282625] text-stone-300 text-xs font-semibold py-2 px-4 rounded-lg cursor-pointer border border-stone-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="bg-gradient-to-r from-[#e23b00] to-[#ff5d22] text-white text-xs font-semibold py-2 px-4 rounded-lg cursor-pointer shadow-lg"
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
