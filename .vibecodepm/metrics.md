---
artifact: metrics
status: current
---

# metrics.md — ship-check

## Activation event

**A stranger runs the gate against the fixture (or their own inputs) and gets a
verdict.** Concretely: a successful `node lib/lane-report.mjs --gate …` that
prints `AUTO-MERGE` or `PARKED`, from a clean clone, with no dependency install.

How it is measured: the command exits 0 and stdout contains `AUTO-MERGE` or
`PARKED`. In adoption terms, the stranger reaching step 4 of `flow.md`.

## Supporting numbers

- **Tests pass from a clean clone:** `npm test` exits 0 with 168 passing, 0
  failing, 0 dependencies installed. This is the trust gate before activation.
- **Zero external dependencies:** `package.json` has no `dependencies` or
  `devDependencies`. Verified by inspection and by the suite running under bare
  `node --test`.
- **Genericization is clean:** a tree-wide sweep for the source system's private
  tokens returns zero hits in shipped files.

## North star

Adopters who take the gate engine and wire the `templates/` into their own agent
harness — the full loop running in someone else's system, not just the gate run
once. Not instrumented in-repo (this is a library, not a hosted service); tracked
externally via adoption if the repo is published.
