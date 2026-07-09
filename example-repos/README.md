# example-repos — taint-flow test fixtures for blast-radius-demo

Each subdirectory is a self-contained scenario for testing whether the
demo's flow analyzer (opengrep source → Joern `reachableByFlows` → sink
classifier) traces weak-crypto usage to its terminal HTTP sink correctly.

Structure follows the `blast-radius-rnd/scip-vs-lsif/examples/multi-repo-ts`
pattern: every "repo" is standalone with its own `package.json` and
`tsconfig.json`. Cross-repo cases link siblings via `"file:../other-repo"`
so `npm install` creates the symlink the TypeScript compiler and Joern
parser need to resolve imports.

## Setup per case

Before running the analyzer on a cross-repo case, install once so the
symlinks exist:

```bash
# from any repo directory
npm install
```

Single-repo cases don't need install for opengrep (source-only scan) but
Joern's parser will resolve imports better if types are available.

## Sources and sinks

- **Source** (matched by [rules/weak-crypto/](../rules/weak-crypto/)):
  `crypto.createHash("md5" | "sha1")` and their `createHmac` variants.
- **Sink** (matched by [sinks/http.yaml](../sinks/http.yaml)): Express
  `res.json` / `res.send` / `res.write` / `res.end`. All cases use
  Express-only sinks.

## Case index

| # | Directory | What it tests |
|---|-----------|---------------|
| 01 | `01-same-file-cross-function/` | Baseline: source in one function, sink in another, same file |
| 02 | `02-cross-file-same-repo/` | Source imported from a sibling file within the same repo |
| 03 | `03-cross-repo-lib-consumer/` | Source lives in a `file:`-linked package, sink in consumer |
| 04 | `04-cross-repo-two-hops/` | Two-hop chain: `hash-lib → hash-middleware → consumer` |
| 05 | `05-cross-repo-sink-in-lib/` | Inverse of 03: source in consumer, sink call site in library |
| 06 | `06-cross-repo-through-barrel/` | Source re-exported through an `index.ts` barrel |
| 07 | `07-negative-hash-not-reaching-sink/` | Weak crypto exists but never flows to a sink (should NOT report a flow) |
| 08 | `08-multi-sink-fan-out/` | Single source function feeding two distinct sinks |
| 09 | `09-async-await-boundary/` | Source produced inside `async` fn, awaited, then emitted |
| 10 | `10-object-field-aggregation/` | Hash stored in an object property, destructured, then emitted |

Each case ships its own `README.md` naming the exact source line and the
expected sink line, plus the pass/fail assertion.
