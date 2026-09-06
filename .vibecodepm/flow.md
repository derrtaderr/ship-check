# flow.md — lane-engine

The expected experience of a stranger adopting the runnable half.

## Entry points

- `npm test` — run the engine's own suite from a clean clone.
- `node lib/lane-report.mjs --gate …` — get a merge verdict from five inputs.
- `node lib/lane-report.mjs --status|--eligible|--metrics|--landed|--cap …` —
  read a lane-state / build-queue file.

## Happy path (the activation walk)

1. Stranger clones the repo. No dependencies to install.
2. Runs `npm test` → 126 tests pass. Confidence the engine is real.
3. Runs `node lib/lane-report.mjs --gate --repo my-service --has-tests yes
   --tests-pass yes --ship-check-passed yes --ship-check-agent a --build-agent b
   --scope-clean yes` → prints `AUTO-MERGE`.
4. **Activation:** the stranger has run the gate and received a verdict.
5. Flips an input (e.g. `--has-tests no`) → `PARKED` with a reason. They now
   understand the gate decides, and they read `docs/architecture.md` and the
   `templates/` to adopt the full loop into their own harness.

## States

- **Valid gate invocation** → `AUTO-MERGE` or `PARKED` (both exit 0).
- **Missing/invalid flag** → usage error to stderr, exit 1, never a silent pass.
- **Readable lane-state file** → the requested report, exit 0.
- **Unreadable or header-altered lane-state file** → loud error naming the file,
  exit 2, never a false "clean board."

## Recovery paths

- A malformed lane row is flagged in `--status` with a reason and the launcher
  halts — the stranger fixes the row by hand and re-runs.
- A bad `--today`/`--since` date fails loudly and names the flag rather than
  silently shifting the metrics window.
- The gate is stateless, so re-running after fixing inputs is always safe.
