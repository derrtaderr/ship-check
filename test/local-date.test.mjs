// Tests for the engine's one definition of "today".
// Run: node --test test/local-date.test.mjs
// Docs: docs/local-date.md
//
// Forced through two zones 26 hours apart, so their calendar dates can never
// coincide and a UTC-based implementation cannot pass both. Expectations are
// computed independently via Intl rather than hard-coded, so each test states
// the rule instead of one answer.
import { test } from "node:test";
import assert from "node:assert/strict";
import { localToday } from "../lib/local-date.mjs";

const DATE_FMT = { year: "numeric", month: "2-digit", day: "2-digit" };
const ZONES = ["Etc/GMT+12", "Etc/GMT-14"]; // UTC-12 and UTC+14
const evening = new Date("2026-09-01T04:30:00Z"); // 2026-08-31 21:30 US Pacific

test("localToday returns the local calendar date in every zone, never the UTC one", () => {
  const original = process.env.TZ;
  try {
    const seen = new Set();
    for (const tz of ZONES) {
      process.env.TZ = tz;
      const expected = new Intl.DateTimeFormat("en-CA", DATE_FMT).format(evening);
      seen.add(expected);
      assert.equal(localToday(evening), expected);
    }
    // Guard the guard: if both zones agreed, the case would prove nothing.
    assert.equal(seen.size, 2, "the two zones must straddle the date boundary");
    assert.ok(seen.has("2026-08-31") && seen.has("2026-09-01"));
  } finally {
    process.env.TZ = original;
  }
});

// The first attempt at this helper reused a module-level formatter's
// resolvedOptions(), which froze the zone at import time. Nothing about a single
// call catches that; only a zone change BETWEEN calls does. This is that case.
test("localToday reads the zone at call time, not at import time", () => {
  const original = process.env.TZ;
  try {
    process.env.TZ = ZONES[0];
    const first = localToday(evening);
    process.env.TZ = ZONES[1];
    const second = localToday(evening);
    assert.notEqual(
      first,
      second,
      "a formatter frozen at import would answer the same in both zones"
    );
  } finally {
    process.env.TZ = original;
  }
});

test("localToday defaults to now and emits a YYYY-MM-DD string", () => {
  assert.match(localToday(), /^\d{4}-\d{2}-\d{2}$/);
});

test("localToday agrees with the ambient zone rather than pinning one", () => {
  // A helper that hard-coded one zone would pass every case above while being
  // wrong on any other machine. Pin the ambient-zone contract.
  const original = process.env.TZ;
  try {
    process.env.TZ = "Asia/Tokyo";
    assert.equal(
      localToday(evening),
      new Intl.DateTimeFormat("en-CA", DATE_FMT).format(evening)
    );
    assert.equal(localToday(evening), "2026-09-01"); // Tokyo is UTC+9
  } finally {
    process.env.TZ = original;
  }
});
