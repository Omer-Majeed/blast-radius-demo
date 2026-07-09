# 09 — async / await boundary

The MD5 is produced inside an `async` function. The Express handler
`await`s the returned Promise before passing the digest to `res.json`.
Async boundaries are a common weak spot for taint trackers.

- **Source**: [repo/src/index.ts](repo/src/index.ts) line ~8 — `createHash('md5')`
- **Await point**: [repo/src/index.ts](repo/src/index.ts) line ~13
- **Sink**: [repo/src/index.ts](repo/src/index.ts) line ~14 — `res.json(...)`

## Pass criterion

Joern traces the digest through the resolved Promise into the awaited
value and terminates at `res.json`.

## Fail signals

- Flow stops at the Promise construction → tracer isn't modeling
  `Promise.resolve` / `async` return correctly.
- Flow reappears in the handler but is not connected to the async
  function's return → interprocedural summary is not being applied to
  async functions.
