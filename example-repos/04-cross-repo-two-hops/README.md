# 04 — cross repo, two hops

Chain: `hash-lib` (source) → `hash-middleware` (wraps it) → `consumer`
(sink). Both intermediate hops are `file:`-linked packages.

- **Source**: [hash-lib/src/index.ts](hash-lib/src/index.ts) line ~4 — `createHash('sha1')`
- **Hop**: [hash-middleware/src/index.ts](hash-middleware/src/index.ts) line ~4 — passes digest through
- **Sink**: [consumer/src/index.ts](consumer/src/index.ts) line ~7 — `res.json(...)`

## Setup

```bash
cd hash-middleware && npm install
cd ../consumer && npm install
```

## Pass criterion

Joern traces SHA-1 → `hash-lib.sha1` → `hash-middleware.signRequest` →
`consumer` handler → `res.json`. Terminal classified as
`express-res-body`.

## Fail signals

- Flow only reaches `hash-middleware` and stops → tracer doesn't chain
  through two package boundaries.
- Flow reappears in `consumer` but is not connected to the original
  source → interprocedural summary is being reset per package.
