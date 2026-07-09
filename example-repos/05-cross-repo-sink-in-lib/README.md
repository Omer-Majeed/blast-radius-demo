# 05 — cross repo, source in consumer, sink in lib

Inverse of case 03. The consumer computes an MD5, then hands the digest
and the Express `res` object to a `response-lib` helper which is where the
`res.json` call site lives.

- **Source**: [consumer/src/index.ts](consumer/src/index.ts) line ~8 — `createHash('md5')`
- **Sink**: [response-lib/src/index.ts](response-lib/src/index.ts) line ~4 — `res.json(...)`

## Setup

```bash
cd consumer && npm install
```

## Pass criterion

Joern reports a flow whose terminal call is `res.json` in
`response-lib/src/index.ts` (not in the consumer). Sink classifier
still tags it `express-res-body` — receiver regex should match `res`.

## Fail signals

- Sink not classified → classifier's receiver regex fails on
  cross-package-inlined `res` variable.
- Flow terminates at `reply(res, ...)` in the consumer without stepping
  into the lib → cross-package parameter passing not being modeled.
