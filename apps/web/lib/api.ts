import axios from 'axios';

export const API_BASE = (process.env.NEXT_PUBLIC_API_URL ? process.env.NEXT_PUBLIC_API_URL.replace(/\/$/, '') : 'http://localhost:8080') + '/api';
export const GATEWAY_BASE = (process.env.NEXT_PUBLIC_GATEWAY_URL ? process.env.NEXT_PUBLIC_GATEWAY_URL.replace(/\/$/, '') : 'http://localhost:8081');

export interface Repository {
  id: number;
  name: string;
  is_private: boolean;
  owner_id: number;
  owner_name: string;
  created_at: string;
}

export interface CommitInfo {
  hash: string;
  shortHash: string;
  authorName: string;
  authorEmail: string;
  date: string;
  message: string;
}

export interface PullRequest {
  id: number;
  repo_id: number;
  author_id: number;
  title: string;
  status: string;
  source_branch: string;
  target_branch: string;
  author_name: string;
  created_at: string;
  updated_at: string;
}

export interface PRComment {
  id: number;
  pr_id: number;
  author_id: number;
  author_name: string;
  body: string;
  created_at: string;
}

export interface CIRun {
  id: number;
  repo_id: number;
  commit_hash: string;
  status: string;
  log: string;
  created_at: string;
  finished_at: string | null;
}

export interface User {
  id: number;
  username: string;
  email: string;
}

export function getAuthHeaders(token: string | null) {
  return {
    headers: {
      Authorization: `Bearer ${token}`
    }
  };
}
