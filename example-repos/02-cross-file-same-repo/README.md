# 02 — cross file, same repo

Weak crypto lives in `hashing.ts`; the Express handler in `routes.ts`
imports the helper and returns the digest.

- **Source**: [repo/src/hashing.ts](repo/src/hashing.ts) line ~4 — `createHash('md5')`
- **Sink**: [repo/src/routes.ts](repo/src/routes.ts) line ~7 — `res.json(...)`

## Pass criterion

Joern flow traces from the MD5 source in `hashing.ts` through the
`computeSig` import into `routes.ts` and terminates at `res.json`.

## Fail signals

- Flow stops at the module boundary → import resolution or interprocedural
  step is broken.
