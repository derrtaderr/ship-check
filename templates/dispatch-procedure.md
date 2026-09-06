# Dispatch procedure (orchestrator template)

> **This is a template, not a program.** It describes what an orchestrator
> running inside an agent harness (Claude Code or similar) does to launch and
> land build lanes. It cannot run itself. The only runnable part of this
> repository is the gate engine in `lib/`; everything in `templates/` is a
> procedure a human-plus-agent setup follows. Adopt it by dropping it into your
> own harness and wiring the steps to your agent runtime.

The orchestrator is the coordinator. It never writes feature code and never
reviews code; it launches lanes, runs the gate, and routes findings. Its one
discipline is **verify, do not trust** — every claim a lane makes is re-checked
against the world before it counts.

## Step 0 — map each repo name to a local path

A queue row names a repo; every git command needs a filesystem path. Keep a
table mapping repo names to local clones, and verify a clone exists with
`git -C <path> rev-parse --git-dir` before launching a lane against it.
Launching a lane against the wrong repo is the one failure this system cannot
detect on its own.

## Step 1 — read the board

```bash
node lib/lane-report.mjs --status ./lane-state.md
node lib/lane-report.mjs --eligible ./build-queue.md ./lane-state.md
```

If `--status` reports malformed rows, stop and fix them before launching
anything. A malformed row may be hiding a running lane, and a hidden lane
defeats the repo-independence check.

## Step 2 — check the cap

```bash
node lib/lane-report.mjs --cap ./lane-state.md
```

`current cap` is the live cap. Count lanes with status `running` or `pr-open`.
Free slots is **cap minus that count**. If zero, stop. Never raise the cap here;
the cap moves only in the weekly review, on recorded numbers, and this run
ignores `recommended cap`.

## Step 3 — pick, then check prior art

Take the top N eligible rows, where N is the free slots. They come back ranked
in the queue's own file order — do not re-sort. Get a human's yes on the picks.

**Then, for each picked row, before its worktree exists: look for prior art.** A
queue row is a claim about the world, not the world. Rows go stale silently — a
row can still say "resurrect this" months after the capability shipped. Search
your existing builds, your published repos, and the queue's own shipped section
for something that already does the work. Finding prior art does not
automatically kill the row; compare honestly and say which is better with
evidence. But never launch a lane without having looked.

## Step 4 — launch each lane

For each picked row, in order:

1. Create an isolated worktree, deliberately **outside any directory with
   restrictive file-access permissions** (on macOS, outside `~/Desktop` avoids
   the TCC/EPERM class that breaks background jobs):

   ```bash
   git -C <repo-path> worktree add ~/build-lanes/<row-slug> -b lane/<row-slug>
   ```

2. Dispatch one execution agent against that worktree, handing it the row text
   as the task, `templates/execution-agent-contract.md` as its binding contract,
   and its own identifier. Tell it plainly it must not run its own ship-check.

3. Append the lane to `lane-state.md` with status `running` and today's date in
   `started`. A running lane with no `started` date is a malformed row, and
   Step 1 will halt the next launch on it.

## Step 5 — when a lane opens a PR, gate it

Set the lane's status to `pr-open` and record the PR number. Then gather the
five gate inputs **from evidence you collect yourself, never from the lane
agent's summary**:

### 5.1 Run the tests yourself

The lane agent's own report is not evidence; it is a claim by the party being
graded. Run the build's own test command inside its worktree and capture the
real exit code:

```bash
cd ~/build-lanes/<row-slug> && npm test > /tmp/lane-test.log 2>&1; st=$?; tail -20 /tmp/lane-test.log; echo "exit=$st"
```

Reading `$?` after a pipe to `tail` reports `tail`'s status, not the runner's.
Redirect to a log first and capture `$?` immediately. The number after `exit=`
is the only evidence for `--tests-pass`. Any value but `0` is `no`. If there is
no test command at all, `--has-tests` is `no` and the lane parks — that is the
rule that stops "green" from meaning nothing ran.

### 5.2 Dispatch an independent ship-check

Dispatch a **separate** agent for the review, following
`templates/reviewer-contract.md`. The build agent may never run this. Record
both agent identifiers, because the gate compares them to catch self-bless. Only
an explicit bless is `--ship-check-passed yes`. A block, a conditional pass, a
hedge, or a report that never reaches a verdict is `no`.

### 5.3 Run the gate and obey it

```bash
node lib/lane-report.mjs --gate \
  --repo <repo> \
  --has-tests yes|no \
  --tests-pass yes|no \
  --ship-check-passed yes|no \
  --ship-check-agent <the reviewer agent id> \
  --build-agent <the build agent id> \
  --scope-clean yes|no
```

Every flag is required; none has a default. `--scope-clean` is `no` whenever the
diff reaches outside the row's declared scope.

- **AUTO-MERGE** — merge as a single squash commit so `git revert <sha>` stays a
  one-command undo. Set status to `shipped` and record the commit count and the
  squash sha.
- **PARKED** — set status to `parked` and paste every reason line into the lane
  note for the human. A parked lane is a PR awaiting a person, and its repo stays
  claimed until the PR resolves.

The command exits 0 for both verdicts, so a zero exit is not a pass on its own.
Read the word.

## Step 6 — the fix-wave loop

When your own verification finds something the lane's green suite missed — a bug,
a broken assumption, real data that invalidates the approach — send it back to
the lane agent as a **fix wave**: the finding stated verbatim, with the evidence,
routed to the agent that can act on it. Re-run 5.1–5.3 after each wave. A lane's
green suite is a claim like any other; the fix wave is how the orchestrator's
independent check turns into a correction rather than a note.
