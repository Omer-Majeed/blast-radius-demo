# Blast Radius Demo

A local web app that scans repositories for weak-crypto usage with
**Opengrep** and traces each finding's data-flow to sinks (HTTP responses,
DB writes, …) with **Joern**.

Combines Phases P1 (opengrep scan + findings UI) and P2 (Joern flow
analysis + sink classification + flow-graph UI) into one deliverable.

---

## Prerequisites

Install once, globally:

```bash
# opengrep — rule-based scanning (semgrep fork, same rule syntax)
# https://github.com/opengrep/opengrep
brew install opengrep      # or pipx install opengrep

# Joern — CPG + data-flow
brew install joern

# scip-typescript — TS-only SCIP indexer (used by the linkage module)
npm install -g @sourcegraph/scip-typescript

# Node 20+
node --version
```

Sanity check:

```bash
opengrep --version
joern --version
joern-parse --version
```

---

## First-run setup

```bash
cd /Users/omermajeed/lightbird/point_wild/blast-radius-demo
npm install
```

---

## Run the app

```bash
npm run dev
```

Backend on `http://localhost:3001`. Frontend on `http://localhost:5173`
(proxies `/api` to the backend).

Open the frontend. Workflow:

1. **Repos** → add one or more repos by local absolute path.
2. **New scan** → pick repos + rulepacks → **Start scan**.
3. Watch the scan status. Opengrep runs first (fast), then Joern CPG
   builds (slow — minutes per repo), then Joern flow analysis per
   finding, and finally the linkage module runs (SCIP over the same
   repos) as an independent track.
4. Click **View flow** on a finding to see the reachable paths — with the
   terminal sink highlighted if it matches a descriptor in `sinks/`.
5. Click **View linkages** on the scan page to see cross-repo
   relationships (currently only `symbol-import` edges from the SCIP
   layer; grep and code2DFD layers to follow).

---

## Extending

### Adding weak-crypto or other rules

Drop a new YAML file under `rules/<pack>/`:

```yaml
# rules/insecure-random/insecure-random.yaml
rules:
  - id: node-math-random-for-tokens
    message: Math.random() is not cryptographically secure. Use crypto.randomBytes.
    severity: WARNING
    languages: [typescript, javascript]
    pattern: Math.random()
```

Restart the backend (rulepacks are discovered on start).

### Adding a new sink category (Kafka, SNS, SQS, filesystem)

Drop a YAML file under `sinks/`:

```yaml
# sinks/kafka.yaml
sinks:
  - id: kafka-producer-send
    category: kafka-out
    label: Kafka producer.send()
    severity: high
    call_name_regex: "^send$"
    receiver_regex: "^(producer|kafkaProducer)\\b"
```

Add matching CSS in `apps/frontend/src/styles.css` for the pill/banner
(`.pill-sink-kafka-out`, `.sink-kafka-out`) if you want unique colors.
Restart the backend to pick up new sinks.

---

## Architecture (one paragraph)

Fastify backend (`apps/backend/`) exposes a REST API. On scan creation
it fires off an in-process job that: (1) runs `opengrep scan --json` per
repo, storing findings in SQLite; (2) runs `joern-parse` to build a CPG
per repo (cached at `data/cpg/<repo-id>.bin`); (3) invokes a Scala flow
script (`src/analyzers/flow.sc`) once per repo that iterates all findings
and computes `reachableByFlows` per finding, emitting JSON; (4)
classifies each flow's terminal call against sink descriptors in
`sinks/*.yaml`. React frontend (`apps/frontend/`) polls scan status,
renders findings in a table, and visualizes each flow path with
react-flow.

### Folder layout

```
blast-radius-demo/
  README.md                       # this file
  package.json                    # npm workspace root
  apps/
    backend/
      src/
        server.ts                 # Fastify bootstrap
        config.ts                 # paths + env vars
        types.ts                  # shared TS types
        storage.ts                # SQLite ops
        rulepacks.ts              # discovers rules/<pack>/
        scan-runner.ts            # opengrep → joern-parse → joern flow
        analyzers/
          opengrep.ts             # execa wrapper
          joern.ts                # execa wrapper + flow classifier
          flow.sc                 # Joern Scala script
          sinks.ts                # loads sinks/*.yaml
        routes/
          repos.ts scans.ts findings.ts meta.ts
    frontend/
      src/
        main.tsx App.tsx styles.css
        api/{client,types}.ts
        pages/{Repos,ScanNew,ScansList,ScanView,FlowView}.tsx
        components/FlowGraph.tsx  # react-flow
  rules/
    weak-crypto/{sha1,md5}.yaml
  sinks/
    http.yaml
    db.yaml
  data/                           # gitignored — SQLite + CPGs + scan artefacts
  scripts/
    dev.sh
```

---

## Deferred (P3+)

Not in this build; called out for the follow-up conversation:

- **Cross-repo flow stitching.** When a flow ends at an HTTP-out sink,
  look up the matching endpoint in another registered repo and continue
  the flow into that repo's CPG. Requires an endpoint-map analyzer.
- **More sink categories.** Kafka, SNS, SQS, filesystem, subprocess.
- **GitHub URL support.** Currently only local absolute paths.
- **Real job queue.** Currently in-process, one repo at a time.

---

## Known caveats

- **Joern parse is slow.** First-time CPG build for a mid-sized JS/TS
  repo can take several minutes. CPGs are cached at `data/cpg/<repo-id>.bin`
  and reused across scans — delete that file to force a rebuild.
- **`reachableByFlows` is expensive.** Every finding triggers a flow
  computation; if you have hundreds of findings in a large CPG, expect
  minutes to tens of minutes per repo.
- **Terminal-sink-only classification.** Currently only the last node of
  each path is classified against `sinks/*.yaml`. Intermediate sinks
  (e.g. a hash going through a DB write and *then* an HTTP response)
  will only show the final sink. Extend `analyzers/joern.ts` to classify
  every node if you want intermediates highlighted.
- **Opengrep CLI drift.** If `opengrep scan --json` behaves differently
  in your version, adjust `analyzers/opengrep.ts`. The JSON schema
  matches Semgrep's public output shape.
