import type {
  Finding, FlowResult, Repo, Rulepack, Scan, ScanRepo, SinkDescriptor,
} from './types';

const base = '/api';

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(base + path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try { const j = await res.json(); if (j.error) msg = j.error; } catch {}
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

export const api = {
  // repos
  listRepos: () => req<{ repos: Repo[] }>('/repos'),
  createRepo: (name: string, path: string) =>
    req<{ repo: Repo }>('/repos', { method: 'POST', body: JSON.stringify({ name, path }) }),
  deleteRepo: (id: string) => req<{ ok: boolean }>(`/repos/${id}`, { method: 'DELETE' }),

  // scans
  listScans: () => req<{ scans: Scan[] }>('/scans'),
  createScan: (repoIds: string[], rulepackIds: string[]) =>
    req<{ scan: Scan }>('/scans', {
      method: 'POST',
      body: JSON.stringify({ repo_ids: repoIds, rulepack_ids: rulepackIds }),
    }),
  getScan: (id: string) =>
    req<{ scan: Scan; repos: ScanRepo[]; findings: Finding[] }>(`/scans/${id}`),

  // findings + flow
  getFlow: (findingId: string) =>
    req<{ finding: Finding; flow: FlowResult | null }>(`/findings/${findingId}/flow`),

  // catalog
  listRulepacks: () => req<{ rulepacks: Rulepack[] }>('/rulepacks'),
  listSinks: () => req<{ sinks: SinkDescriptor[] }>('/sinks'),
};
