# Architecture

This document is the deep reference for the runnable half of the repository — the
gate engine. The orchestration half is documented under `templates/`. Read the
README first for the shape of the whole system; read this when you want to know
exactly what the engine decides and why.

## Why the system exists

Builds run serially with a human in the loop at every step, which caps output at
roughly one shipped artifact per week regardless of effort. The bottleneck is not
picking what to build, not finishing, and not idea supply — it is that a human
sits on the critical path of every build from start to merge.

The lane model breaks that: several builds run concurrently, each in its own
isolated worktree with its own agent, and a deterministic gate decides which
merge automatically and which wait for a person. The human moves from typing
every build to making decisions and reviewing the ones that need it. In one
measured week this took twelve lanes through twenty-two adversarial review gates,
raised one repo from 138 to 1264 tests, lost zero work across two mid-run agent
kills, and correctly parked a production repo's merge for a human.

## The two-module split

The engine is split the way the source system split it, and for the same reason.

- **`lib/lane-tally.mjs` — pure functions, no I/O.** Every parsing and decision
  rule lives here. No file reads, no process access, no clock. This is what makes
  the rules unit-testable without a filesystem and what keeps them in exactly one
  place.
- **`lib/lane-report.mjs` — the CLI, the only caller of the rules.** It owns
  every file read and every argument. When a procedure needs a decision, it runs
  this and obeys the output rather than restating the rule in prose, because a
  prose copy of a rule drifts from the code and nothing catches the drift.
- **`lib/local-date.mjs` — one definition of "today."** Split out because a UTC
  calendar date is subtly wrong for anyone west of UTC in the evening. See
  `docs/local-date.md`.

## The merge gate

`mergeVerdict(lane, checks)` is the core. Human review no longer gates the merge,
so "green" has to carry the weight review used to. A lane auto-merges only when
**all** of these hold:

1. **The build has tests and they pass.** A build with no tests can never
   auto-merge — that is the rule that stops "green" from meaning "nothing ran."
2. **An independent ship-check passed.** Dispatched as a separate agent from the
   one that wrote the code.
3. **The ship-check agent differs from the build agent.** A missing identity on
   either side is itself a block, not a pass — otherwise two `undefined` values
   compare equal and the gate fails open on exactly the build it exists to catch.
4. **The repo is not in the protected set.** `PRODUCTION_REPOS` names the repos
   whose blast radius is too large to auto-merge into; they stay human-merge
   regardless of test state. **Edit this list to your own protected repos.** The
   shipped names are neutral examples.
5. **The diff stayed in scope.**

Every failing gate is **collected, not short-circuited**, so one run names
everything wrong with the lane instead of one thing at a time. The verdict is
`{ autoMerge, reasons }`; an empty `reasons` array is the only auto-merge.

## The parsers

`parseLanes`, `parseQueueRows`, `parseMetricsHistory`, and `parseCap` read a
hand-edited markdown file that prose grows around over time. Three properties are
load-bearing:

- **Table scoping.** Each parser reads exactly one named table, found by its
  header cell, and stops at the first blank line or heading. A stray pipe in the
  prose is not a lane row. Before scoping existed, one stray pipe took the whole
  launcher offline.
- **Malformed rows are flagged, never dropped.** A dropped lane is an invisible
  lane, and an invisible running lane defeats the repo-independence check. A bad
  row is kept, given a `malformed` reason, and surfaced.
- **`laneTableFound` distinguishes "no table" from "empty table."** Both would
  otherwise come back as an empty array, and reading that silence as a clean
  board is how a renamed header turns into "all lanes free" on a file still
  holding a running lane. Every CLI mode refuses to run on an unreadable table
  rather than mistake it for an all-clear.

## Repo independence

`activeRepos(lanes)` returns the set of repos currently claimed. Only a `shipped`
lane releases its repo; `running`, `pr-open`, `parked`, and `stalled` all still
hold an open PR. Letting a second lane branch off a repo one of them claims
orphans the first PR into a merge conflict, which is the exact collision the
independence rule prevents. `eligibleRows` filters the queue against this set.

## The self-correcting cap

The system does not let concurrency grow on vibes. `laneMetrics` counts lanes
started, shipped, and stalled (open past `STALL_DAYS`, or explicitly marked
stalled), plus median commits-to-ship as a quality signal. `isCleanWeek` requires
zero stalled, at least one launched, and every launched lane shipped — the "at
least one launched" clause stops two idle weeks from raising the cap vacuously.
`capRecommendation` raises the cap by one after two consecutive clean weeks (max
three) and drops it by one after any week with two or more stalled lanes (min
one). The cap moves on recorded numbers, never on how a week felt.

## CLI modes

| mode | answers |
|---|---|
| `--status` | which lanes are open, their age, which are stalled, which rows are malformed |
| `--eligible` | which queue rows can launch right now, ranked in file order |
| `--metrics` | started / shipped / stalled / median, optionally scoped to a `--since` window |
| `--landed` | which lanes shipped since a required `--since`, for the post-merge audit |
| `--cap` | current cap, recommended cap, and the reason |
| `--gate` | AUTO-MERGE or PARKED with every reason, from the five required flags |

Exit codes: `0` success (including a PARKED verdict — parking is a normal
outcome), `1` bad usage, `2` unreadable file. A zero exit on `--gate` is not a
pass on its own; read the word.

## Faithfulness

This engine is an extraction of a production instance. No gate rule or parser
behavior was changed in the move. The genericization renamed the protected-repo
set and the fixtures to neutral examples and re-pointed default file paths at the
working directory; every rule the source system relied on is preserved, and the
brought-across test suite (126 tests) is the proof.
