// Smoke tests for the lane-report CLI, invoking it as a child process and
// asserting on stdout, stderr and exit code. lane-tally.test.mjs covers the pure
// functions. Every case passes explicit fixture paths, so no test can fall back
// to a default lane-state.md, except the one that deliberately exercises the
// working-directory default.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { ZONES, runInZone, assertZonesStraddle } from "./local-date.testkit.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const cli = join(here, "..", "lib", "lane-report.mjs");
const lanes = join(here, "fixtures", "lane-state-sample.md");
const queue = join(here, "fixtures", "queue-sample.md");
const headerAltered = join(here, "fixtures", "lane-state-header-altered.md");
const examplesDir = join(here, "..", "examples");

function run(args) {
  try {
    const stdout = execFileSync(process.execPath, [cli, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { status: 0, stdout, stderr: "" };
  } catch (e) {
    return { status: e.status, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
}

test("--eligible names a launchable row", () => {
  const r = run(["--eligible", queue, lanes]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /ESP provider-detection/);
  assert.doesNotMatch(r.stdout, /Metrics definitions/, "its repo is claimed by a running lane");
});

test("--status lists open lanes and marks the stalled one", () => {
  const r = run(["--status", lanes, "--today", "2026-08-27"]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /overlap-mapper/);
  assert.match(r.stdout, /stalled/i);
});

test("--metrics prints all four numbers", () => {
  const r = run(["--metrics", lanes, "--today", "2026-08-27"]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /started\D+3/i);
  assert.match(r.stdout, /shipped\D+1/i);
  assert.match(r.stdout, /stalled\D+1/i);
  assert.match(r.stdout, /median\D+14/i);
});

test("no mode is a usage error, not a crash", () => {
  const r = run([]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /usage/i);
});

test("an unreadable file exits 2 without a stack trace", () => {
  const r = run(["--status", join(here, "fixtures", "does-not-exist.md")]);
  assert.equal(r.status, 2);
  assert.doesNotMatch(r.stderr, /at Object|node:internal/);
});

test("--metrics --since excludes lanes started and shipped before the window", () => {
  // All three fixture lanes started on or before 2026-08-27. --since
  // 2026-08-28 is after every started/shipped date in the fixture, so a
  // correctly wired flag drops started and shipped to 0 while stalled (which
  // is deliberately unscoped) still reports the overdue overlap-mapper lane.
  const r = run(["--metrics", lanes, "--today", "2026-08-27", "--since", "2026-08-28"]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /started\D+0/i);
  assert.match(r.stdout, /shipped\D+0/i);
  assert.match(r.stdout, /stalled\D+1/i, "stalled is unscoped by since");
  assert.match(r.stdout, /since 2026-08-28/, "the window shows up in the output");
});

test("--metrics without --since is unscoped and includes older lanes", () => {
  const r = run(["--metrics", lanes, "--today", "2026-08-27"]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /started\D+3/i);
  assert.match(r.stdout, /shipped\D+1/i);
  assert.doesNotMatch(r.stdout, /since /i, "no window line when --since is absent");
});

test("a bad --today fails loudly rather than degrading the stall count", () => {
  const r = run(["--metrics", lanes, "--today", "27-08-2026"]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--today/);
});

test("a bad --since fails loudly and names the flag", () => {
  const r = run(["--metrics", lanes, "--today", "2026-08-27", "--since", "28-08-2026"]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--since/);
});

// --landed: the audit calls the shipped-lane report "the only place an
// auto-merge becomes visible," and that only works if the shipped lane actually
// appears in a report. --status filters to running and pr-open only, so it can
// never surface a shipped lane; --landed is the mode built to close that hole.

test("--landed lists a shipped lane whose shipped date falls inside the window", () => {
  const r = run(["--landed", lanes, "--since", "2026-08-20"]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /Lane 2/);
  assert.match(r.stdout, /row 2/);
  assert.match(r.stdout, /esp/);
  assert.match(r.stdout, /PR 7/);
  assert.match(r.stdout, /14 commits/);
});

test("--landed excludes a shipped lane whose shipped date falls before the window", () => {
  const r = run(["--landed", lanes, "--since", "2026-08-24"]);
  assert.equal(r.status, 0);
  assert.doesNotMatch(r.stdout, /Lane 2/);
  assert.match(r.stdout, /nothing landed/i);
});

test("--landed without --since is a usage error, not a silent full-history dump", () => {
  const r = run(["--landed", lanes]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--since/);
});

test("--landed with a malformed --since fails loudly and names the flag", () => {
  const r = run(["--landed", lanes, "--since", "28-08-2026"]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--since/);
});

const GATE_GREEN = [
  "--gate",
  "--repo", "esp",
  "--has-tests", "yes",
  "--tests-pass", "yes",
  "--ship-check-passed", "yes",
  "--ship-check-agent", "user-advocate-1",
  "--build-agent", "execution-agent-1",
  "--scope-clean", "yes",
];

function gate(overrides = {}) {
  const args = [...GATE_GREEN];
  for (const [flag, value] of Object.entries(overrides)) {
    const i = args.indexOf(flag);
    if (value === null) args.splice(i, 2);
    else args[i + 1] = value;
  }
  return run(args);
}

test("--gate prints AUTO-MERGE for a green lane on a greenfield repo, exit 0", () => {
  const r = gate();
  assert.equal(r.status, 0);
  assert.match(r.stdout, /AUTO-MERGE/);
  assert.doesNotMatch(r.stdout, /PARKED/);
});

test("--gate exits 0 on a parked lane, because parking is a normal outcome", () => {
  const r = gate({ "--has-tests": "no" });
  assert.equal(r.status, 0, "a parked lane is not an error");
  assert.match(r.stdout, /PARKED/);
  assert.match(r.stdout, /no tests/i);
});

test("--gate prints every failing reason on its own line", () => {
  const r = gate({ "--repo": "billing-service", "--has-tests": "no", "--scope-clean": "no" });
  assert.equal(r.status, 0);
  const reasons = r.stdout.split("\n").filter((l) => l.startsWith("- "));
  assert.equal(reasons.length, 3, `expected three reason lines, got: ${r.stdout}`);
  assert.ok(reasons.some((l) => /no tests/i.test(l)));
  assert.ok(reasons.some((l) => /protected/i.test(l)));
  assert.ok(reasons.some((l) => /scope/i.test(l)));
});

test("--gate parks a protected repo even when everything else is green", () => {
  const r = gate({ "--repo": "payments-api" });
  assert.match(r.stdout, /PARKED/);
  assert.match(r.stdout, /protected/i);
});

test("--gate parks a lane that blessed its own work", () => {
  const r = gate({ "--ship-check-agent": "execution-agent-1" });
  assert.match(r.stdout, /PARKED/);
  assert.match(r.stdout, /own work/i);
});

for (const flag of [
  "--repo",
  "--has-tests",
  "--tests-pass",
  "--ship-check-passed",
  "--ship-check-agent",
  "--build-agent",
  "--scope-clean",
]) {
  test(`--gate exits 1 when ${flag} is missing, rather than defaulting to permissive`, () => {
    const r = gate({ [flag]: null });
    assert.equal(r.status, 1, `omitting ${flag} must be a usage error, got exit ${r.status}: ${r.stdout}`);
    assert.match(r.stderr, new RegExp(flag.replace(/-/g, "\\-")));
    assert.doesNotMatch(r.stdout, /AUTO-MERGE/, "a missing flag must never produce an auto-merge");
  });
}

test("--gate rejects a yes/no flag carrying anything else", () => {
  const r = gate({ "--tests-pass": "true" });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /yes or no/);
});

// --cap: capRecommendation and isCleanWeek execute against recorded history.
const capClean = join(here, "fixtures", "lane-state-cap-clean.md");
const capStalled = join(here, "fixtures", "lane-state-cap-stalled.md");
const capEmpty = join(here, "fixtures", "lane-state-sample.md");

test("--cap raises the cap after two consecutive clean weeks", () => {
  const r = run(["--cap", capClean]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /current cap: 2/);
  assert.match(r.stdout, /recommended cap: 3/);
  assert.match(r.stdout, /two consecutive clean weeks/);
});

test("--cap drops the cap after a week with two stalled lanes", () => {
  const r = run(["--cap", capStalled]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /current cap: 3/);
  assert.match(r.stdout, /recommended cap: 2/);
  assert.match(r.stdout, /stalled/);
});

test("--cap holds the cap when there is no history to move it", () => {
  const r = run(["--cap", join(here, "fixtures", "lane-state-cap-empty.md")]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /weeks read: none yet/);
  assert.match(r.stdout, /current cap: 2/);
  assert.match(r.stdout, /recommended cap: 2/);
});

test("--cap exits 2 when the file carries no cap line", () => {
  const r = run(["--cap", capEmpty]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /Cap/);
});

test("--cap refuses to move the cap on a malformed history row", () => {
  const r = run(["--cap", join(here, "fixtures", "lane-state-cap-malformed.md")]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /Malformed metrics history/);
});

test("--cap reads ./lane-state.md by default, resolved against the working directory", () => {
  // Regression for a default path that silently required a specific cwd. Run
  // with cwd set to examples/, which ships a lane-state.md, and confirm the
  // default resolves there rather than reading nothing.
  const r = (() => {
    try {
      return { status: 0, stdout: execFileSync(process.execPath, [cli, "--cap"], { encoding: "utf8", cwd: examplesDir, stdio: ["ignore", "pipe", "pipe"] }) };
    } catch (e) {
      return { status: e.status, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
    }
  })();
  assert.equal(r.status, 0, `the default must resolve against cwd: ${r.stderr ?? ""}`);
  assert.match(r.stdout, /current cap: \d/);
});

test("an unknown flag is a usage error rather than a silent fallback to the default files", () => {
  const r = run(["--status", lanes, "--nope"]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Unknown flag/);
});

test("--status never prints Lane NaN for a row with an unparseable lane number", () => {
  const r = run(["--status", join(here, "fixtures", "lane-state-edge.md"), "--today", "2026-08-27"]);
  assert.equal(r.status, 0);
  assert.doesNotMatch(r.stdout, /Lane NaN/);
  assert.doesNotMatch(r.stdout, /NaN/, "no NaN anywhere in the status output");
  assert.match(r.stdout, /Lane unnumbered/);
});

// A header rename (or a split table) made parseLanes return an empty array, and
// an empty array read downstream as a clean board. --status said "None. All
// lanes are free." and --eligible offered a row whose repo was actually held by
// the running lane hiding under the altered header. Every mode that trusts
// lane-state.md must now refuse to run rather than silently reporting an empty
// board.

test("--status exits 2 and never claims a clean board when the lane header is altered", () => {
  const r = run(["--status", headerAltered, "--today", "2026-08-27"]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /No lane table found/);
  assert.match(r.stderr, new RegExp(headerAltered.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(r.stdout, /All lanes are free/, "an unreadable table must never read as a clean board");
});

test("--eligible exits 2 rather than offering a row whose repo is actually held", () => {
  const r = run(["--eligible", queue, headerAltered]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /No lane table found/);
  assert.doesNotMatch(r.stdout, /Launchable rows/);
});

test("--landed exits 2 when the lane header is altered", () => {
  const r = run(["--landed", headerAltered, "--since", "2026-08-01"]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /No lane table found/);
});

test("--cap exits 2 when the lane header is altered, even though the cap line itself is fine", () => {
  const r = run(["--cap", headerAltered]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /No lane table found/);
});

// --- the default --today ---
// Lane age, the stall flag and the metrics window all hang off this date. A UTC
// default aged every lane by an extra day on any evening run west of UTC, which
// is how a lane one day short of the stall threshold gets reported as stalled.
// Forced through two zones 26 hours apart, so a UTC default cannot pass both.
// Docs: docs/local-date.md.

const STARTED = "2026-08-14"; // lane 3, overlap-mapper, in the fixture
const ageOn = (date) => Math.round((Date.parse(date) - Date.parse(STARTED)) / 86400000);

test("the default --today is the LOCAL calendar date, never the UTC one", () => {
  const seen = [];
  for (const tz of ZONES) {
    const r = runInZone(cli, tz, ["--status", lanes]);
    assert.equal(r.status, 0, r.stderr);
    const m = /overlap-mapper[^\n]*?(\d+)d old/.exec(r.stdout);
    assert.ok(m, `--status must report the lane's age, got: ${r.stdout}`);
    const acceptable = r.acceptable.map(ageOn);
    assert.ok(
      acceptable.includes(Number(m[1])),
      `in ${tz} the lane should read ${acceptable.join(" or ")}d old, got ${m[1]}d`
    );
    seen.push(r.acceptable[0]);
  }
  assertZonesStraddle(seen);
});

test("--today still overrides the default, and still rejects a non-date, in any zone", () => {
  for (const tz of ZONES) {
    const ok = runInZone(cli, tz, ["--status", lanes, "--today", "2026-08-27"]);
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(ok.stdout, /overlap-mapper[^\n]*?13d old/);

    const bad = runInZone(cli, tz, ["--status", lanes, "--today", "not-a-date"]);
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /--today needs a YYYY-MM-DD date/);
  }
});
