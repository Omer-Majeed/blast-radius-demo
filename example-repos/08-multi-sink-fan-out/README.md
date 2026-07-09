# 08 — multi-sink fan-out

One `computeSig` function; two Express routes call it and each terminates
at a different sink (`res.json` and `res.send`). Joern should return
**two** flow paths from the same MD5 source, one per sink.

- **Source**: [repo/src/index.ts](repo/src/index.ts) line ~7 — `createHash('md5')`
- **Sink 1**: [repo/src/index.ts](repo/src/index.ts) line ~11 — `res.json(...)`
- **Sink 2**: [repo/src/index.ts](repo/src/index.ts) line ~15 — `res.send(...)`

## Pass criterion

Opengrep reports one MD5 finding. Joern reports at least two distinct
paths from that finding — one terminating at `json`, one at `send`.
Both classify as `express-res-body`.

## Fail signals

- Only one path returned → tracer deduplicates paths by source rather
  than by (source, sink) pair.
- Both paths report the same sink call → path enumeration is losing
  branches.
