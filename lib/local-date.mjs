// local-date: one definition of "today" for every instrument that stamps or
// compares a calendar date.
//
// `new Date().toISOString().slice(0, 10)` is the UTC calendar date, so any
// evening run west of UTC computed against TOMORROW. That bug shipped twice in
// the source system and aged lanes by an extra day, flagging a lane as stalled
// a day early. See docs/local-date.md before changing anything here.
//
// This is NOT for arithmetic on a date the caller already has. Adding days to a
// known date should stay anchored in UTC on both ends, because local-time
// arithmetic across a DST boundary can roll back a day.
//
// en-CA formats as YYYY-MM-DD, the shape every table and readout here uses.

const LOCAL_DATE_OPTS = { year: "numeric", month: "2-digit", day: "2-digit" };

// Two properties here are load-bearing.
//
// The formatter is built fresh on every call, so the ambient zone is read at CALL
// time. A module-level formatter freezes the zone at import and ignores a later
// change — the first attempt at this helper did exactly that, via a cached
// resolvedOptions(), and the timezone-forcing test caught it. Do not hoist it.
//
// No timeZone is pinned. The ambient zone IS the answer. Pinning a specific zone
// would be wrong the first time a script runs elsewhere and would make the tests
// tautological.
export function localToday(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", LOCAL_DATE_OPTS).format(now);
}
