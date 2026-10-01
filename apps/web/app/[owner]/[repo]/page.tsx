'use client';

import React, { useState, useEffect, use } from 'react';
import { useRouter } from 'next/navigation';
import axios from 'axios';
import Editor from '@monaco-editor/react';
import ReactDiffViewer from 'react-diff-viewer-continued';
import Navbar from '../../../components/Navbar';
import {
  API_BASE,
  GATEWAY_BASE,
  Repository,
  PullRequest,
  PRComment,
  CIRun,
  CommitInfo,
  User,
  getAuthHeaders,
  starRepo,
  unstarRepo,
  forkRepo
} from '../../../lib/api';

interface PageProps {
  params: Promise<{ owner: string; repo: string }>;
}

export default function RepositoryPage({ params }: PageProps) {
  const router = useRouter();
  const resolvedParams = use(params);
  const owner = resolvedParams.owner;
  const repoName = resolvedParams.repo;

  // Auth state
  const [token, setToken] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<User | null>(null);

  // Tab state
  const [activeTab, setActiveTab] = useState<'code' | 'commits' | 'prs' | 'ci' | 'settings'>('code');

  // Repository state
  const [repo, setRepo] = useState<Repository | null>(null);
  const [isOwner, setIsOwner] = useState<boolean>(false);
  const [cloneUrl, setCloneUrl] = useState<string>('');
  const [copiedClone, setCopiedClone] = useState<boolean>(false);
  const [starCount, setStarCount] = useState<number>(0);
  const [isStarred, setIsStarred] = useState<boolean>(false);
  const [forkCount, setForkCount] = useState<number>(0);
  const [isForking, setIsForking] = useState<boolean>(false);

  // Branches & Files state
  const [branches, setBranches] = useState<string[]>([]);
  const [selectedBranch, setSelectedBranch] = useState<string>('main');
  const [files, setFiles] = useState<string[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string>('');
  const [isEmptyRepo, setIsEmptyRepo] = useState<boolean>(false);

  // Commits state
  const [commits, setCommits] = useState<CommitInfo[]>([]);
  const [loadingCommits, setLoadingCommits] = useState<boolean>(false);

  // PR state
  const [prs, setPrs] = useState<PullRequest[]>([]);
  const [selectedPR, setSelectedPR] = useState<PullRequest | null>(null);
  const [prDiff, setPrDiff] = useState<string>('');
  const [prModalTab, setPrModalTab] = useState<'diff' | 'discussion'>('diff');
  const [prComments, setPrComments] = useState<PRComment[]>([]);
  const [newCommentBody, setNewCommentBody] = useState<string>('');
  const [loadingComments, setLoadingComments] = useState<boolean>(false);
  const [showNewPrModal, setShowNewPrModal] = useState<boolean>(false);
  const [newPrTitle, setNewPrTitle] = useState<string>('');
  const [newPrSource, setNewPrSource] = useState<string>('');
  const [newPrTarget, setNewPrTarget] = useState<string>('main');

  // CI state
  const [ciRuns, setCiRuns] = useState<CIRun[]>([]);
  const [selectedCIRun, setSelectedCIRun] = useState<CIRun | null>(null);
  const [showCiModal, setShowCiModal] = useState<boolean>(false);
  const [newCiRef, setNewCiRef] = useState<string>('main');

  // Messages
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Load auth from localStorage on mount
  useEffect(() => {
    const savedToken = localStorage.getItem('token');
    const savedUser = localStorage.getItem('user');
    if (!savedToken) {
      router.push('/');
      return;
    }
    setToken(savedToken);
    if (savedUser) {
      try {
        setCurrentUser(JSON.parse(savedUser));
      } catch {}
    }
  }, [router]);

  // Fetch repository & branches when token is ready
  useEffect(() => {
    if (token) {
      fetchRepository();
      fetchBranches();
    }
  }, [token, owner, repoName]);

  // Fetch files and commits when branch changes
  useEffect(() => {
    if (token && repo) {
      fetchFiles(selectedBranch);
      fetchCommits(selectedBranch);
      fetchPRs();
      fetchCIRuns();
    }
  }, [selectedBranch, repo, token]);

  // Live polling for CI runs when on CI tab
  useEffect(() => {
    if (!token || !repo) return;
    const interval = setInterval(() => {
      fetchCIRuns();
    }, 5000);
    return () => clearInterval(interval);
  }, [token, repo]);

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setToken(null);
    setCurrentUser(null);
    router.push('/');
  };

  const fetchRepository = async () => {
    try {
      const res = await axios.get(`${API_BASE}/repos/${owner}/${repoName}`, getAuthHeaders(token));
      setRepo(res.data.repository);
      setIsOwner(res.data.isOwner);
      setCloneUrl(res.data.cloneUrl);
      setStarCount(res.data.repository?.stars_count || 0);
      setIsStarred(Boolean(res.data.repository?.is_starred));
      setForkCount(res.data.repository?.forks_count || 0);
    } catch (err: any) {
      setErrorMsg(err.response?.data?.error || 'Failed to fetch repository');
    }
  };

  const handleToggleStar = async () => {
    if (!token) return;
    const prevStarred = isStarred;
    const prevCount = starCount;
    // Optimistic UI update
    setIsStarred(!prevStarred);
    setStarCount(prevStarred ? Math.max(0, prevCount - 1) : prevCount + 1);

    try {
      if (prevStarred) {
        const data = await unstarRepo(owner, repoName, token);
        setStarCount(data.stars_count);
        setIsStarred(false);
      } else {
        const data = await starRepo(owner, repoName, token);
        setStarCount(data.stars_count);
        setIsStarred(true);
      }
    } catch (err: any) {
      setIsStarred(prevStarred);
      setStarCount(prevCount);
      setErrorMsg(err.response?.data?.error || 'Failed to update star');
    }
  };

  const handleFork = async () => {
    if (!token) return;
    if (isOwner) {
      setErrorMsg('You cannot fork your own repository');
      return;
    }
    setIsForking(true);
    setErrorMsg(null);
    try {
      const data = await forkRepo(owner, repoName, token);
      setSuccessMsg('Repository forked successfully! Redirecting...');
      setTimeout(() => {
        router.push(`/${currentUser?.username || data.repository.owner_name}/${data.repository.name}`);
      }, 1000);
    } catch (err: any) {
      setIsForking(false);
      setErrorMsg(err.response?.data?.error || 'Failed to fork repository');
    }
  };

  const fetchBranches = async () => {
    try {
      const res = await axios.get(`${API_BASE}/repos/${owner}/${repoName}/branches`, getAuthHeaders(token));
      setBranches(res.data.branches || []);
      if (res.data.defaultBranch) {
        setSelectedBranch(res.data.defaultBranch);
        setNewCiRef(res.data.defaultBranch);
        setNewPrTarget(res.data.defaultBranch);
      }
    } catch (err) {
      console.error('Error fetching branches:', err);
    }
  };

  const fetchFiles = async (branchRef: string) => {
    try {
      const res = await axios.get(
        `${API_BASE}/repos/${owner}/${repoName}/files?ref=${encodeURIComponent(branchRef)}`,
        getAuthHeaders(token)
      );
      setFiles(res.data.files || []);
      setIsEmptyRepo(res.data.isEmpty || false);
      if (res.data.files && res.data.files.length > 0) {
        // Auto select first file or README if available
        const readme = res.data.files.find((f: string) => f.toLowerCase().startsWith('readme'));
        const fileToView = readme || res.data.files[0];
        viewFile(fileToView, branchRef);
      } else {
        setSelectedFile(null);
        setFileContent('');
      }
    } catch (err: any) {
      console.error('Error fetching files:', err);
    }
  };

  const viewFile = async (filePath: string, branchRef = selectedBranch) => {
    setSelectedFile(filePath);
    try {
      const res = await axios.get(
        `${API_BASE}/repos/${owner}/${repoName}/file-content?path=${encodeURIComponent(filePath)}&ref=${encodeURIComponent(branchRef)}`,
        getAuthHeaders(token)
      );
      setFileContent(res.data.content || '');
    } catch (err) {
      console.error('Error viewing file:', err);
    }
  };

  const fetchCommits = async (branchRef: string) => {
    setLoadingCommits(true);
    try {
      const res = await axios.get(
        `${API_BASE}/repos/${owner}/${repoName}/commits?ref=${encodeURIComponent(branchRef)}&limit=30`,
        getAuthHeaders(token)
      );
      setCommits(res.data.commits || []);
    } catch (err) {
      console.error('Error fetching commits:', err);
    } finally {
      setLoadingCommits(false);
    }
  };

  const fetchPRs = async () => {
    if (!repo) return;
    try {
      const res = await axios.get(`${API_BASE}/pulls?repoId=${repo.id}`, getAuthHeaders(token));
      setPrs(res.data.pullRequests || []);
    } catch (err) {
      console.error('Error fetching PRs:', err);
    }
  };

  const createPR = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    try {
      await axios.post(
        `${API_BASE}/pulls`,
        {
          repoId: repo?.id,
          title: newPrTitle,
          sourceBranch: newPrSource,
          targetBranch: newPrTarget
        },
        getAuthHeaders(token)
      );
      setSuccessMsg('Pull Request created successfully!');
      setShowNewPrModal(false);
      setNewPrTitle('');
      setNewPrSource('');
      fetchPRs();
    } catch (err: any) {
      setErrorMsg(err.response?.data?.error || 'Failed to create Pull Request');
    }
  };

  const fetchPRComments = async (prId: number) => {
    setLoadingComments(true);
    try {
      const res = await axios.get(`${API_BASE}/pulls/${prId}/comments`, getAuthHeaders(token));
      setPrComments(res.data.comments || []);
    } catch (err) {
      console.error('Error fetching comments:', err);
    } finally {
      setLoadingComments(false);
    }
  };

  const addPRComment = async (e: React.FormEvent, prId: number) => {
    e.preventDefault();
    if (!newCommentBody.trim()) return;
    try {
      const res = await axios.post(
        `${API_BASE}/pulls/${prId}/comments`,
        { body: newCommentBody.trim() },
        getAuthHeaders(token)
      );
      setPrComments((prev) => [...prev, res.data.comment]);
      setNewCommentBody('');
    } catch (err: any) {
      setErrorMsg(err.response?.data?.error || 'Failed to post comment');
    }
  };

  const viewPRDetails = async (pr: PullRequest) => {
    setSelectedPR(pr);
    setPrDiff('');
    setPrModalTab('diff');
    fetchPRComments(pr.id);
    try {
      const res = await axios.get(`${API_BASE}/pulls/${pr.id}/diff`, getAuthHeaders(token));
      setPrDiff(res.data.diff || '');
    } catch (err) {
      console.error('Error viewing PR diff:', err);
    }
  };

  // Real-time SSE Live Log Streaming for active CI runs
  useEffect(() => {
    if (!selectedCIRun || !token) return;
    if (selectedCIRun.status === 'success' || selectedCIRun.status === 'failed') return;

    const sseUrl = `${API_BASE}/ci/${selectedCIRun.id}/stream?token=${encodeURIComponent(token)}`;
    const es = new EventSource(sseUrl);

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.initial) {
          setSelectedCIRun((prev) => (prev ? { ...prev, log: data.chunk, status: data.status } : null));
        } else if (data.chunk) {
          setSelectedCIRun((prev) => (prev ? { ...prev, log: (prev.log || '') + data.chunk, status: data.status || prev.status } : null));
        }
        if (data.finished) {
          setSelectedCIRun((prev) => (prev ? { ...prev, status: data.status } : null));
          fetchCIRuns();
          es.close();
        }
      } catch (err) {
        console.error('SSE log parsing error:', err);
      }
    };

    es.onerror = () => {
      es.close();
    };

    return () => {
      es.close();
    };
  }, [selectedCIRun?.id, selectedCIRun?.status, token]);

  const mergePR = async (prId: number) => {
    setErrorMsg(null);
    try {
      await axios.post(`${API_BASE}/pulls/${prId}/merge`, {}, getAuthHeaders(token));
      setSuccessMsg('Pull Request merged successfully!');
      fetchPRs();
      setSelectedPR(null);
      fetchBranches();
      fetchFiles(selectedBranch);
    } catch (err: any) {
      setErrorMsg(err.response?.data?.error || err.response?.data?.details || 'Failed to merge PR');
    }
  };

  const fetchCIRuns = async () => {
    if (!repo) return;
    try {
      const res = await axios.get(`${API_BASE}/ci?repoId=${repo.id}`, getAuthHeaders(token));
      setCiRuns(res.data.ciRuns || []);
      if (selectedCIRun) {
        const updated = (res.data.ciRuns || []).find((r: CIRun) => r.id === selectedCIRun.id);
        if (updated) setSelectedCIRun(updated);
      }
    } catch (err) {
      console.error('Error fetching CI runs:', err);
    }
  };

  const triggerCI = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    try {
      await axios.post(
        `${API_BASE}/ci/trigger`,
        {
          repoId: repo?.id,
          branchOrCommit: newCiRef
        },
        getAuthHeaders(token)
      );
      setSuccessMsg('CI run triggered and queued!');
      setShowCiModal(false);
      fetchCIRuns();
      setActiveTab('ci');
    } catch (err: any) {
      setErrorMsg(err.response?.data?.error || 'Failed to trigger CI pipeline');
    }
  };

  const toggleVisibility = async () => {
    if (!repo) return;
    try {
      const res = await axios.patch(
        `${API_BASE}/repos/${owner}/${repoName}`,
        { is_private: !repo.is_private },
        getAuthHeaders(token)
      );
      setRepo(res.data.repository);
      setSuccessMsg(`Repository is now ${res.data.repository.is_private ? 'Private' : 'Public'}`);
    } catch (err: any) {
      setErrorMsg(err.response?.data?.error || 'Failed to update visibility');
    }
  };

  const deleteRepository = async () => {
    if (!confirm(`Are you sure you want to permanently delete ${owner}/${repoName}? This action cannot be undone.`)) {
      return;
    }
    try {
      await axios.delete(`${API_BASE}/repos/${owner}/${repoName}`, getAuthHeaders(token));
      router.push('/');
    } catch (err: any) {
      setErrorMsg(err.response?.data?.error || 'Failed to delete repository');
    }
  };

  if (!repo) {
    return (
      <main className="min-h-screen bg-[#0d0b0a] text-stone-300 flex flex-col font-sans">
        <Navbar currentUser={currentUser} token={token} onLogout={handleLogout} />
        <div className="flex-1 flex items-center justify-center">
          <p className="text-xs text-stone-500 font-mono animate-pulse">Loading repository {owner}/{repoName}...</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#0d0b0a] text-stone-300 flex flex-col font-sans relative overflow-x-hidden pb-12">
      {/* Top ambient orange glow */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[1100px] h-[320px] bg-gradient-to-b from-[#ff5d22]/5 to-transparent rounded-full blur-[140px] pointer-events-none z-0"></div>

      <Navbar
        currentUser={currentUser}
        token={token}
        onLogout={handleLogout}
        repoBreadcrumb={{ owner, name: repoName }}
      />

      {/* Notifications */}
      {successMsg && (
        <div className="fixed bottom-4 right-4 z-50 bg-[#131110] border border-green-900/40 text-green-400 text-xs py-2.5 px-4 rounded-xl shadow-2xl flex items-center gap-3">
          <span>✔️ {successMsg}</span>
          <button onClick={() => setSuccessMsg(null)} className="hover:text-green-200 font-bold text-sm cursor-pointer">✕</button>
        </div>
      )}
      {errorMsg && (
        <div className="fixed bottom-4 right-4 z-50 bg-[#131110] border border-red-900/40 text-red-400 text-xs py-2.5 px-4 rounded-xl shadow-2xl flex items-center gap-3">
          <span>❌ {errorMsg}</span>
          <button onClick={() => setErrorMsg(null)} className="hover:text-red-200 font-bold text-sm cursor-pointer">✕</button>
        </div>
      )}

      {/* Repository Hero Header */}
      <header className="max-w-7xl mx-auto w-full px-6 pt-6 z-10 shrink-0">
        <div className="bg-[#131110]/40 border border-stone-850 p-5 rounded-2xl backdrop-blur-sm flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-xl font-light text-white tracking-wide">
                {owner} / <span className="font-extrabold text-[#ff7a45]">{repo.name}</span>
              </h1>
              <span className="text-[9px] font-extrabold uppercase tracking-widest text-stone-400 bg-[#0d0b0a] border border-stone-800 py-0.5 px-2.5 rounded-full">
                {repo.is_private ? 'Private' : 'Public'}
              </span>
            </div>
            {repo.forked_from && (
              <div className="text-[11px] text-stone-500 flex items-center gap-1 font-mono">
                <span>forked from</span>
                <a href={`/${repo.forked_from.owner}/${repo.forked_from.name}`} className="text-[#ff7a45] hover:underline">
                  {repo.forked_from.owner}/{repo.forked_from.name}
                </a>
              </div>
            )}
            <div className="flex items-center gap-2 font-mono text-[11px] text-stone-500">
              <span>Clone URL:</span>
              <span className="text-stone-400 select-all">{cloneUrl}</span>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(cloneUrl);
                  setCopiedClone(true);
                  setTimeout(() => setCopiedClone(false), 2000);
                }}
                className="text-[10px] text-stone-500 hover:text-white px-2 py-0.5 rounded bg-stone-900 border border-stone-800 transition"
              >
                {copiedClone ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Star Button */}
            <button
              onClick={handleToggleStar}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-[11px] font-medium transition cursor-pointer ${
                isStarred
                  ? 'bg-amber-500/10 border-amber-500/40 text-amber-300 hover:bg-amber-500/20'
                  : 'bg-[#181615] border-stone-800 text-stone-400 hover:text-white hover:border-stone-700'
              }`}
              title={isStarred ? 'Unstar this repository' : 'Star this repository'}
            >
              <span className={isStarred ? 'text-amber-400' : 'text-stone-500'}>★</span>
              <span>{isStarred ? 'Starred' : 'Star'}</span>
              <span className="ml-1 text-[10px] font-mono px-1.5 py-0.2 rounded bg-black/40 text-stone-400 border border-stone-800">
                {starCount}
              </span>
            </button>

            {/* Fork Button */}
            <button
              onClick={handleFork}
              disabled={isOwner || isForking}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-[11px] font-medium transition ${
                isOwner
                  ? 'bg-[#181615] border-stone-850 text-stone-600 cursor-not-allowed opacity-50'
                  : 'bg-[#181615] border-stone-800 text-stone-400 hover:text-white hover:border-stone-700 cursor-pointer'
              }`}
              title={isOwner ? 'You cannot fork your own repository' : 'Fork this repository to your account'}
            >
              <svg className="w-3 h-3 text-stone-500" viewBox="0 0 16 16" fill="currentColor">
                <path fillRule="evenodd" d="M5 3.25a.75.75 0 11-1.5 0 .75.75 0 011.5 0zm0 2.122a2.25 2.25 0 10-1.5 0v.878A2.25 2.25 0 005.75 8.5h1.5v2.128a2.251 2.251 0 101.5 0V8.5h1.5a2.25 2.25 0 002.25-2.25v-.878a2.25 2.25 0 10-1.5 0v.878a.75.75 0 01-.75.75h-4.5A.75.75 0 015 6.25v-.878zm3.75 7.378a.75.75 0 11-1.5 0 .75.75 0 011.5 0zm3-8.75a.75.75 0 100-1.5.75.75 0 000 1.5z"></path>
              </svg>
              <span>{isForking ? 'Forking...' : 'Fork'}</span>
              <span className="ml-1 text-[10px] font-mono px-1.5 py-0.2 rounded bg-black/40 text-stone-400 border border-stone-800">
                {forkCount}
              </span>
            </button>

            <button
              onClick={() => setShowNewPrModal(true)}
              className="border border-[#ff5d22]/40 hover:bg-[#ff5d22]/10 text-[#ff5d22] text-[11px] uppercase font-bold tracking-wider py-1.5 px-4 rounded-xl cursor-pointer transition"
            >
              New PR
            </button>
            <button
              onClick={() => setShowCiModal(true)}
              className="border border-purple-500/40 hover:bg-purple-500/10 text-purple-400 text-[11px] uppercase font-bold tracking-wider py-1.5 px-4 rounded-xl cursor-pointer transition"
            >
              Run CI
            </button>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center gap-2 mt-4 border-b border-stone-850/80 pb-2">
          {(['code', 'commits', 'prs', 'ci', 'settings'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`py-1.5 px-4 rounded-lg text-xs font-semibold capitalize transition cursor-pointer ${
                activeTab === tab
                  ? 'bg-[#ff5d22]/15 text-[#ff7a45] border border-[#ff5d22]/30'
                  : 'text-stone-400 hover:text-white hover:bg-stone-900/40 border border-transparent'
              }`}
            >
              {tab === 'prs' ? `Pull Requests (${prs.length})` : tab === 'ci' ? `CI/CD (${ciRuns.length})` : tab}
            </button>
          ))}
        </div>
      </header>

      {/* Main Tab Content */}
      <section className="flex-1 max-w-7xl mx-auto w-full px-6 mt-6 z-10">
        
        {/* TAB 1: CODE */}
        {activeTab === 'code' && (
          <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
            {/* Left Column: Branch selector & File Tree */}
            <div className="md:col-span-4 bg-[#131110]/40 border border-stone-850 rounded-2xl flex flex-col overflow-hidden backdrop-blur-sm h-[600px]">
              <div className="p-3 border-b border-stone-850 flex items-center justify-between gap-2 bg-[#131110]/30">
                <div className="flex items-center gap-2 w-full">
                  <span className="text-[10px] uppercase font-bold tracking-wider text-stone-500">Branch:</span>
                  <select
                    value={selectedBranch}
                    onChange={(e) => setSelectedBranch(e.target.value)}
                    className="bg-[#0d0b0a] border border-stone-800 text-stone-300 text-xs rounded-lg py-1 px-2.5 outline-none font-mono focus:border-[#ff5d22] transition flex-1"
                  >
                    {branches.length === 0 ? (
                      <option value="main">main</option>
                    ) : (
                      branches.map((b) => (
                        <option key={b} value={b}>{b}</option>
                      ))
                    )}
                  </select>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-3 space-y-1">
                {isEmptyRepo ? (
                  <div className="text-center p-6 text-stone-500 italic text-xs space-y-2">
                    <p>Repository is empty</p>
                    <p className="text-[11px] font-mono text-stone-600">Push commits via Git CLI to populate files.</p>
                  </div>
                ) : files.length === 0 ? (
                  <p className="text-center p-4 text-stone-500 text-xs italic">No files on this branch</p>
                ) : (
                  files.map((file) => (
                    <button
                      key={file}
                      onClick={() => viewFile(file)}
                      className={`w-full text-left py-2 px-3 rounded-lg text-xs font-mono truncate transition border cursor-pointer ${
                        selectedFile === file
                          ? 'bg-[#ff5d22]/10 text-[#ff7a45] border-[#ff5d22]/30 font-semibold'
                          : 'bg-transparent text-stone-400 border-transparent hover:bg-stone-900/40 hover:text-white'
                      }`}
                    >
                      📄 {file}
                    </button>
                  ))
                )}
              </div>
            </div>

            {/* Right Column: Monaco Code Viewer */}
            <div className="md:col-span-8 bg-[#131110]/40 border border-stone-850 rounded-2xl flex flex-col overflow-hidden backdrop-blur-sm h-[600px]">
              {selectedFile ? (
                <div className="flex-1 flex flex-col overflow-hidden">
                  <div className="bg-[#131110]/30 border-b border-stone-850 px-4 py-2.5 text-xs font-mono text-stone-400 flex justify-between items-center">
                    <span>{selectedFile}</span>
                    <span className="text-stone-600 text-[10px]">ref: {selectedBranch}</span>
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
                  <div className="text-3xl text-stone-700 mb-2 font-light select-none">( &lt; / &gt; )</div>
                  <p className="text-xs tracking-wider">Select a file from the explorer to inspect source code</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 2: COMMITS */}
        {activeTab === 'commits' && (
          <div className="bg-[#131110]/40 border border-stone-850 rounded-2xl p-6 backdrop-blur-sm">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xs font-bold uppercase tracking-widest text-stone-400">
                Commit History on <span className="font-mono text-[#ff7a45]">{selectedBranch}</span>
              </h3>
              <span className="text-[10px] text-stone-500 font-mono">{commits.length} commits</span>
            </div>

            {loadingCommits ? (
              <p className="text-xs text-stone-500 italic p-4 text-center">Loading commits...</p>
            ) : commits.length === 0 ? (
              <p className="text-xs text-stone-500 italic p-4 text-center">No commits recorded on this branch</p>
            ) : (
              <div className="space-y-3 font-mono">
                {commits.map((c) => (
                  <div
                    key={c.hash}
                    className="p-3.5 rounded-xl border border-stone-850 bg-[#0d0b0a]/60 flex flex-col md:flex-row justify-between items-start md:items-center gap-2 hover:border-stone-750 transition"
                  >
                    <div className="space-y-1">
                      <p className="text-xs font-sans font-semibold text-stone-200">{c.message}</p>
                      <p className="text-[10px] text-stone-500">
                        {c.authorName} &lt;{c.authorEmail}&gt; • {new Date(c.date).toLocaleString()}
                      </p>
                    </div>
                    <span className="text-[11px] font-bold text-[#ff7a45] bg-[#ff5d22]/10 border border-[#ff5d22]/20 px-2.5 py-1 rounded-lg">
                      {c.shortHash}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* TAB 3: PULL REQUESTS */}
        {activeTab === 'prs' && (
          <div className="bg-[#131110]/40 border border-stone-850 rounded-2xl p-6 backdrop-blur-sm space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="text-xs font-bold uppercase tracking-widest text-stone-400">Pull Requests</h3>
              <button
                onClick={() => setShowNewPrModal(true)}
                className="bg-gradient-to-r from-[#e23b00] to-[#ff5d22] text-white text-xs font-bold py-1.5 px-4 rounded-xl cursor-pointer shadow-lg"
              >
                + New Pull Request
              </button>
            </div>

            {prs.length === 0 ? (
              <p className="text-xs text-stone-500 italic p-6 text-center">No pull requests opened yet</p>
            ) : (
              <div className="space-y-2">
                {prs.map((pr) => (
                  <div
                    key={pr.id}
                    onClick={() => viewPRDetails(pr)}
                    className="p-4 rounded-xl border border-stone-850 bg-[#0d0b0a]/50 hover:border-stone-750 cursor-pointer transition flex justify-between items-center gap-4"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-semibold text-white">{pr.title}</span>
                        <span className={`text-[9px] font-bold uppercase px-2.5 py-0.5 rounded-full ${
                          pr.status === 'merged'
                            ? 'text-purple-400 border border-purple-900/30 bg-purple-950/20'
                            : 'text-green-400 border border-green-900/30 bg-green-950/20'
                        }`}>
                          {pr.status}
                        </span>
                      </div>
                      <p className="text-[11px] font-mono text-stone-500">
                        #{pr.id} opened by @{pr.author_name} • {pr.source_branch} → {pr.target_branch}
                      </p>
                    </div>

                    <span className="text-xs text-stone-500 hover:text-white">Inspect &rarr;</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* TAB 4: CI/CD PIPELINES */}
        {activeTab === 'ci' && (
          <div className="bg-[#131110]/40 border border-stone-850 rounded-2xl p-6 backdrop-blur-sm space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="text-xs font-bold uppercase tracking-widest text-stone-400">CI/CD Pipeline Runs</h3>
              <button
                onClick={() => setShowCiModal(true)}
                className="border border-purple-500/40 hover:bg-purple-500/10 text-purple-400 text-xs font-bold py-1.5 px-4 rounded-xl cursor-pointer transition"
              >
                + Trigger Build
              </button>
            </div>

            {ciRuns.length === 0 ? (
              <p className="text-xs text-stone-500 italic p-6 text-center">No CI builds queued</p>
            ) : (
              <div className="space-y-2">
                {ciRuns.map((run) => (
                  <div
                    key={run.id}
                    onClick={() => setSelectedCIRun(run)}
                    className="p-4 rounded-xl border border-stone-850 bg-[#0d0b0a]/50 hover:border-stone-750 cursor-pointer transition flex justify-between items-center gap-4"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-3">
                        <span className="font-mono text-sm font-semibold text-white">Run #{run.id}</span>
                        <span className={`text-[9px] font-bold uppercase px-2.5 py-0.5 rounded-full border ${
                          run.status === 'success'
                            ? 'text-green-400 border-green-900/30 bg-green-950/20'
                            : run.status === 'failed'
                            ? 'text-red-400 border-red-900/30 bg-red-950/20'
                            : 'text-[#ff5d22] border-[#ff5d22]/30 bg-[#ff5d22]/5 animate-pulse'
                        }`}>
                          {run.status}
                        </span>
                      </div>
                      <p className="text-[11px] font-mono text-stone-500">
                        Commit: {run.commit_hash.slice(0, 10)} • Created: {new Date(run.created_at).toLocaleTimeString()}
                      </p>
                    </div>

                    <span className="text-xs text-stone-500 hover:text-white">View Console &rarr;</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* TAB 5: SETTINGS */}
        {activeTab === 'settings' && (
          <div className="bg-[#131110]/40 border border-stone-850 rounded-2xl p-6 backdrop-blur-sm space-y-6 max-w-2xl">
            <h3 className="text-xs font-bold uppercase tracking-widest text-stone-400 mb-2">Repository Settings</h3>

            {isOwner ? (
              <div className="space-y-6">
                <div className="p-4 rounded-xl border border-stone-850 bg-[#0d0b0a]/50 flex justify-between items-center gap-4">
                  <div>
                    <h4 className="text-sm font-semibold text-white">Visibility</h4>
                    <p className="text-xs text-stone-500">Currently: <span className="font-bold text-stone-300">{repo.is_private ? 'Private' : 'Public'}</span></p>
                  </div>
                  <button
                    onClick={toggleVisibility}
                    className="border border-stone-700 hover:border-stone-500 text-stone-300 text-xs font-semibold py-2 px-4 rounded-xl cursor-pointer transition"
                  >
                    Make {repo.is_private ? 'Public' : 'Private'}
                  </button>
                </div>

                <div className="p-4 rounded-xl border border-red-950/50 bg-red-950/10 flex justify-between items-center gap-4">
                  <div>
                    <h4 className="text-sm font-semibold text-red-400">Danger Zone</h4>
                    <p className="text-xs text-red-400/70">Permanently delete this repository and all of its pull requests, CI runs, and Git data.</p>
                  </div>
                  <button
                    onClick={deleteRepository}
                    className="bg-red-600 hover:bg-red-500 text-white text-xs font-bold py-2 px-4 rounded-xl cursor-pointer transition shadow-lg"
                  >
                    Delete Repository
                  </button>
                </div>
              </div>
            ) : (
              <p className="text-xs text-stone-500 italic">Only the repository owner can modify settings.</p>
            )}
          </div>
        )}

      </section>

      {/* OVERLAY MODAL: PR Details, Diffs & Discussion */}
      {selectedPR && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-6">
          <div className="bg-[#0f0e0d] border border-stone-850 p-6 rounded-2xl w-full max-w-5xl h-[85vh] flex flex-col overflow-hidden shadow-2xl">
            <div className="border-b border-stone-850 pb-4 mb-3 flex justify-between items-center shrink-0">
              <div>
                <div className="flex items-center gap-3">
                  <h3 className="text-base font-bold text-white">{selectedPR.title}</h3>
                  <span className={`text-[9px] font-bold uppercase px-2.5 py-0.5 rounded-full ${
                    selectedPR.status === 'merged'
                      ? 'text-purple-400 border border-purple-900/30 bg-purple-950/20'
                      : 'text-green-400 border border-green-900/30 bg-green-950/20'
                  }`}>
                    {selectedPR.status}
                  </span>
                </div>
                <p className="text-xs text-stone-500 mt-1 font-mono">
                  {selectedPR.source_branch} into {selectedPR.target_branch} • opened by @{selectedPR.author_name}
                </p>
              </div>

              <div className="flex items-center gap-2">
                {selectedPR.status === 'open' && isOwner && (
                  <button
                    onClick={() => mergePR(selectedPR.id)}
                    className="bg-gradient-to-r from-[#e23b00] to-[#ff5d22] hover:brightness-110 text-white font-bold text-xs uppercase tracking-wider py-2 px-5 rounded-xl cursor-pointer shadow-lg"
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

            {/* PR Modal Sub-Tabs */}
            <div className="flex items-center gap-3 border-b border-stone-850 pb-2 mb-3 shrink-0">
              <button
                onClick={() => setPrModalTab('diff')}
                className={`text-xs font-semibold px-3 py-1 rounded-lg transition cursor-pointer ${
                  prModalTab === 'diff'
                    ? 'bg-[#ff5d22]/15 text-[#ff7a45] border border-[#ff5d22]/30'
                    : 'text-stone-400 hover:text-white border border-transparent'
                }`}
              >
                File Changes (Diff)
              </button>
              <button
                onClick={() => setPrModalTab('discussion')}
                className={`text-xs font-semibold px-3 py-1 rounded-lg transition cursor-pointer ${
                  prModalTab === 'discussion'
                    ? 'bg-[#ff5d22]/15 text-[#ff7a45] border border-[#ff5d22]/30'
                    : 'text-stone-400 hover:text-white border border-transparent'
                }`}
              >
                Discussion ({prComments.length})
              </button>
            </div>

            {/* Sub-Tab 1: Diff View */}
            {prModalTab === 'diff' && (
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
                  <p className="text-xs text-stone-500 italic p-4 text-center">Calculating branch diffs...</p>
                )}
              </div>
            )}

            {/* Sub-Tab 2: Discussion & Code Review Comments */}
            {prModalTab === 'discussion' && (
              <div className="flex-1 flex flex-col overflow-hidden space-y-4">
                <div className="flex-1 overflow-y-auto space-y-3 p-1">
                  {loadingComments ? (
                    <p className="text-xs text-stone-500 italic p-4 text-center">Loading comments...</p>
                  ) : prComments.length === 0 ? (
                    <div className="p-8 text-center text-stone-500 text-xs italic border border-dashed border-stone-850 rounded-xl">
                      No review comments yet. Start the conversation below.
                    </div>
                  ) : (
                    prComments.map((comment) => (
                      <div
                        key={comment.id}
                        className="p-4 rounded-xl border border-stone-850 bg-[#0d0b0a]/70 space-y-1.5"
                      >
                        <div className="flex justify-between items-center text-xs">
                          <span className="font-semibold text-[#ff7a45]">@{comment.author_name}</span>
                          <span className="text-[10px] text-stone-500 font-mono">
                            {new Date(comment.created_at).toLocaleString()}
                          </span>
                        </div>
                        <p className="text-xs text-stone-300 whitespace-pre-wrap leading-relaxed">
                          {comment.body}
                        </p>
                      </div>
                    ))
                  )}
                </div>

                {/* Add Comment Box */}
                <form
                  onSubmit={(e) => addPRComment(e, selectedPR.id)}
                  className="p-3 bg-[#0d0b0a] border border-stone-850 rounded-xl flex gap-3 items-end shrink-0"
                >
                  <textarea
                    rows={2}
                    value={newCommentBody}
                    onChange={(e) => setNewCommentBody(e.target.value)}
                    placeholder="Leave a review comment or ask a question..."
                    className="flex-1 bg-transparent text-xs text-stone-200 placeholder-stone-600 outline-none resize-none font-sans"
                    required
                  />
                  <button
                    type="submit"
                    className="bg-gradient-to-r from-[#e23b00] to-[#ff5d22] text-white text-xs font-bold py-2 px-4 rounded-lg cursor-pointer shadow-lg transition hover:brightness-110 shrink-0"
                  >
                    Comment
                  </button>
                </form>
              </div>
            )}
          </div>
        </div>
      )}

      {/* OVERLAY MODAL: CI Logs Terminal View with Live SSE */}
      {selectedCIRun && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-6">
          <div className="bg-[#0f0e0d] border border-stone-850 p-6 rounded-2xl w-full max-w-4xl h-[85vh] flex flex-col overflow-hidden shadow-2xl">
            <div className="border-b border-stone-850 pb-4 mb-4 flex justify-between items-center shrink-0">
              <div className="space-y-0.5">
                <div className="flex items-center gap-3">
                  <h3 className="text-base font-bold text-white">CI Run #{selectedCIRun.id}</h3>
                  {(selectedCIRun.status === 'running' || selectedCIRun.status === 'pending') && (
                    <span className="text-[10px] text-[#ff7a45] flex items-center gap-1.5 font-mono">
                      <span className="w-2 h-2 rounded-full bg-[#ff5d22] animate-ping"></span>
                      Live Streaming Active (SSE)
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-stone-500 font-mono">Commit: {selectedCIRun.commit_hash}</p>
              </div>
              <div className="flex items-center gap-3">
                <span className={`text-[9px] font-bold uppercase py-1 px-3 rounded-full border ${
                  selectedCIRun.status === 'success'
                    ? 'text-green-400 border-green-900/30 bg-green-950/20'
                    : selectedCIRun.status === 'failed'
                    ? 'text-red-400 border-red-900/30 bg-red-950/20'
                    : 'text-[#ff5d22] border-[#ff5d22]/30 bg-[#ff5d22]/5 animate-pulse'
                }`}>
                  {selectedCIRun.status}
                </span>
                <button
                  onClick={() => setSelectedCIRun(null)}
                  className="bg-[#1c1a19] hover:bg-[#282625] text-stone-400 hover:text-white py-1.5 px-4 rounded-xl text-xs cursor-pointer border border-stone-800"
                >
                  Close
                </button>
              </div>
            </div>

            <div className="flex-1 bg-[#050404] border border-stone-900 p-5 rounded-xl overflow-y-auto select-text font-mono text-xs text-stone-300 whitespace-pre-wrap leading-relaxed">
              {selectedCIRun.log || '[CI Sandbox] Initializing job, waiting for live stream output...'}
            </div>
          </div>
        </div>
      )}

      {/* MODAL: New PR */}
      {showNewPrModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#0f0e0d] border border-stone-850 p-6 rounded-2xl w-full max-w-md shadow-2xl space-y-4">
            <h3 className="text-xs font-bold uppercase tracking-widest text-stone-400">( Open Pull Request )</h3>
            <form onSubmit={createPR} className="space-y-4">
              <div>
                <label className="block text-3xs font-bold uppercase tracking-wider text-stone-500 mb-1">PR Title</label>
                <input
                  type="text"
                  value={newPrTitle}
                  onChange={(e) => setNewPrTitle(e.target.value)}
                  className="w-full bg-[#0d0b0a] border border-stone-850 focus:border-[#ff5d22] rounded-lg py-2 px-3 text-xs text-slate-200 outline-none"
                  placeholder="feat: improve indexing"
                  required
                />
              </div>
              <div>
                <label className="block text-3xs font-bold uppercase tracking-wider text-stone-500 mb-1">Source Branch (Compare)</label>
                <input
                  type="text"
                  value={newPrSource}
                  onChange={(e) => setNewPrSource(e.target.value)}
                  className="w-full bg-[#0d0b0a] border border-stone-850 focus:border-[#ff5d22] rounded-lg py-2 px-3 text-xs text-slate-200 outline-none font-mono"
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
                  className="w-full bg-[#0d0b0a] border border-stone-850 focus:border-[#ff5d22] rounded-lg py-2 px-3 text-xs text-slate-200 outline-none font-mono"
                  placeholder="main"
                  required
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowNewPrModal(false)}
                  className="bg-[#1c1a19] text-stone-300 text-xs font-semibold py-2 px-4 rounded-lg cursor-pointer border border-stone-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="bg-gradient-to-r from-[#e23b00] to-[#ff5d22] text-white text-xs font-bold py-2 px-4 rounded-lg cursor-pointer shadow-lg"
                >
                  Open PR
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: Run CI */}
      {showCiModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#0f0e0d] border border-stone-850 p-6 rounded-2xl w-full max-w-sm shadow-2xl space-y-4">
            <h3 className="text-xs font-bold uppercase tracking-widest text-stone-400">( Run CI/CD Build )</h3>
            <form onSubmit={triggerCI} className="space-y-4">
              <div>
                <label className="block text-3xs font-bold uppercase tracking-wider text-stone-500 mb-1">Branch, Tag, or Commit SHA</label>
                <input
                  type="text"
                  value={newCiRef}
                  onChange={(e) => setNewCiRef(e.target.value)}
                  className="w-full bg-[#0d0b0a] border border-stone-850 focus:border-[#ff5d22] rounded-lg py-2 px-3 text-xs text-slate-200 outline-none font-mono"
                  placeholder="main"
                  required
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCiModal(false)}
                  className="bg-[#1c1a19] text-stone-300 text-xs font-semibold py-2 px-4 rounded-lg cursor-pointer border border-stone-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="bg-gradient-to-r from-[#e23b00] to-[#ff5d22] text-white text-xs font-bold py-2 px-4 rounded-lg cursor-pointer shadow-lg"
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
