# Lane state (example, after the command-center lane merged)

The same board as `examples/lane-state.md`, one step later: the command-center
lane (row 11) has passed the gate and merged, so it now sits in the table as
`shipped` with its squash sha recorded. This snapshot exists so the walkthrough's
post-merge audit runs against a real file.

**Cap: 2.**

| lane | row | repo | branch | pr | started | shipped | commits | status | sha |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 2 | esp | lane/esp-detect | 7 | 2026-08-20 | 2026-08-23 | 14 | shipped | a1b2c3d |
| 2 | 5 | widget-lib | lane/pagination | 11 | 2026-08-24 | 2026-08-25 | 9 | shipped | b2c3d4e |
| 3 | 9 | overlap-mapper | lane/overlap | 9 | 2026-08-26 | — | — | running | — |
| 4 | 11 | command-center | lane/map-render | 14 | 2026-08-27 | 2026-08-27 | 12 | shipped | c0ffee1 |

## Lane metrics history

| week-start | started | shipped | stalled | cap-after |
|---|---|---|---|---|
| 2026-08-17 | 2 | 2 | 0 | 2 |
| 2026-08-24 | 2 | 2 | 0 | 2 |
