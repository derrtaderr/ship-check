# Spec — harden the audit modes and make protection real

This document specs a review-driven hardening wave against the gate engine. It
states one invariant, one behavior change, one additive machine-safe surface,
one documentation boundary, and one packaging fix. It is written before the
tests and the code, so the tests have a contract to fail against.

## 1. The fail-closed invariant, extended to every derived answer

**Invariant: malformed lane state produces no derived answer. Every mode that
derives an answer from the lane table refuses (exit 2, naming the rows) when the
table is unreadable or carries a malformed row.**

`--eligible` and `--status` already hold this line. Two modes did not:

- `--metrics` called `parseLanes(read(...))`, bypassing **both** the
  missing-table guard (`readLaneFile`) and the malformed-row guard
  (`refuseOnMalformedLanes`). `laneMetrics()` then filters malformed lanes out,
  so a malformed active lane silently vanished from the started / shipped /
  stalled counts.
- `--landed` used `readLaneFile` (missing-table safe) but then
  `.filter(l => !l.malformed && ...)`, so a malformed **shipped** row silently
  disappeared from the post-merge audit — the one report the walkthrough calls
  "where an auto-merge becomes visible afterward." A vanished shipped row is a
  merge nobody can audit.

**Fix.** Route `--metrics` and `--landed` through `readLaneFile` +
`refuseOnMalformedLanes`, exactly like `--eligible` / `--status`: a malformed
board exits 2 and names the offending rows on stderr; a clean board computes
unchanged.

**Audit of the remaining modes.** Grepping for `parseLanes`, `read(`, and
`.filter`:

- `--eligible` — already `readLaneFile` + `refuseOnMalformedLanes`. Safe.
- `--status` — already `readLaneFile`, sets `exitCode = 2` on any malformed row.
  Safe.
- `--cap` — never reads the lane table for its answer. It derives the cap only
  from the `**Cap: N.**` line and the metrics-history table, and it already
  guards both (missing table, missing cap line, malformed history rows). No
  lane-row-derived answer exists here, so the invariant is already satisfied and
  no change is made. This is recorded so the absence of a change is a decision,
  not an oversight.
- `--gate` — reads no lane file. Safe.

## 2. Protected repos as real configuration

Today `PRODUCTION_REPOS` is a hard-coded const shipping **example** names
(`billing-service`, `payments-api`, …) and adopters are told to edit source. So
someone installs the package, runs the gate against their real production repo,
and it is not protected, because the effective default is a list of example
repos that are not theirs. A safe-looking policy that is not actually configured
is the worst possible failure for a fail-closed gate.

**Design decision (recorded).**

- Protected repos load from a **config file**: `ship-check.config.json` in the
  current working directory by default, or an explicit `--config <path>`.
- The file shape is `{ "protectedRepos": ["repo-a", "repo-b"] }`.
- The example names live only in `ship-check.config.example.json` and the docs,
  never as an effective default in code.

**Three states, and the distinction is the whole point.**

1. **Not configured at all** (no `ship-check.config.json` in cwd, and no
   `--config`): the gate **parks** with
   `production-protection policy is not configured; create ship-check.config.json (protectedRepos: [...]), or set it to [] to opt out deliberately.`
   It never silently treats "no config" as "nothing protected."
2. **Configured with a list**: those repos park exactly as today.
3. **Configured `[]`**: the deliberate opt-out. The gate proceeds, and says once
   (on stderr) that production protection is deliberately disabled.

**Error states (exit 2, unreadable/invalid evidence, not a park).**

- `--config <path>` naming a file that does not exist or cannot be read.
- A config file present but not valid JSON.
- A config file whose `protectedRepos` is missing or is not an array of strings.

**Split.** The pure decision stays in `lane-tally.mjs`:
`resolveProtectionPolicy(config)` turns a parsed config object (or `null`) into
`{ configured, repos, optOut }` or a `{ malformed }` marker; `mergeVerdict(lane,
checks, policy)` takes the resolved policy and pushes the not-configured park
reason or the protected-repo reason. The file read stays in `lane-report.mjs`,
the only module that touches the filesystem. `PRODUCTION_REPOS` is removed from
the library; the example set moves to `ship-check.config.example.json`.

This is a real behavior change: `mergeVerdict`'s third argument is now required,
and a gate run with no config parks instead of auto-merging. Every existing test
that called `mergeVerdict` with two arguments is migrated to pass an explicit
policy.

## 3. Machine-safe gate semantics — `--ci` and `--json`

`ship-check --gate ... && gh pr merge` would merge a PARKED verdict, because
PARKED exits 0 today. "Read the word, not the exit code" is not enough for a
machine interface; a gate must be hard to misuse.

**Additive, non-breaking.** The current human `--gate` keeps exit-0-on-park,
documented and tested. Two additive flags make the machine surface safe:

- `--ci` (alias `--strict`): distinct exit codes.

  | exit | meaning |
  |---|---|
  | 0 | AUTO-MERGE |
  | 3 | PARKED |
  | 1 | usage error |
  | 2 | invalid / unreadable evidence (unreadable config, malformed config) |

  A not-configured park is a **park** (exit 3), not an evidence error. A
  malformed or unreadable config is exit 2.

- `--json`: prints the envelope `{ verdict, autoMerge, reasons }` to stdout, so a
  machine consumer reads a field, not a word or an exit code. `verdict` is
  `"AUTO-MERGE"` or `"PARKED"`; `autoMerge` is a boolean; `reasons` is the array
  of park reasons (empty on auto-merge). `--json` keeps stdout pure JSON; the
  deliberate-opt-out note goes to stderr.

`--ci` and `--json` compose (`--gate --ci --json`): JSON on stdout, exit code by
verdict.

## 4. The independence trust boundary (docs only)

The engine proves `reviewerId !== builderId`, but not that those two IDs are
genuinely separate agent sessions — a broken harness could pass two different
labels for one agent. `docs/architecture.md` gains a plain statement:
ship-check verifies the recorded identities differ; the harness is responsible
for making those identities truthful; future hardening records session/run IDs,
not friendly labels. No code change.

## 5. Expose `ship-check` as the binary

`package.json` `bin` maps only `lane-report`. Add `ship-check` pointing at the
same entry, keep `lane-report` as an alias so nothing breaks, and update the
README quickstart to show `ship-check --gate ...`.
