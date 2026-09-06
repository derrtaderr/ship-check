# local-date: one definition of "today"

Every part of the engine that stamps or compares a calendar date reads it from
`lib/local-date.mjs`. This file explains why that helper exists and what its two
load-bearing properties are.

## The bug it fixes

`new Date().toISOString().slice(0, 10)` returns the **UTC** calendar date. On any
machine west of UTC, an evening run computes against tomorrow. A lane started
seven days ago then reads as eight days old, trips the stall threshold a day
early, and drags the cap down on a lane that was still healthy. This bug shipped
independently more than once in the source system before it was traced to the
UTC-vs-local gap — and notably, a lane's own passing test suite did not catch it,
because the tests ran in whatever single zone the machine happened to be in.

`localToday(now = new Date())` returns the **local** calendar date instead, using
`Intl.DateTimeFormat("en-CA", …)`, which formats as `YYYY-MM-DD`.

## Two load-bearing properties

1. **The formatter is built fresh on every call**, so the ambient time zone is
   read at call time. A module-level formatter freezes the zone at import and
   ignores a later change. The first attempt at this helper did exactly that, via
   a cached `resolvedOptions()`, and a between-calls zone-change test caught it.
   Do not hoist the formatter.
2. **No time zone is pinned.** The ambient zone is the answer. Pinning a specific
   zone would be wrong the first time a script runs elsewhere, and it would make
   the tests tautological — they would pass by sharing the implementation's
   assumption instead of checking it independently.

## How the tests guard it

The regression tests force the code through two zones 26 hours apart
(`Etc/GMT+12` and `Etc/GMT-14`), whose calendar dates can never coincide, so a
UTC-based implementation cannot pass both. The expected date is computed
independently through `Intl` with an explicit `timeZone`, so the test cannot pass
by making the same mistake as the code. A guard asserts the two zones actually
landed on different days, so the case can never go vacuously green.

## What this is NOT for

This is not for arithmetic on a date the caller already has. Adding days to a
known date should stay anchored in UTC on both ends, because local-time
arithmetic across a daylight-saving boundary can roll back a day. `localToday` is
only for the single question "what day is it here, now."
