# SPEC — the lane engine extract

This repository is an **extract** of a multi-agent software-delivery loop that
has been running in production inside a private operating vault. A single build
week put twelve lanes through twenty-two adversarial review gates, took one repo
from 138 to 1264 tests, survived two agents being killed mid-run by usage caps
with zero work lost, and correctly parked a production repo's merge for a human.
This repo brings the reusable core of that system across so a stranger can adopt
it.

## The one load-bearing decision: two honestly-different halves

The system splits into two parts, and this repo presents them as such. Blurring
the line is the single failure that would sink the extract.

### Half 1 — the gate engine (runnable, tested, zero-dependency code)

The deterministic merge gate and the lane/queue/metrics parsers. This is the
installable core. It already existed and was already tested; here it is brought
across, genericized, and made runnable from a clean clone with `node --test` and
no dependencies. A stranger clones, runs the tests, and runs the gate against a
synthetic lane-state fixture to get a real verdict.

The gate's verdicts are the real logic and are kept faithful:

- **AUTO-MERGE** only when all of: the build has tests and they pass; an
  independent ship-check passed; the ship-check agent differs from the build
  agent (no self-bless); the repo is not in the protected/production set; the
  diff stayed in scope.
- **PARKED** otherwise, with every failing reason collected (not
  short-circuited), so one run names everything wrong with the lane.

### Half 2 — the orchestration contract (documented templates, NOT self-running code)

The dispatch procedure, the execution-agent contract, the reviewer contract, and
the fix-wave discipline. These **require an agent runtime** (Claude Code or a
similar harness) to execute. They cannot run themselves and this repo never
pretends they can. They ship as adoptable templates plus methodology under
`templates/` and `docs/`. There is no `npm install && it orchestrates agents`.
Claiming otherwise is the failure this spec exists to forbid.

The receipts sit above the fold in the README as the flex; the engine is the
runnable proof-of-rigor beneath them.

## What is runnable vs documented

| Part | Location | Runnable? |
|---|---|---|
| Merge gate + parsers (rules) | `lib/lane-tally.mjs` | Yes, pure functions, tested |
| Report/gate CLI | `lib/lane-report.mjs` | Yes, `node lib/lane-report.mjs …` |
| Local-date helper | `lib/local-date.mjs` | Yes, tested |
| Test suite | `test/` | Yes, `node --test` |
| Synthetic fixtures/examples | `test/fixtures/`, `examples/` | Yes, input data |
| Execution-agent contract | `templates/execution-agent-contract.md` | No — needs an agent harness |
| Reviewer contract | `templates/reviewer-contract.md` | No — needs an agent harness |
| Dispatch procedure | `templates/dispatch-procedure.md` | No — needs an agent harness |
| Lane-state schema | `templates/lane-state-schema.md` | Documentation |

## The genericization pass

The source lived in a personal vault and named private repos, brands, people,
and file paths. Every such reference is replaced before it ships:

- The protected/production repo set is replaced with neutral example names
  (`billing-service`, `payments-api`, `checkout-web`, `user-directory`,
  `data-pipeline`, `core-platform`) and documented as a list the adopter edits
  to their own protected repos. The mechanism — a named-exclusion list that
  keeps blast-radius repos on human-merge — is preserved exactly.
- Fixture repo names are neutral (`esp`, `overlap-mapper`, `event-router`,
  `widget-lib`, `command-center`, `repo-a`, `repo-b`, `billing-service`,
  `payments-api`).
- Default file paths resolve against the current working directory
  (`./lane-state.md`, `./build-queue.md`) instead of a hard-wired vault subtree.
- Three tests in the source read live vault files as regression guards. Those
  are inherently coupled to a private tree and are dropped; the fixture-based
  coverage they sat beside is kept in full.
- Comment references to private command names and doc paths are rewritten to
  this repo's own docs.

A tree-wide sweep for the private tokens must return zero hits in shipped files,
tests included.

## What this is NOT (differentiation from prior art)

A public sibling, `earn-autonomy`, is an eval-gated **autonomy trust ladder** —
when an agent earns the right to run unattended. This repo is a different thing:
a multi-agent **software-delivery loop with adversarial review gates** — how
agent-authored code earns a merge. One is about trust granted over time; this
one is about a single change earning its way in. The README draws the line and
cross-links rather than overlapping.

## Faithfulness note (no new business logic)

This is an extraction, not a new build. No new gate rule or parser behavior is
authored here. The engine keeps its own comprehensive test suite, which is the
evidence of faithfulness: it passes from a clean clone, and the genericization
is a rename refactor that keeps every test green throughout. There is therefore
no meaningful new-code red-first cycle to stage — reverting the engine yields a
module-not-found, not a substantive failing assertion. The report states this
plainly rather than dressing an extract up as green new work.
