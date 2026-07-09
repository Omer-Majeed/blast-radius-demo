// HTTP pattern module — detects:
//   - Express-style server route registrations
//       router.<method>("path", ...)
//       app.<method>("path", ...)
//   - Client-side HTTP calls
//       fetch("url" | `url`, [{ method: "..." }])
//       axios.<method>("url", ...)
//       axios("url", { method: "..." })
//
// Emits normalized signals so route and call signals can join on:
//     key = "METHOD /normalized/path"
//
// Regex-first. Known limitations documented at bottom of file — trade
// them for AST parsing (ts-morph / tree-sitter) if precision matters.

import type { SignalKind } from '../../../types.js';
import type { GrepPatternModule } from '../scan.js';

// ─── Regexes ──────────────────────────────────────────────────────────

// router.get("path"…)  |  app.post('path'…)  |  expressApp.put(`path`…)
const ROUTE_RE =
  /\b(?:router|app|expressApp|server)\.(?<method>get|post|put|delete|patch|options|head)\s*\(\s*[`'"](?<path>[^`'"]+)[`'"]/gi;

// fetch("url" | `url`, { …method: "POST"… })
const FETCH_RE =
  /\bfetch\s*\(\s*[`'"](?<url>[^`'"]+)[`'"](?:\s*,\s*\{[^}]*\bmethod\s*:\s*[`'"](?<method>[A-Za-z]+)[`'"])?/g;

// axios.<method>("url", …)
const AXIOS_METHOD_RE =
  /\baxios\.(?<method>get|post|put|delete|patch|head|options)\s*\(\s*[`'"](?<url>[^`'"]+)[`'"]/gi;

// axios("url", { method: "..." })   (generic form)
const AXIOS_GENERIC_RE =
  /\baxios\s*\(\s*[`'"](?<url>[^`'"]+)[`'"](?:\s*,\s*\{[^}]*\bmethod\s*:\s*[`'"](?<method>[A-Za-z]+)[`'"])?/g;

// ─── Normalizers ──────────────────────────────────────────────────────

function normalizeMethod(m: string | undefined): string {
  return (m ?? 'GET').toUpperCase();
}

/**
 * Normalize a URL or Express path pattern into a shape that server
 * routes and client calls can join on.
 *
 * Rules:
 *   protocol://host/…      →  strip protocol + host
 *   ?query / #hash         →  drop
 *   leading ${...}         →  drop if followed by `/` (base-URL var)
 *   remaining ${...}       →  `*`
 *   :param                 →  `*`
 *   trailing /             →  drop
 *   ensure leading /
 */
function normalizePath(raw: string): string {
  let p = raw;
  p = p.replace(/^[a-z]+:\/\/[^/]+/i, '');
  p = p.replace(/[?#].*$/, '');
  p = p.replace(/^\$\{[^}]+\}(?=\/)/, '');
  p = p.replace(/\$\{[^}]+\}/g, '*');
  p = p.replace(/:[A-Za-z_][A-Za-z0-9_]*/g, '*');
  p = p.replace(/\/+$/, '');
  if (!p.startsWith('/')) p = '/' + p;
  return p || '/';
}

function lineNumberOf(content: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset; i++) {
    if (content.charCodeAt(i) === 10 /* \n */) line++;
  }
  return line;
}

function keyOf(method: string, path: string): string {
  return `${method} ${path}`;
}

// ─── Module ───────────────────────────────────────────────────────────

interface Emit {
  kind: SignalKind;
  key: string;
  line: number;
  extra?: Record<string, unknown>;
}

function emit(
  content: string,
  regex: RegExp,
  kind: SignalKind,
  extraLabel: 'route' | 'call',
): Emit[] {
  const out: Emit[] = [];
  for (const m of content.matchAll(regex)) {
    const method = normalizeMethod(m.groups?.method);
    const rawPath = m.groups?.path ?? m.groups?.url ?? '';
    const normPath = normalizePath(rawPath);
    out.push({
      kind,
      key: keyOf(method, normPath),
      line: lineNumberOf(content, m.index ?? 0),
      extra: {
        method,
        path_raw: rawPath,
        path_normalized: normPath,
        match_kind: extraLabel,
        snippet: m[0].slice(0, 200),
      },
    });
  }
  return out;
}

export const httpPattern: GrepPatternModule = {
  id: 'http',
  fileExts: ['.ts', '.tsx', '.js', '.mjs', '.cjs'],
  scanFile(content, _relPath) {
    const results: Emit[] = [];
    results.push(...emit(content, ROUTE_RE, 'http_route', 'route'));
    results.push(...emit(content, FETCH_RE, 'http_call', 'call'));
    results.push(...emit(content, AXIOS_METHOD_RE, 'http_call', 'call'));
    results.push(...emit(content, AXIOS_GENERIC_RE, 'http_call', 'call'));
    return results;
  },
};

// ─── Known regex-first limitations (deferred) ─────────────────────────
//
//   - URL built by string concatenation (`baseUrl + "/x"`) — not captured.
//   - URL loaded from a config file / env var — not captured.
//   - Frameworks other than Express (NestJS `@Get`, Fastify, Koa).
//   - HTTP clients other than fetch/axios (got, http.request, node-fetch).
//   - Method for `fetch(url)` with no explicit options defaults to GET.
//   - Chained middleware like `router.use('/api', router)` — the prefix
//     isn't threaded into nested route paths.
//
// If any of these come up in real fleet analysis, upgrade this module
// to an AST walker (ts-morph or tree-sitter). Scan/merger interfaces
// don't change.
