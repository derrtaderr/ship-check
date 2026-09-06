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

## 6. A senior reviewer, and a gate that requires structured findings

The external review that produced items 1–5 exposed a gap this repo's own
reviewer had walked into: the gate-1 fix wave fixed the two fail-open surfaces it
was told about (`--eligible`, `--status`) and never asked whether the **class**
was closed — `--metrics` and `--landed` were the same bug, unfound. A junior
reviewer checks what is flagged; a senior asks where else the flagged behavior
lives. This item encodes that in two places.

### 6a — the reviewer contract gains five mandated passes

`templates/reviewer-contract.md` is rewritten to require, as discipline the
reviewing agent is bound by, five passes on every review:

1. **Blast-radius pass (class, not instance), mandatory and first.** For every
   behavior the change touches, grep every *other* site sharing that behavior and
   verify it too; a finding is not closed until its whole class is checked. The
   gate-1 miss (2 of 4 fail-open surfaces fixed) is the worked cautionary example.
2. **Claim-vs-code drift.** Re-check every doc, comment, and README against the
   new behavior; a promise the code no longer keeps is a finding.
3. **Refute, don't confirm.** Construct hostile inputs; try to make it fail.
4. **Severity calibration, explicit.** Grade every finding blocker / important /
   minor against a stated line, so a bless is credible because a block is reserved
   for real stop-ships.
5. **The missing-question pass.** "What would a senior ask that the author
   didn't?" — the edge, the interaction, the production reality the spec missed.

### 6b — the gate requires structured findings

The gate cannot verify a blast-radius pass happened — that is the contract's
discipline and the record's credibility. It **can** refuse a review that reached
no structured, calibrated result. A new checked fact,
`--ship-check-findings <spec>`, carries the review's severity-tagged summary:

- **Valid structured spec:** `none` (an explicit clean pass — an adversarial walk
  that found nothing), or a comma list of `severity=count` over `blocker`,
  `important`, `minor` (e.g. `blocker=0,important=2,minor=1`).
- **Unstructured** (absent, empty, `looks fine`, a bare `yes`) fails the gate:
  the gate parks with a reason naming what is missing. This is a **park**, not a
  usage error — an unstructured review is a review-quality signal, not operator
  error, so it accumulates as a reason alongside the other gates rather than
  dying.
- **Calibration consistency:** a bless (`--ship-check-passed yes`) carrying a
  `blocker` finding parks — a blocker must block. The gate thereby enforces that
  the review **happened**, was **independent** (the existing identity gate), and
  was **calibrated**; the *seniority* of the judgment stays the contract's job.

`parseReviewFindings` (pure, in `lane-tally.mjs`) parses the spec; `mergeVerdict`
gains the two reasons above, in the accumulate-all-failures style. The dispatch
procedure, the walkthrough, and the README gate examples pass the new flag.
