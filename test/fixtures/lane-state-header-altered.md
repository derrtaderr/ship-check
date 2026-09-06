# Lane state (header-altered fixture)

This reproduces the failure where a hand-edit changes the header cell so the
scan that looks for `| lane |` never starts. billing-service below is running,
but a scan scoped to the unaltered header sees no table at all, not an empty
one.

**Cap: 2.** Moves only by the rule in the design doc §8.

| Lane | row | repo | branch | pr | started | shipped | commits | status | sha |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 4 | billing-service | lane/metrics | 12 | 2026-08-27 | — | — | running | — |
