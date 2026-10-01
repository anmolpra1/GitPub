'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import axios from 'axios';
import Script from 'next/script';
import Navbar from '../components/Navbar';
import { API_BASE, GATEWAY_BASE, Repository, User, getAuthHeaders } from '../lib/api';

export default function Home() {
  // Auth state
  const [token, setToken] = useState<string | null>(null);
  const [username, setUsername] = useState<string>('');
  const [email, setEmail] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [isRegister, setIsRegister] = useState<boolean>(false);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [googleInitialized, setGoogleInitialized] = useState<boolean>(false);

  // App state
  const [repos, setRepos] = useState<Repository[]>([]);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [showNewRepoModal, setShowNewRepoModal] = useState<boolean>(false);
  const [newRepoName, setNewRepoName] = useState<string>('');
  const [newRepoPrivate, setNewRepoPrivate] = useState<boolean>(false);

  // Notifications
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  useEffect(() => {
    const savedToken = localStorage.getItem('token');
    const savedUser = localStorage.getItem('user');
    if (savedToken && savedUser) {
      setToken(savedToken);
      try {
        setCurrentUser(JSON.parse(savedUser));
      } catch {}
    }
  }, []);

  // Google OAuth setup
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
        win.google.accounts.id.renderButton(container, { theme: 'outline', size: 'large', width: 384 });
      }
    }
  }, [googleInitialized, token, isRegister]);

  // Fetch repos on login
  useEffect(() => {
    if (token) {
      fetchRepos();
    }
  }, [token]);

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
  };

  const fetchRepos = async () => {
    try {
      const res = await axios.get(`${API_BASE}/repos`, getAuthHeaders(token));
      setRepos(res.data.repositories || []);
    } catch (err: any) {
      if (err.response?.status === 401 || err.response?.status === 403) {
        handleLogout();
      }
    }
  };

  const createRepo = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    try {
      const res = await axios.post(
        `${API_BASE}/repos`,
        { name: newRepoName, is_private: newRepoPrivate },
        getAuthHeaders(token)
      );
      setSuccessMsg(res.data.message);
      fetchRepos();
      setShowNewRepoModal(false);
      setNewRepoName('');
      setNewRepoPrivate(false);
    } catch (err: any) {
      setErrorMsg(err.response?.data?.error || 'Failed to create repository');
    }
  };

  const filteredRepos = repos.filter(
    (r) =>
      r.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      r.owner_name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Unauthenticated View
  if (!token) {
    return (
      <main className="min-h-screen bg-[#0d0b0a] text-slate-100 flex items-center justify-center p-4 relative overflow-hidden font-sans select-none">
        <Script src="https://accounts.google.com/gsi/client" onLoad={initGoogle} strategy="afterInteractive" />
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[350px] bg-gradient-to-b from-[#ff5d22]/10 to-transparent rounded-full blur-[120px] pointer-events-none"></div>

        <div className="w-full max-w-md bg-[#131110]/60 backdrop-blur-xl border border-stone-850 p-8 rounded-2xl shadow-2xl relative z-10">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-light tracking-wide text-white">
              ( <span className="font-extrabold bg-clip-text text-transparent bg-gradient-to-r from-[#ff5d22] to-[#ff7a45]">GitPub</span> )
            </h1>
            <p className="text-stone-400 text-xs mt-3 tracking-wider font-mono">SELF-HOSTED GIT & CI SANDBOX</p>
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
                New developer?{' '}
                <button onClick={() => { setIsRegister(true); setErrorMsg(null); }} className="text-[#ff5d22] hover:text-[#ff7a45] font-semibold cursor-pointer">
                  Create Account
                </button>
              </p>
            )}
          </div>
        </div>
      </main>
    );
  }

  // Authenticated Dashboard View
  return (
    <main className="min-h-screen bg-[#0d0b0a] text-stone-300 flex flex-col font-sans relative overflow-x-hidden pb-12">
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[1100px] h-[320px] bg-gradient-to-b from-[#ff5d22]/5 to-transparent rounded-full blur-[140px] pointer-events-none z-0"></div>

      <Navbar currentUser={currentUser} token={token} onLogout={handleLogout} />

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

      <div className="max-w-7xl mx-auto w-full px-6 pt-8 z-10 space-y-8">
        {/* Welcome Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-2xl font-light text-white tracking-wide">
              Welcome back, <span className="font-extrabold text-[#ff7a45]">@{currentUser?.username}</span>
            </h1>
            <p className="text-xs text-stone-500 mt-1">Select a repository to explore code, branches, PRs, and CI runs.</p>
          </div>
          <button
            onClick={() => setShowNewRepoModal(true)}
            className="bg-gradient-to-r from-[#e23b00] to-[#ff5d22] hover:brightness-110 text-white font-bold text-xs uppercase tracking-wider py-2.5 px-5 rounded-xl cursor-pointer shadow-lg shadow-[#ff5d22]/10 transition"
          >
            + New Repository
          </button>
        </div>

        {/* Bento Grid: Main Dashboard */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
          {/* Bento Box 1: Repositories (8 cols) */}
          <div className="md:col-span-8 bg-[#131110]/40 border border-stone-850 rounded-2xl p-6 backdrop-blur-sm space-y-4">
            <div className="flex justify-between items-center gap-4 flex-wrap">
              <h2 className="text-xs font-bold uppercase tracking-widest text-stone-400">Repositories ({repos.length})</h2>
              <input
                type="text"
                placeholder="Filter repositories..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="bg-[#0d0b0a] border border-stone-800 text-stone-300 text-xs rounded-xl py-1.5 px-3.5 outline-none focus:border-[#ff5d22] transition w-full sm:w-60 font-mono"
              />
            </div>

            {filteredRepos.length === 0 ? (
              <div className="text-center p-8 border border-dashed border-stone-850 rounded-xl space-y-3">
                <p className="text-xs text-stone-500 italic">No repositories found</p>
                <button
                  onClick={() => setShowNewRepoModal(true)}
                  className="border border-[#ff5d22]/40 text-[#ff5d22] hover:bg-[#ff5d22]/10 text-xs font-bold py-1.5 px-4 rounded-xl cursor-pointer transition"
                >
                  Create your first repository
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {filteredRepos.map((r) => (
                  <Link
                    key={r.id}
                    href={`/${r.owner_name}/${r.name}`}
                    className="p-4 rounded-xl border border-stone-850 bg-[#0d0b0a]/50 hover:border-stone-750 hover:bg-[#0d0b0a]/80 transition group block space-y-2"
                  >
                    <div className="flex justify-between items-start">
                      <div className="space-y-0.5 truncate pr-2">
                        <h3 className="text-sm font-semibold text-white group-hover:text-[#ff7a45] transition truncate">
                          {r.owner_name} / {r.name}
                        </h3>
                        {r.forked_from && (
                          <p className="text-[10px] text-stone-500 font-mono truncate">
                            forked from {r.forked_from.owner}/{r.forked_from.name}
                          </p>
                        )}
                      </div>
                      <span className="text-[9px] uppercase tracking-widest px-2 py-0.5 rounded-full border border-stone-800 bg-[#0d0b0a] text-stone-400 shrink-0">
                        {r.is_private ? 'Private' : 'Public'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-[10px] text-stone-500 font-mono pt-1">
                      <span>{new Date(r.created_at).toLocaleDateString()}</span>
                      <div className="flex items-center gap-3">
                        <span className="flex items-center gap-1">
                          <span className={r.is_starred ? 'text-amber-400' : 'text-stone-600'}>★</span>
                          <span>{r.stars_count || 0}</span>
                        </span>
                        <span className="flex items-center gap-1">
                          <span className="text-stone-600">⑂</span>
                          <span>{r.forks_count || 0}</span>
                        </span>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>

          {/* Bento Box 2: Quick Start CLI Guide (4 cols) */}
          <div className="md:col-span-4 bg-[#131110]/40 border border-stone-850 rounded-2xl p-6 backdrop-blur-sm space-y-4">
            <h2 className="text-xs font-bold uppercase tracking-widest text-[#ff5d22]">Git CLI Quick Start</h2>
            
            <div className="space-y-3 text-xs">
              <div className="space-y-1">
                <p className="text-stone-400 font-semibold text-[11px]">1. Store Credentials</p>
                <p className="bg-[#050404] p-2.5 rounded-xl border border-stone-900 font-mono text-[10px] text-stone-300 select-all">
                  git config --global credential.helper store
                </p>
              </div>

              <div className="space-y-1">
                <p className="text-stone-400 font-semibold text-[11px]">2. Clone Any Repository</p>
                <p className="bg-[#050404] p-2.5 rounded-xl border border-stone-900 font-mono text-[10px] text-stone-300 select-all">
                  git clone {GATEWAY_BASE}/&lt;owner&gt;/&lt;repo&gt;.git
                </p>
              </div>

              <div className="space-y-1">
                <p className="text-stone-400 font-semibold text-[11px]">3. Authenticate with PAT</p>
                <p className="text-[10px] text-stone-500 leading-relaxed">
                  When prompted by git for password, paste your <span className="text-[#ff7a45] font-semibold">Personal Access Token</span>.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Modal: New Repository */}
      {showNewRepoModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#0f0e0d] border border-stone-850 p-6 rounded-2xl w-full max-w-sm shadow-2xl space-y-4">
            <h3 className="text-xs font-bold uppercase tracking-widest text-stone-400">( Create Repository )</h3>
            <form onSubmit={createRepo} className="space-y-4">
              <div>
                <label className="block text-3xs font-bold uppercase tracking-wider text-stone-500 mb-1">Repository Name</label>
                <input
                  type="text"
                  value={newRepoName}
                  onChange={(e) => setNewRepoName(e.target.value)}
                  className="w-full bg-[#0d0b0a] border border-stone-850 focus:border-[#ff5d22] rounded-lg py-2 px-3 text-xs text-slate-200 outline-none"
                  placeholder="awesome-microservice"
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
                <label htmlFor="is_private" className="text-xs text-stone-400 cursor-pointer">Private Repository</label>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowNewRepoModal(false)}
                  className="bg-[#1c1a19] text-stone-300 text-xs font-semibold py-2 px-4 rounded-lg cursor-pointer border border-stone-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="bg-gradient-to-r from-[#e23b00] to-[#ff5d22] text-white text-xs font-bold py-2 px-4 rounded-lg cursor-pointer shadow-lg"
                >
                  Create
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}
