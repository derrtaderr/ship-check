# Lane state (example)

The live record of build lanes. A synthetic, adopt-me example — none of these
repos are real. See `templates/lane-state-schema.md` for the full field
contract.

**Cap: 2.** Moves only by the rule in the design (two clean weeks up, two
stalled lanes down), recorded by the weekly step.

Statuses: `running`, `pr-open`, `shipped`, `stalled`, `parked`.

Do not hand-edit a row while its lane is running. `—` means not yet. The header
row must not be edited: every reader finds this table by scanning for the exact
header cell `lane`, and a renamed cell makes them refuse to run rather than
mistake it for an empty, all-clear board.

| lane | row | repo | branch | pr | started | shipped | commits | status | sha |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 2 | esp | lane/esp-detect | 7 | 2026-08-20 | 2026-08-23 | 14 | shipped | a1b2c3d |
| 2 | 5 | widget-lib | lane/pagination | 11 | 2026-08-24 | 2026-08-25 | 9 | shipped | b2c3d4e |
| 3 | 9 | overlap-mapper | lane/overlap | 9 | 2026-08-26 | — | — | running | — |

## Lane metrics history

One row per week, written before the cap decision. `lane-report.mjs --cap` reads
this table, hands the last two weeks to the cap rule, and prints the
recommendation.

| week-start | started | shipped | stalled | cap-after |
|---|---|---|---|---|
| 2026-08-17 | 2 | 2 | 0 | 2 |
| 2026-08-24 | 2 | 2 | 0 | 2 |
