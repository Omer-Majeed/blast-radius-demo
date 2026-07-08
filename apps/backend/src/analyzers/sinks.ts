import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import yaml from 'js-yaml';
import { SINKS_DIR } from '../config.js';
import type { SinkDescriptor } from '../types.js';

interface CompiledSink extends SinkDescriptor {
  callNameRe: RegExp;
  receiverRe?: RegExp;
}

let _cache: CompiledSink[] | null = null;

export function loadSinks(): CompiledSink[] {
  if (_cache) return _cache;
  const sinks: CompiledSink[] = [];
  for (const entry of walkYaml(SINKS_DIR)) {
    const doc = yaml.load(readFileSync(entry, 'utf8')) as { sinks?: SinkDescriptor[] } | null;
    if (!doc?.sinks) continue;
    for (const s of doc.sinks) {
      sinks.push({
        ...s,
        callNameRe: new RegExp(s.call_name_regex),
        receiverRe: s.receiver_regex ? new RegExp(s.receiver_regex) : undefined,
      });
    }
  }
  _cache = sinks;
  return sinks;
}

/**
 * Classify a call node against sink descriptors.
 * Returns the first matching sink, or null.
 *
 * @param callName the Call node's `name` property
 * @param receiverCode source of the receiver expression, if any
 * @param argsCode joined source of all arguments (or one blob)
 */
export function classifySink(
  callName: string,
  receiverCode?: string,
  argsCode?: string,
): SinkDescriptor | null {
  for (const s of loadSinks()) {
    if (!s.callNameRe.test(callName)) continue;
    if (s.receiverRe && (!receiverCode || !s.receiverRe.test(receiverCode))) continue;
    if (s.argument_contains && (!argsCode || !argsCode.includes(s.argument_contains))) continue;
    return s;
  }
  return null;
}

export function listSinks(): SinkDescriptor[] {
  return loadSinks().map(({ callNameRe: _c, receiverRe: _r, ...rest }) => rest);
}

function walkYaml(dir: string): string[] {
  const out: string[] = [];
  let entries: string[] = [];
  try { entries = readdirSync(dir); } catch { return out; }
  for (const name of entries) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walkYaml(full));
    else if (extname(name) === '.yaml' || extname(name) === '.yml') out.push(full);
  }
  return out;
}
