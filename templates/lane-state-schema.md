# Lane-state schema

`lane-state.md` is the live record of build lanes — the file the engine reads to
decide what is running, which repos are claimed, and how the cap should move. It
is a plain markdown file, hand-editable, holding two named tables plus one cap
line. A working example ships at `examples/lane-state.md`.

The engine finds each table by scanning for its exact header cell, so the two
tables never read each other's rows and prose around them is ignored. **The
header rows must not be renamed.** A renamed `lane` header makes every reader
refuse to run rather than mistake the file for an empty, all-clear board.

## The cap line

One line, anywhere above the lane table:

```
**Cap: 2.**
```

The number is the current maximum of concurrent lanes. `--cap` reads it,
compares it against the metrics history, and prints a recommendation; the weekly
review writes the recommendation back into this line.

## The lane table

Found by the header cell `lane`. Exactly ten columns, in this order:

| column | meaning |
|---|---|
| `lane` | integer lane id |
| `row` | the build-queue row number this lane is building |
| `repo` | target repo name |
| `branch` | the lane's branch |
| `pr` | PR number, or `—` until one is open |
| `started` | `YYYY-MM-DD` the lane launched |
| `shipped` | `YYYY-MM-DD` it merged, or `—` |
| `commits` | commit count at merge, or `—` |
| `status` | one of `running`, `pr-open`, `shipped`, `stalled`, `parked` |
| `sha` | the squash-merge commit, or `—`, for the post-merge audit |

`—` means "not yet" and parses as null everywhere downstream. A cell holding a
literal `—` in a numeric column is null, never zero.

**Malformed rows are flagged, not dropped.** A row with the wrong column count,
a non-integer id, an unknown status, or an open (`running`/`pr-open`) lane with
no `started` date is kept and surfaced in `--status` with a reason, and the
launcher halts on it. A dropped lane is an invisible lane, and an invisible
running lane defeats the repo-independence check — so the parser never silently
discards a row it cannot read.

Only a `shipped` lane releases its repo. `running`, `pr-open`, `parked`, and
`stalled` all still hold an open PR against their repo, so a second lane may not
launch against a repo any of them claims.

Example:

```
| lane | row | repo | branch | pr | started | shipped | commits | status | sha |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 2 | esp | lane/esp-detect | 7 | 2026-08-20 | 2026-08-23 | 14 | shipped | a1b2c3d |
| 3 | 9 | overlap-mapper | lane/overlap | 9 | 2026-08-26 | — | — | running | — |
```

## The metrics-history table

Found by the header cell `week-start`. One row per week, appended by the weekly
review before it decides the cap. Five columns:

| column | meaning |
|---|---|
| `week-start` | `YYYY-MM-DD` Monday of the week |
| `started` | lanes launched that week |
| `shipped` | lanes that shipped that week |
| `stalled` | lanes stalled that week |
| `cap-after` | the cap the week ended on |

`--cap` hands the last two weeks to the cap rule: two consecutive **clean** weeks
(zero stalled, at least one launched, every launched lane shipped) raise the cap
by one to a maximum of three; any single week with two or more stalled lanes
drops it by one to a minimum of one.

Example:

```
| week-start | started | shipped | stalled | cap-after |
|---|---|---|---|---|
| 2026-08-17 | 2 | 2 | 0 | 2 |
| 2026-08-24 | 2 | 2 | 0 | 2 |
```
