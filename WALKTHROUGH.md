# Walkthrough — one lane's life, end to end

This follows a single build lane from dispatch to merge, on a fictional example.
Every command block below is real: it was run against the synthetic files in
`examples/`, and its output is pasted verbatim. Nothing here is invented output.

The lane builds **queue row 11, "Command-center map render," against the repo
`command-center`.** The narrative parts (what the agents do inside the harness)
are described; the gate and report commands are the runnable engine, shown live.

## 0. The board before launch

Two lanes shipped last week and one is still running. The orchestrator reads the
board:

```
$ node lib/lane-report.mjs --status examples/lane-state.md --today 2026-08-27
## Active lanes

- Lane 3: row 9, overlap-mapper, PR 9, 1d old
```

One lane open, one slot's worth of the cap in use. What can launch:

```
$ node lib/lane-report.mjs --eligible examples/build-queue.md examples/lane-state.md
## Launchable rows, ranked

- Row 2. ESP provider-detection resurrection (repo esp, 1 session)
- Row 5. Widget-lib pagination helper (repo widget-lib, 1 session)
- Row 11. Command-center map render (repo command-center, 1 session)
```

Row 11 is eligible: its repo `command-center` is not claimed by any active lane.
The cap check confirms there is room:

```
$ node lib/lane-report.mjs --cap examples/lane-state.md
## Cap decision

- weeks read: 2026-08-17, 2026-08-24
- current cap: 2
- recommended cap: 3
- reason: two consecutive clean weeks, so the cap earns one more lane
```

Current cap is 2, one lane is open, so there is one free slot. (The launcher does
not act on `recommended cap` — only the weekly review moves the cap.) The
orchestrator gets the human's yes, checks for prior art on the row, and launches.

## 1. Dispatch

The orchestrator creates an isolated worktree and dispatches one execution agent,
`builder-3`, bound by `templates/execution-agent-contract.md`:

```
git -C ~/repos/command-center worktree add ~/build-lanes/map-render -b lane/map-render
```

The lane is appended to `lane-state.md` with status `running` and today's date.

## 2. The spec commit

`builder-3`'s first commit states what it actually agreed to build:

```
docs: spec — command-center map render (row 11)

Scope: one endpoint that takes a natural-language question and returns a
rendered dependency diagram. Prior art check: no existing build renders a
diagram from a question; the closest is a static graph exporter, which is
narrower. Divergence from row: none.
```

## 3. TDD cycles, one commit each

The agent works in strict red-green-refactor, committing at the end of every
cycle. A representative slice of its log:

```
test: failing test for question → node-list parse
feat: parse a question into a node list
test: failing test for empty question returns a 400, not a 500
feat: fail-closed on empty input with a 400
test: failing test for diagram render from a node list
feat: render the node list to an SVG diagram
refactor: extract the layout pass, still green
```

Small commits are the checkpoint system, not a style choice. When `builder-3` is
killed mid-run by a usage cap partway through the next cycle, nothing is lost —
every green cycle is already on the branch. A fresh agent resumes from the last
commit. The agent opens a PR and reports back as data: commit count, test counts
before and after, what it verified, open questions.

## 4. The gate — first pass finds a real bug

The orchestrator does not trust the lane's report. It runs the tests itself
inside the worktree (they pass), then dispatches an **independent** reviewer,
`reviewer-7`, bound by `templates/reviewer-contract.md`. The reviewer walks the
build as a stranger and finds one: a question containing a quote character
crashes the parser with a 500 instead of failing closed. That is a **block**, not
a bless.

The orchestrator runs the gate with the reviewer's verdict. The protected-repo
policy comes from a config file; here the shipped example config is passed
explicitly (`command-center` is not one of its protected names):

```
$ node lib/lane-report.mjs --gate --repo command-center \
    --has-tests yes --tests-pass yes \
    --ship-check-passed no \
    --ship-check-agent reviewer-7 --build-agent builder-3 \
    --scope-clean yes \
    --ship-check-findings blocker=1,important=0,minor=0 \
    --config ship-check.config.example.json
## Merge gate, repo command-center

PARKED
- ship-check did not pass
```

Parked. The command exits `0` — parking is a normal outcome, not an error — so
the orchestrator reads the word, not the exit code.

## 5. The fix wave

The finding goes back to `builder-3` verbatim, with the crashing input as
evidence. The agent adds a failing test for the quote character, watches it fail,
fixes the parser to fail closed with a 400, and commits the cycle. The reviewer,
`reviewer-7`, re-walks the build and this time reaches a bless.

## 6. The gate — re-gate after the fix

Same command, `--ship-check-passed` now `yes`:

```
$ node lib/lane-report.mjs --gate --repo command-center \
    --has-tests yes --tests-pass yes \
    --ship-check-passed yes \
    --ship-check-agent reviewer-7 --build-agent builder-3 \
    --scope-clean yes \
    --ship-check-findings none \
    --config ship-check.config.example.json
## Merge gate, repo command-center

AUTO-MERGE
```

All five gates hold: tests exist and pass, the ship-check blessed it with a
structured, calibrated result (`none` — an adversarial pass that found nothing),
the reviewer (`reviewer-7`) is a different agent from the builder (`builder-3`) so
it is not self-bless, `command-center` is not in the protected set, and the diff
stayed in scope. The orchestrator merges as a single squash commit (so
`git revert <sha>` is a one-command undo), sets the lane to `shipped`, and records
the commit count and the squash sha.

## 7. The post-merge audit

Because nothing is pre-merge anymore, the merge has to become visible somewhere.
The audit lists what landed since the last run:

```
$ node lib/lane-report.mjs --landed examples/lane-state-post-merge.md --since 2026-08-27
## Landed since 2026-08-27

- Lane 4: row 11, command-center, PR 14, 12 commits, sha c0ffee1
```

There it is: the lane that auto-merged, with the sha a human can `git show
--stat` or `git revert` if anything looks wrong. And the board now shows the lane
closed, with `command-center` freed for the next lane:

```
$ node lib/lane-report.mjs --status examples/lane-state-post-merge.md --today 2026-08-28
## Active lanes

- Lane 3: row 9, overlap-mapper, PR 9, 2d old
```

That is one lane's whole life: dispatched under a contract, built test-first in
checkpointed commits, blocked by an independent reviewer over a real bug, fixed
through a routed fix wave, re-gated, auto-merged on green, and made visible in the
audit. The gate did the deciding; the agents did the building and reviewing; the
human made the call on the picks and would have made it on the merge had any gate
failed.
