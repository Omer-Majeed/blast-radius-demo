# 01 — same file, cross function

Baseline sanity check. `computeSig` produces an MD5 digest; a different
function (`handler`) in the same file passes it to `res.json`.

- **Source**: [repo/src/index.ts](repo/src/index.ts) line ~7 — `createHash('md5')`
- **Sink**: [repo/src/index.ts](repo/src/index.ts) line ~13 — `res.json(...)`

## Pass criterion

Opengrep emits one finding for the MD5 source. Joern's `reachableByFlows`
returns at least one path terminating at `res.json`, and the sink
classifier tags it `express-res-body` (http-out).

## Fail signals

- Zero flow paths → Joern is not stepping through the local function call.
- Terminal call is not `res.json` → sink classifier miswired.
