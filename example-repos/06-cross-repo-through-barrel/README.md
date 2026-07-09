# 06 — cross repo, through a barrel re-export

The MD5 source lives in `barrel-lib/src/internal/hash.ts`. The lib's
`src/index.ts` re-exports it (`export { md5 } from './internal/hash'`).
The consumer imports `md5` from the top-level package name, so the
symbol has to be resolved through both the barrel and the package
symlink.

- **Source**: [barrel-lib/src/internal/hash.ts](barrel-lib/src/internal/hash.ts) line ~4 — `createHash('md5')`
- **Barrel**: [barrel-lib/src/index.ts](barrel-lib/src/index.ts) — `export { md5 } from './internal/hash'`
- **Sink**: [consumer/src/index.ts](consumer/src/index.ts) line ~7 — `res.json(...)`

## Setup

```bash
cd consumer && npm install
```

## Pass criterion

Flow resolves `md5` through the barrel and the `@demo/barrel-lib` symlink,
and terminates at `res.json` in the consumer.

## Fail signals

- Flow finds `md5` in `internal/hash.ts` but does not connect it to the
  consumer's call site → tracer isn't following re-exports.
