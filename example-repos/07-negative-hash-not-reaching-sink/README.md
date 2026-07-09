# 07 — negative: weak crypto exists but never reaches a sink

Opengrep should still emit the MD5 finding — but Joern's
`reachableByFlows` should return **no path** that terminates at any
descriptor in [sinks/](../../sinks/). The digest is only used for a
`console.log` line; the Express handler emits an object that does not
contain the digest.

- **MD5 source**: [repo/src/index.ts](repo/src/index.ts) line ~7
- **`console.log`** (not a sink): line ~13
- **`res.json` call** (sink, but no taint): line ~14

## Pass criterion

Opengrep reports one MD5 finding. Joern reports **zero** classified
sinks reachable from that finding (or reports paths whose terminal is
not in any sink descriptor). The UI's flow view for this finding should
show either "no reachable sinks" or paths ending at `console.log`.

## Fail signals

- Any flow reports `res.json` as a classified sink → the tracer is
  conflating variables in the same lexical scope even when they are not
  actually connected via dataflow.
