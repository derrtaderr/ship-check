# ship-check

**A deterministic merge gate for multi-agent software delivery — plus the
orchestration contract it runs inside.** Several build agents work in parallel,
each in an isolated worktree; an independent reviewer adversarially checks each
one; and a zero-dependency gate decides, mechanically, which changes auto-merge
and which wait for a human.

## The receipts

This is an extract of a system that has been building software in production. In
one measured build week:

| What happened | Number |
|---|---|
| Lanes run in parallel | **12** |
| Adversarial review gates passed through | **22** |
| Tests on one repo, before → after | **138 → 1264** |
| Agents killed mid-run by usage caps, with work lost | **2 killed, 0 lost** |
| Production-repo merges auto-merged by mistake | **0** (one correctly parked for a human) |

The one receipt with a public, reproducible source: the **138 → 1264** test
growth was on [`github.com/derrtaderr/gtm-architect`](https://github.com/derrtaderr/gtm-architect)
— clone it and run its suite to check the number yourself. The other figures are
from the same build week's private lanes. No demo can fake a track record, and
the engine below is the runnable proof of the rigor behind these numbers.

## Two honestly-different halves

This repo is deliberately split, and the split is the whole point:

1. **The gate engine — runnable, tested, zero-dependency code** (`lib/`, `test/`).
   The merge gate and the lane/queue/metrics parsers. Clone it, run the tests,
   run the gate against a fixture, get a verdict. This is the installable core.

2. **The orchestration contract — documented templates, NOT self-running code**
   (`templates/`, `docs/`). The dispatch procedure, the execution-agent contract,
   the reviewer contract, the fix-wave discipline. These **require an agent
   runtime** (Claude Code or a similar harness) to execute. They ship as
   adoptable templates and methodology. There is no `npm install` that makes this
   repo orchestrate agents by itself — running agents is your harness's job, and
   these documents are what you bind those agents to.

If you only want the gate, you never need an agent at all. If you want the whole
loop, the templates tell your harness how to drive it.

## Quickstart (the runnable half)

Requires Node 18+. No dependencies to install.

```bash
git clone <this-repo> ship-check
cd ship-check
npm test                       # 131 tests, zero dependencies
```

Run the gate. It takes five pieces of evidence and returns one verdict:

```bash
node lib/lane-report.mjs --gate --repo my-service \
  --has-tests yes --tests-pass yes \
  --ship-check-passed yes \
  --ship-check-agent reviewer-1 --build-agent builder-1 \
  --scope-clean yes
# => AUTO-MERGE
```

Flip any input and watch it park, naming every reason:

```bash
node lib/lane-report.mjs --gate --repo my-service \
  --has-tests no --tests-pass yes \
  --ship-check-passed yes \
  --ship-check-agent builder-1 --build-agent builder-1 \
  --scope-clean yes
# => PARKED
#    - no tests in the build, so green means nothing ran
#    - ship-check ran as the build agent, so the lane blessed its own work
```

Read the board from a synthetic lane-state fixture:

```bash
node lib/lane-report.mjs --status examples/lane-state.md --today 2026-08-27
node lib/lane-report.mjs --eligible examples/build-queue.md examples/lane-state.md
node lib/lane-report.mjs --cap examples/lane-state.md
```

See [`WALKTHROUGH.md`](WALKTHROUGH.md) for one lane's full life — dispatch, spec
commit, TDD cycles, a reviewer finding a real bug, the fix wave, the re-gate, the
merge, and the audit — with every command run live against `examples/`.

## The gate, in one paragraph

A lane auto-merges only when **all five** hold: the build has tests and they pass;
an independent ship-check passed; the ship-check agent is a different agent from
the one that wrote the code (no self-bless — a missing identity is itself a
block); the target repo is not in the protected set; and the diff stayed in
scope. Anything else parks the lane as a PR waiting for a human. Every failing
gate is reported, not just the first. The protected set (`PRODUCTION_REPOS` in
`lib/lane-tally.mjs`) ships with neutral example names — **edit it to your own
blast-radius repos.**

## The templates (the documented half)

Adopt these into your own agent harness. They are written for a stranger running
their own Claude Code (or similar) setup to drop in.

- [`templates/dispatch-procedure.md`](templates/dispatch-procedure.md) — what the
  orchestrator does to launch lanes, gate them, and route fix waves.
- [`templates/execution-agent-contract.md`](templates/execution-agent-contract.md)
  — the four binding commitments a code-writing agent works under (spec first,
  TDD commit-per-cycle, never leave the worktree, report as data).
- [`templates/reviewer-contract.md`](templates/reviewer-contract.md) — the
  independent adversarial reviewer's discipline and its two-word verdict.
- [`templates/lane-state-schema.md`](templates/lane-state-schema.md) — the field
  contract for the `lane-state.md` the engine reads.

## Architecture

The engine is two modules: pure rules (`lib/lane-tally.mjs`, no I/O) and the CLI
that is their only caller (`lib/lane-report.mjs`). Full reference, including the
self-correcting concurrency cap and the parser's fail-loud design, is in
[`docs/architecture.md`](docs/architecture.md). The one-definition-of-today
helper and the UTC bug it fixes are in [`docs/local-date.md`](docs/local-date.md).

## Not to be confused with

[`earn-autonomy`](https://github.com/derrtaderr/earn-autonomy) is a sibling
project about an eval-gated **autonomy trust ladder** — when an agent earns the
right to run unattended over time. This repo is the other axis: a multi-agent
**software-delivery loop with adversarial review gates** — how a single
agent-authored change earns its way into the main branch.

## License

MIT © Jason Derr. See [LICENSE](LICENSE).
