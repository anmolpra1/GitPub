'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import axios from 'axios';
import { API_BASE, User, getAuthHeaders } from '../lib/api';

interface NavbarProps {
  currentUser: User | null;
  token: string | null;
  onLogout: () => void;
  repoBreadcrumb?: { owner: string; name: string };
}

export default function Navbar({ currentUser, token, onLogout, repoBreadcrumb }: NavbarProps) {
  const [generatedPat, setGeneratedPat] = useState<string | null>(null);
  const [copied, setCopied] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleGeneratePAT = async () => {
    setErrorMsg(null);
    try {
      const res = await axios.post(`${API_BASE}/auth/pat`, {}, getAuthHeaders(token));
      setGeneratedPat(res.data.pat);
    } catch (err: any) {
      setErrorMsg(err.response?.data?.error || 'Failed to generate PAT');
    }
  };

  return (
    <>
      <nav className="bg-[#131110]/40 border-b border-stone-900/80 px-6 py-3.5 flex justify-between items-center z-20 shrink-0 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <Link href="/" className="flex items-center gap-2 hover:opacity-90 transition">
            <span className="text-lg font-light tracking-wide text-white">
              ( <span className="font-extrabold bg-clip-text text-transparent bg-gradient-to-r from-[#ff5d22] to-[#ff7a45]">GitPub</span> )
            </span>
            <span className="text-[9px] font-bold tracking-widest text-[#ff5d22] bg-[#ff5d22]/5 border border-[#ff5d22]/20 py-0.5 px-2 rounded-full hidden sm:inline-block">
              PROGRA ENGINE
            </span>
          </Link>

          {repoBreadcrumb && (
            <div className="flex items-center gap-2 text-xs font-mono text-stone-400 pl-3 border-l border-stone-850">
              <Link href="/" className="hover:text-stone-200">repos</Link>
              <span className="text-stone-600">/</span>
              <span className="text-[#ff7a45] font-semibold">{repoBreadcrumb.owner}</span>
              <span className="text-stone-600">/</span>
              <span className="text-white font-bold">{repoBreadcrumb.name}</span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-3 sm:gap-4">
          <button
            onClick={handleGeneratePAT}
            className="border border-[#ff5d22]/40 hover:bg-[#ff5d22]/10 text-[#ff5d22] text-[10px] font-bold uppercase tracking-widest py-1.5 px-3.5 rounded-full transition cursor-pointer"
          >
            Generate PAT
          </button>
          <div className="flex items-center gap-3">
            <span className="text-xs font-semibold text-stone-400 hidden sm:inline">@{currentUser?.username}</span>
            <button
              onClick={onLogout}
              className="text-stone-500 hover:text-[#ff5d22] text-xs font-semibold cursor-pointer transition"
            >
              Exit
            </button>
          </div>
        </div>
      </nav>

      {/* PAT Modal */}
      {generatedPat && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#0f0e0d] border border-stone-850 p-6 rounded-2xl w-full max-w-lg shadow-2xl space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="text-xs font-bold uppercase tracking-widest text-[#ff5d22]">( Personal Access Token )</h3>
              <button
                onClick={() => { setGeneratedPat(null); setCopied(false); }}
                className="text-stone-500 hover:text-white text-sm"
              >
                ✕
              </button>
            </div>
            <p className="text-xs text-stone-400">
              Use this Personal Access Token (PAT) as your password for Git CLI authentication (`git clone`, `git push`).
              <span className="text-amber-400 block mt-1 font-semibold">Copy it now — it is hashed with SHA-256 and will never be shown again!</span>
            </p>
            <div className="bg-[#050404] p-3 rounded-xl border border-stone-850 font-mono text-xs text-[#ff7a45] break-all select-all flex items-center justify-between gap-3">
              <span>{generatedPat}</span>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(generatedPat);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
                className="bg-[#1c1a19] hover:bg-[#282625] text-stone-300 hover:text-white px-3 py-1.5 rounded-lg text-2xs uppercase tracking-wider font-sans font-bold shrink-0 transition"
              >
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
            <div className="flex justify-end pt-2">
              <button
                onClick={() => { setGeneratedPat(null); setCopied(false); }}
                className="bg-gradient-to-r from-[#e23b00] to-[#ff5d22] text-white text-xs font-bold py-2 px-5 rounded-xl cursor-pointer"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {errorMsg && (
        <div className="fixed bottom-4 right-4 z-50 bg-[#131110] border border-red-900/40 text-red-400 text-xs py-2.5 px-4 rounded-xl shadow-2xl flex items-center gap-3">
          <span>❌ {errorMsg}</span>
          <button onClick={() => setErrorMsg(null)} className="hover:text-red-200 font-bold text-sm cursor-pointer">✕</button>
        </div>
      )}
    </>
  );
}
