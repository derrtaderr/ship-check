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

---

# Ship-check — ship-check (gate 3) — harden-and-configure lane, senior contract

Reviewed as `shipcheck-shipcheck-harden`, independent of the build agents, from a
genuinely fresh `git clone` of `lane/harden-and-configure` into a tmp dir (no
`node_modules`, Node v25.6.1). `npm test` → **168 pass, 0 fail, 0 deps**. This is
the FIRST review run under the upgraded senior-reviewer contract
(`templates/reviewer-contract.md`), reviewing the very change that wrote it, so it
was held to all five mandated passes. Pass 1 (blast-radius / class-not-instance)
was run hardest, because the external review that triggered this lane caught the
prior wave closing only 2 of 4 fail-open surfaces. A user-advocate stranger walk
was dispatched and its findings are folded in below.

## Verdict: BLESS

The change does what it claims. The fail-closed invariant — the whole reason this
lane exists — is now **universal across every mode**, independently verified by
grep + real exit codes + a mutation test, not taken on the lane's word. Zero
blockers. The findings are all documentation / map drift, three important and two
minor, none of which touches behavior, security, or the fail-closed guarantee. A
bless may carry importants and minors; per the contract, blocking a logic-sound,
privacy-clean, fail-closed hardening over stale doc numbers would itself be a
junior nitpick-block. **For the PUBLIC flip the bless is provisional** (installable
-artifact rule): important #1 and #3 below are wrong claims on the exact
verify-me / CI-wiring surfaces the product sells and must be corrected before the
repo goes public.

### Pass 1 — BLAST-RADIUS: the fail-closed class IS closed (the #1 job)

Grepped every `parseLanes(` / `read(` / `.filter(` / mode entry, then probed each
mode with real exit codes against a malformed-row board AND a missing/altered-table
board. Result, all reproduced live:

| mode | malformed row | missing/altered table | clean board |
|---|---|---|---|
| `--eligible` | exit 2 | exit 2 | exit 0 |
| `--status`   | exit 2 | exit 2 | exit 0 |
| `--metrics`  | exit 2 | exit 2 | exit 0 |
| `--landed`   | exit 2 | exit 2 | exit 0 |
| `--cap`      | exit 2 (on malformed HISTORY) | exit 2 | exit 0 |
| `--gate`     | reads no lane file — config-only, parks fail-closed | — | — |

- The 4 `parseLanes` callers (`--eligible/--status/--metrics/--landed`) each route
  through `readLaneFile` + either `refuseOnMalformedLanes` or `exitCode=2`. The two
  the external reviewer caught (`--metrics`, `--landed`) are now closed exactly like
  the two that were already closed. **The class is closed, not just the instances.**
- **`--cap` "exempt by construction" — VERIFIED, not accepted.** Injected a malformed
  lane row into a valid cap+history fixture; `--cap` output was byte-identical and
  exit 0. It never calls `parseLanes`; it derives the cap only from the `**Cap: N.**`
  line and the metrics-history table, and it fails closed (exit 2) on a malformed
  HISTORY row (its actual input). The exemption is real and correctly reasoned, and
  `docs/harden-and-configure.md` records the absence-of-a-change as a decision.
- **Mutation test (pass 3 refute, applied to the new logic):** inverting the
  not-configured park → 2 tests red; allowing a bless to carry a blocker → 2 red;
  accepting an unstructured findings string as structured → 3 red; restore → 168
  green. The suite genuinely binds the hardening.

### Config safety (npm-install-and-run cannot skip protection) — PASS

Every partial/malformed config fails closed, no false auto-merge in any case:
no config in cwd → PARK (exit 0, human gate); empty file / non-JSON / missing
`protectedRepos` / wrong type / non-string entry → exit 2 naming the fault; literal
`null` → PARK (not-configured); explicit `--config` at a missing path → exit 2.
`protectedRepos: []` opt-out prints `Production protection is deliberately disabled
(protectedRepos: [])` on stderr **before** auto-merging — the risky path announces
itself. The effective default is `ship-check.config.json`; the example ships as
`ship-check.config.example.json` and `.gitignore` excludes the real one, so the
example is clearly not a silent default.

### Machine surface (`--ci`/`--json`) — PASS, no E1 divergence

`--ci`: auto-merge exit 0, parked (protected) exit 3, parked (no config) exit 3 — a
PARKED verdict never exits 0. `--json` is one parseable doc with `verdict` as a
field. `--json` + `--ci` on the same inputs always agree (PARKED→3, AUTO-MERGE→0):
the same-fact-two-surfaces class is closed.

### Structured-findings gate — PASS, no blocker sneaks through

`none`→auto-merge; `minor=3`→auto-merge; `blocker=0,important=2`→auto-merge;
`"looks fine"`/empty/`"yes"`/missing flag→PARK ("no structured findings");
bless+`blocker=1`→PARK ("a blocker must block"); uppercase `BLOCKER=1`→PARK; sneak
`"none,blocker=1"`→PARK. No unstructured verdict and no blocker-carrying bless can
pass.

### Backward-compat — PASS

Plain `--gate` unchanged (exit 0 on park, human output). `lane-report` bin alias
still present alongside `ship-check` (both in `package.json` bin; `--help` runs from
either). WALKTHROUGH §4/§6 gate commands and the README `--status`/PARKED/JSON
blocks reproduce verbatim.

### Public hygiene — CLEAN

`npm pack --dry-run`: 19 files, only lib/templates/docs/examples + 4 root docs +
`ship-check.config.example.json`. No `test/`, no `.vibecodepm/`, no `WIRING.md`, no
real config, no dev exhaust. Private-token sweep (client names, private repos,
brands, secrets, absolute paths) over the full working tree AND all git history:
zero hits — the only history matches are Jason's own public authorship email. The
independence trust-boundary section in `docs/architecture.md` is honest and plain:
it states the gate proves `reviewerId !== builderId` but NOT that they are separate
sessions, names the harness as responsible, and calls it a boundary, not a bug. No
overclaim.

## Findings (blocker=0, important=3, minor=2)

- **IMPORTANT #1 — test count is wrong on the shipped verify-me surface, three ways.**
  `npm test` = **168**. `README.md:54` and `docs/architecture.md:184` say "158";
  `.vibecodepm/flow.md:21` and `metrics.md:19` say "131". The README's whole pitch is
  "clone it and run the tests" — the first number a skeptical stranger checks is one
  line above the command and does not match. Corroborated by the user-advocate
  (graded high). Fix before the public flip.
- **IMPORTANT #2 — `flow.md` happy-path activation example now PARKS.** `flow.md`
  step 3 shows `--gate … --ship-check-passed yes …` (no `--ship-check-findings`, no
  `--config`) → "prints AUTO-MERGE". Run verbatim against the hardened build it
  PARKS on two reasons (no structured findings; policy not configured). The build is
  correct; the MAP is stale on the exact activation step this gate walks against.
  Internal (not shipped) and the shipped README example is correct, so lower impact
  than #1 — but it should be reconciled (add the findings flag + a config/opt-out to
  the happy path, and fix 131→168) or the next ship-check run walks a self-parking
  activation example.
- **IMPORTANT #3 — README/architecture mislabel the `--ci` exit codes.** Both list
  "`2` bad evidence" in the `--ci` legend (`README.md`, `docs/architecture.md:167`).
  A bad evidence value (`--has-tests maybe`) actually exits **1**; exit 2 is reserved
  for an unreadable/malformed board or config (the `--help` text is accurate; the
  README legend is the stale one). Independently flagged by the user-advocate
  (medium): a CI author wiring off this paragraph — its stated purpose — builds the
  wrong exit-2 handler. No wrong-merge risk (both are non-zero, so `--ci && merge`
  still won't merge a park); it is a labeling drift on the CI surface. Fix before flip.
- **MINOR #1 — "all five hold" undercounts the gate.** `README.md:126` and `SPEC.md:28`
  summarize the gate as five conditions; `mergeVerdict` also enforces the
  structured-findings condition (documented prominently two paragraphs above, so a
  reader is not misled, but the count-summary is stale — it is now six-ish).
- **MINOR #2 — README AUTO-MERGE example prints PARKED before the `cp` step.** The
  annotated `# => AUTO-MERGE` block (README 72–78) reproduces only after the
  `cp …example.json …config.json` step that precedes it. Safe direction (it parks,
  never a spurious merge). Worth a one-line "(after the cp step above)" note.

## Notes carried forward (not conditions)
- The hero-table receipts (`138 → 1264`, etc.) are honestly sourced to a private
  build week with only the gtm-architect figure pointed at a public repo; neither
  reviewer re-cloned that external repo this pass (gate 1/2 did and confirmed 1264).
- `--status` / `--cap` now exit 2 on a malformed board (was 0 at gate 1) — the
  intended fix, consistent with `dispatch-procedure.md`, not a regression.

---

Decision: **BLESS** (gate 3), provisional on the pre-flip fix of the shipped doc
drifts.
hard_gate: none blocks the merge. Before the PUBLIC flip, correct the shipped
test-count claim (168, not 158/131) in README + architecture, and the `--ci`
exit-2 "bad evidence" label (bad evidence exits 1; exit 2 is unreadable board/
config). Reconcile the stale `flow.md` happy-path example in the same pass.
success_window: carried from metrics.md — activation = a stranger runs the gate
and gets a verdict (exit 0, stdout AUTO-MERGE|PARKED), demonstrated live.
date: 2026-09-06
