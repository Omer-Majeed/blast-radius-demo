# 03 — cross repo, source in lib, sink in consumer

Weak crypto lives in the `hash-lib` "repo" (a `file:`-linked package).
The `consumer` repo imports `computeSig` from it and returns the digest
via Express.

- **Source**: [hash-lib/src/index.ts](hash-lib/src/index.ts) line ~4 — `createHash('sha1')`
- **Sink**: [consumer/src/index.ts](consumer/src/index.ts) line ~7 — `res.json(...)`

## Setup

```bash
cd consumer && npm install
```

Creates `consumer/node_modules/@demo/hash-lib` → `../hash-lib` symlink.

## Pass criterion

When opengrep + Joern run against `consumer/`, the flow analyzer resolves
the symlinked `@demo/hash-lib`, sees the SHA-1 source, and returns a
path terminating at `res.json`.

## Fail signals

- Opengrep does not find the source → symlink not resolved during scan.
- Joern flow stops at the package boundary → cross-package call is not
  being inlined by `reachableByFlows`.
