---
phase: ship-check
status: accepted
gate: 2
read_by: gtm (confirms shippable before launch planning), and the next ship-check run
---

# Ship-check — ship-check (gate 1)

Walked from a clean `git clone` into a tmp dir, no `node_modules`, Node v25.6.1.
This is a public-bound extract whose whole value is a track record, so the walk
weighted two things hardest: (1) honesty about what RUNS vs what needs an agent
harness, and (2) zero private data in the shipped bytes. Both of those pass
cleanly. The block below is a third thing: a silent fail-open in the launch path
that contradicts the map and the system's own fail-closed guarantee.

**Note on the maps:** `flow.md` and `metrics.md` carry no frontmatter/`status`,
so they were never formally marked accepted. Walked anyway.

## Verdict: BLOCK

One blocking finding. The gate engine's merge decision is faithful and the repo
is clean and honest, but the launch-recommendation path (`--eligible`) reads a
board containing a malformed row and reports it as launchable with exit 0 and no
warning — a false clean board, which is the single failure class this system
sells itself as preventing, and which `flow.md` explicitly promises cannot happen.

### BLOCKING — `--eligible` fails OPEN on a malformed lane file (false clean board)

Evidence, reproduced twice (mine and the user-advocate's):

- `test/fixtures/lane-state-edge.md` line 6 is a human-written in-flight lane for
  repo `esp`, truncated to 4 columns: `| 2 | 5 | esp | lane/esp |`.
- `node lib/lane-report.mjs --status …lane-state-edge.md` → flags it under
  "Malformed rows, fix by hand" (good) but **exits 0**.
- `node lib/lane-report.mjs --eligible test/fixtures/queue-sample.md test/fixtures/lane-state-edge.md`
  → prints "Row 2. ESP … (repo esp …)" as **launchable**, exit 0, and mentions
  the malformed row **nowhere** on stdout or stderr.

So `--eligible` tells the orchestrator to launch a second `esp` lane on top of a
broken in-flight `esp` row — the exact repo-collision / orphaned-PR case the
README's independence rule exists to prevent. `readLaneFile` already guards the
"no lane table" case with a loud exit 2; a malformed ROW inside a valid table is
not guarded in `--eligible`, only surfaced in a different command (`--status`)
the user has to know to run first.

Why this crosses the block line for THIS repo:
1. It is a false clean board — `flow.md`'s recovery section and `metrics.md`
   promise "never a false clean board," and this is one.
2. It is a BUILD-vs-MAP divergence: `flow.md` line 34 states "the launcher halts
   on a malformed row." The launcher (`--eligible`) does not halt or warn.
3. The gate's stated philosophy is fail-CLOSED ("a missing identity is itself a
   block"); `--eligible` here fails OPEN, inconsistently.
4. The mitigation exists only in `templates/dispatch-procedure.md` line 30 ("if
   `--status` reports malformed rows, stop"), but the README tells the
   runnable-half stranger "if you only want the gate, you never need an agent at
   all" — pointing the one reader who needs the "status first" rule away from the
   only doc that states it. The README quickstart lists `--status`/`--eligible`/
   `--cap` as three peer commands with no ordering instruction.

**To clear the block (any one closes it, first is preferred):**
- Make `--eligible` (and, for consistency, `--status`) fail closed on a malformed
  lane file: refuse with a loud message and a non-zero exit when the lane file it
  reads contains any malformed row, matching `readLaneFile`'s existing exit-2
  guard. Then the launcher actually halts, as the map says.
- OR, at minimum: correct `flow.md` line 34 so it no longer claims the launcher
  halts, AND add a "run `--status` first and stop on malformed rows" step to the
  README's runnable-half quickstart so the fail-open is disclosed to the exact
  user who is told to skip the templates.

## What passed (for the record)

### Flows walked — all commands run verbatim from a clean clone
- `npm test` → 126 pass, 0 fail, 0 deps, exit 0. Matches every doc (`npm test` is
  126; the "127" seen elsewhere is a broader glob pulling in `local-date.testkit.mjs`).
- Gate AUTO-MERGE / PARKED, all README + WALKTHROUGH (§0/§4/§6/§7) blocks →
  reproduce character-for-character.

### Five axes
1. **Invocation** — PASS (minor: no real `--help`; `--gate` reveals required
   flags one at a time, ironic for a gate that reports every merge failure at once).
2. **Comprehension** — PASS except the `--eligible` silence above.
3. **Persistence** — PASS (stateless library; no lost-work surface).
4. **Recovery** — CONCERN → the BLOCK above. Direct errors are exemplary:
   header-altered → exit 2 naming the file; missing file → exit 2; bad `--today`
   → exit 1 naming the flag; missing/unknown gate flag → exit 1; malformed
   metrics history → exit 2. The one leak is `--eligible` on a malformed board.
   (Minor: `--status` prints "fix by hand" but exits 0, disagreeing with the
   exit-2 convention everywhere else — a scripted exit-code check reads a broken
   board as a pass.)
5. **Waste** — PASS (idempotent gate; minor re-entry on one-at-a-time gate flags).

### Engine fidelity
All six verdict classes correct: no-tests park, tests-fail park, ship-check-fail
park, self-bless park (also parks when either agent id is MISSING — fails closed,
verified), protected-repo park (`billing-service`), scope-unclean park, all-green
auto-merge. cwd-default paths and genericized neutral `PRODUCTION_REPOS` work.
**Mutation-to-red reproduced:** inverting `scopeClean` turned 8 targeted tests
red (incl. "scope drift blocks the merge"); restore → 82 green. The suite binds
the logic. Note the fail-open above is in the launch helper, NOT in `mergeVerdict`
— the actual merge decision is faithful and fails closed.

### Honesty contract — HOLDS (a strength)
All four `templates/*.md` open with "**This is a template, not a program.** It
cannot run itself." README §"Two honestly-different halves" + SPEC state there is
no `npm install` that orchestrates agents. Every stranger command was run; none
fails. Nothing implies the orchestration self-runs.

### Package + contamination — CLEAN
`npm pack --dry-run`: 17 files, 28.3 kB, only lib/templates/docs/examples + the
4 root docs. No tests, no `.vibecodepm/`, no `WIRING.md`, no dev exhaust, no
`node_modules`, no `.env`. Private-token sweep over the full shipped tree AND all
git history: zero hits (client names, private repos, brands, absolute paths,
secrets). Only history matches are Jason's own authorship email and
meta-references to the genericization sweep.

### Security surface — MINIMAL
`lane-report.mjs` only `readFileSync`s explicit/cwd paths, writes stdout/stderr,
sets exit codes. Zero network egress, zero env/secret reads, no `child_process`,
no argv secrets. Untrusted markdown is parsed defensively. Nothing to leak.

## Non-blocking findings on record

- **IMPORTANT — receipts hang without an evidence chain.** The hero table
  (12 lanes / 22 gates / 138→1264 tests / 2 killed 0 lost / 0 wrong prod merges)
  carries no link to a source. `gtm-architect` (the build that produced them) is
  public and its live suite really does have 1264 passing tests (verified by
  running it), so the one substantiable number is TRUE but left uncheckable.
  Link `gtm-architect` as the evidence chain and frame the numbers as a
  testimonial of one build week, not a reproducible in-repo benchmark. None of
  the numbers leaks WHAT was built (all process metrics), so publishable as-is.
- **MINOR — `gtm-architect`'s GitHub description says "1242 tests"; live is 1264.**
  Reconcile if it becomes the linked evidence.
- **MINOR — `flow.md`/`metrics.md` lack frontmatter/status.** Add the shared
  frontmatter so the maps are formally accepted.
- **NOTE — `package.json "private": true`.** Blocks `npm publish`; harmless for
  git-clone distribution and protective against accidental publish.

## Differentiation from prior art — ACCURATE
The README's paraphrase of `earn-autonomy` ("autonomy trust ladder — earning the
right to run unattended over time") matches that repo's actual public description;
ship-check is the orthogonal axis (a single change earning a merge via
adversarial review gates). Non-overlapping.

---

Decision: **BLOCK** (gate 1).
hard_gate: `--eligible` must not report a launchable board when the lane file it
reads contains a malformed row — fail closed (loud, non-zero exit) like the
missing-table guard already does, OR correct `flow.md` line 34's halt claim and
add a "run `--status` first, stop on malformed rows" step to the README's
runnable-half quickstart.
success_window: carried from metrics.md — activation = a stranger runs the gate
and gets a verdict (exit 0, stdout AUTO-MERGE|PARKED), demonstrated live.
date: 2026-09-06

---

# Ship-check — ship-check (gate 2) — fix-wave 1 re-gate

Re-verified from a second genuinely clean `git clone` (no `node_modules`, Node
v25.6.1) against the 2 commits on top of the gate-1 base (`1772f53` fix,
`57cb2b5` docs+feat). `npm test` → 131 pass, 0 fail, 0 deps.

## Verdict: BLESS

The gate-1 blocker is closed at the code level (not softened), and the two
IMPORTANT/MINOR items I raised are addressed, with no regression to the engine or
the privacy/honesty posture.

### Gate-1 BLOCKER — CLEARED (verified on my own edge fixture, real exit codes)
- `node lib/lane-report.mjs --eligible test/fixtures/queue-sample.md test/fixtures/lane-state-edge.md`
  → **exit 2**, stdout empty, stderr refuses and names all 6 malformed rows with
  what is wrong with each, leading "a malformed board is not an empty all-clear
  board." The exact false-clean-board repro now fails closed.
- `--status …lane-state-edge.md` → **exit 2**, still prints the board and the
  malformed section, closes "This board is not a clean all-clear board."
- Clean board unregressed: `--eligible examples/…` lists 3 rows, **exit 0**;
  `--status examples/…` **exit 0**.
- Missing-TABLE guard unchanged: header-altered → exit 2 naming the file.
- `flow.md` States + Recovery rewritten to describe the exit-2 fail-closed
  behavior; the "launcher halts on a malformed row" promise I flagged as false is
  now TRUE against the build, not merely reworded.

### Engine fidelity — UNREGRESSED
All six verdict classes reproduce correctly on a fresh clone: all-green
AUTO-MERGE; no-tests / tests-fail / ship-check-fail / self-bless / protected-repo
(`billing-service`) / scope-unclean each PARK with the right reason. The blocker
fix lives in the launcher input path (`refuseOnMalformedLanes`), not in
`mergeVerdict`, and the merge decision is untouched.

### IMPORTANT (receipts) — ADDRESSED
README now cites the one reproducible receipt: "the 138 → 1264 test growth was on
github.com/derrtaderr/gtm-architect — clone it and run its suite to check the
number yourself," with the other figures explicitly labeled as from the private
lanes rather than presented as reproducible. `gtm-architect` is public and I
re-confirmed its live suite is exactly 1264 passing. The number no longer hangs.

### MINORS — ADDRESSED
- `--help`/`-h` present; lists all six modes and the gate flags up front (exit 0).
- `flow.md`/`metrics.md` gained frontmatter (`status: current`).
- Test-count references reconciled to 131 across README, flow.md, metrics.md, and
  docs/architecture.md — no stale "126" survives (the only "126" strings left are
  substrings of the receipts' "1264").

### Privacy / packaging — STILL CLEAN
Private-token sweep over the two new commits' full diff (lib + docs): zero hits.
`npm pack --dry-run`: still 17 files, 29.3 kB, only lib/templates/docs/examples +
the four root docs — no tests, no `.vibecodepm/`, no dev exhaust.

## Notes carried forward (non-blocking, not conditions)
- `--status` now exits 2 on a malformed board (was 0 at gate 1). This is the
  intended fix and matches `dispatch-procedure.md` step 1 ("if `--status` reports
  malformed rows, stop"); consistent, not a regression.
- `gtm-architect`'s GitHub description was updated 1242→1264 by the orchestrator
  outside this repo (not verified by me here; the linked live suite is 1264).

---

Decision: **BLESS** (gate 2).
hard_gate: none — gate-1 blocker cleared and verified.
success_window: carried from metrics.md — activation = a stranger runs the gate
and gets a verdict (exit 0, stdout AUTO-MERGE|PARKED), demonstrated live.
date: 2026-09-06
