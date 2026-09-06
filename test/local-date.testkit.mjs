// Shared harness for the timezone-forcing regression tests that guard the
// engine's default notion of "today". Not a test file — imported by the CLI
// smoke tests, so the guard is written once and cannot drift into several
// slightly different versions of itself.
// Docs: docs/local-date.md
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

// 26 hours apart, so their calendar dates can never coincide. Whatever the UTC
// date is, it matches at most one of these, so a UTC default cannot pass both.
export const ZONES = ["Etc/GMT+12", "Etc/GMT-14"]; // UTC-12 and UTC+14

const DATE_FMT = { year: "numeric", month: "2-digit", day: "2-digit" };

// The expectation is computed here with an EXPLICIT timeZone, while the code
// under test reads the ambient zone. Two different paths to the same answer, so
// the test cannot pass by sharing the implementation's mistake.
export const dateIn = (tz, at = new Date()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: tz, ...DATE_FMT }).format(at);

// Runs a CLI with TZ forced in the CHILD's environment, and returns the two
// dates that were current in that zone immediately before and after the run.
// A test that straddles midnight then has two acceptable answers instead of a
// flake, without ever accepting a wrong one.
export function runInZone(cli, tz, args) {
  const before = dateIn(tz);
  let result;
  try {
    result = {
      status: 0,
      stdout: execFileSync(process.execPath, [cli, ...args], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, TZ: tz },
      }),
      stderr: "",
    };
  } catch (err) {
    result = { status: err.status ?? 1, stdout: err.stdout ?? "", stderr: err.stderr ?? "" };
  }
  return { ...result, acceptable: [before, dateIn(tz)] };
}

// Guard the guard. If the two zones ever agreed, every assertion above would
// still pass while proving nothing at all.
export function assertZonesStraddle(values) {
  assert.equal(
    new Set(values).size,
    2,
    `the two forced zones must land on different days, else the case is vacuous (got ${JSON.stringify(values)})`
  );
}
