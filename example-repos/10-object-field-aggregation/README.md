# 10 — object field aggregation (field-sensitivity)

The MD5 digest is stored inside an object literal returned from `pack`.
The handler destructures the result, then emits the digest via `res.json`.
Tests whether the tracer preserves taint through property write, property
read, and destructuring.

- **Source**: [repo/src/index.ts](repo/src/index.ts) line ~10 — `createHash('md5')`
- **Field write**: line ~10 — `sig: createHash(...)`
- **Destructure / read**: line ~15
- **Sink**: line ~16 — `res.json(...)`

## Pass criterion

Flow steps through the object's `sig` field into the destructured
`sig` binding and terminates at `res.json`.

## Fail signals

- Flow marks the whole object as tainted but reports the sink call
  taking `{ user, sig }` unrelated → destructuring not being modeled.
- Flow terminates at `pack`'s return statement → tracer isn't reading
  properties out of the returned object.
