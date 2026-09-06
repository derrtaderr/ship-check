// Unit tests for lane-tally pure functions. Every case passes an explicit
// fixture path. Nothing here reads a live lane-state.md.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseLanes, serializeLanes, LANE_STATUSES, parseQueueRows, activeRepos, eligibleRows, rankRows, parseMetricsHistory, parseCap, laneTableFound } from "../lib/lane-tally.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const sample = readFileSync(join(here, "fixtures", "lane-state-sample.md"), "utf8");
const edge = readFileSync(join(here, "fixtures", "lane-state-edge.md"), "utf8");
const queue = readFileSync(join(here, "fixtures", "queue-sample.md"), "utf8");
const headerAltered = readFileSync(join(here, "fixtures", "lane-state-header-altered.md"), "utf8");

test("parses every well-formed lane row", () => {
  const lanes = parseLanes(sample);
  assert.equal(lanes.length, 3);
  assert.equal(lanes[0].repo, "billing-service");
  assert.equal(lanes[0].pr, 12);
  assert.equal(lanes[0].shipped, null);
  assert.equal(lanes[1].commits, 14);
  assert.equal(lanes[1].status, "shipped");
});

test("an em-dash cell becomes null, not the string", () => {
  const lanes = parseLanes(sample);
  assert.equal(lanes[0].commits, null);
  assert.notEqual(lanes[0].commits, "—");
});

test("malformed rows are flagged, never thrown on", () => {
  const lanes = parseLanes(edge);
  const flagged = lanes.filter((l) => l.malformed);
  assert.equal(flagged.length, 6);
  assert.ok(flagged.some((l) => /column/.test(l.malformed)));
  assert.ok(flagged.some((l) => /lane number/.test(l.malformed)));
  assert.ok(flagged.some((l) => /status/.test(l.malformed)));
  assert.ok(flagged.some((l) => /row field/.test(l.malformed)));
  assert.ok(flagged.some((l) => /pr field/.test(l.malformed)));
  assert.ok(flagged.some((l) => /commits field/.test(l.malformed)));
});

test("malformed numeric fields are null, not NaN, for downstream arithmetic", () => {
  const lanes = parseLanes(edge);
  const malformed = lanes.filter((l) => l.malformed);
  for (const lane of malformed) {
    // row, pr, commits must be null (or integer) never NaN, so arithmetic operations don't get poisoned
    if (lane.malformed.includes("row field")) {
      assert.ok(lane.row === null, `malformed row field must be null, not ${lane.row}`);
      assert.ok(!Number.isNaN(lane.row), `row must not be NaN`);
    }
    if (lane.malformed.includes("pr field")) {
      assert.ok(lane.pr === null, `malformed pr field must be null, not ${lane.pr}`);
      assert.ok(!Number.isNaN(lane.pr), `pr must not be NaN`);
    }
    if (lane.malformed.includes("commits field")) {
      assert.ok(lane.commits === null, `malformed commits field must be null, not ${lane.commits}`);
      assert.ok(!Number.isNaN(lane.commits), `commits must not be NaN`);
    }
  }
});

test("no row in the edge fixture leaves row, pr or commits as NaN", () => {
  // Regression for the leak where a row with several bad numeric fields
  // (row="bad", pr="abc", commits="xyz" together) only nulled the first one
  // an else-if chain reached and left the rest as NaN. Sweeps every row in
  // the fixture, not just the ones a malformed message happens to name, and
  // uses Number.isNaN explicitly because null and NaN are both falsy.
  const lanes = parseLanes(edge);
  for (const l of lanes) {
    assert.ok(!Number.isNaN(l.row), `row leaked NaN in row: ${l.raw}`);
    assert.ok(!Number.isNaN(l.pr), `pr leaked NaN in row: ${l.raw}`);
    assert.ok(!Number.isNaN(l.commits), `commits leaked NaN in row: ${l.raw}`);
  }
});

test("a good row still parses alongside malformed neighbours", () => {
  const lanes = parseLanes(edge);
  const good = lanes.filter((l) => !l.malformed);
  assert.equal(good.length, 1);
  assert.equal(good[0].repo, "billing-service");
});

test("serialize round-trips a parse", () => {
  const lanes = parseLanes(sample);
  const reparsed = parseLanes(serializeLanes(lanes));
  assert.deepEqual(reparsed, lanes);
});

test("LANE_STATUSES is the closed set the design names", () => {
  assert.deepEqual([...LANE_STATUSES].sort(), [
    "parked",
    "pr-open",
    "running",
    "shipped",
    "stalled",
  ]);
});

test("serialize round-trips malformed rows preserving their original text", () => {
  const lanes = parseLanes(edge);
  const serialized = serializeLanes(lanes);
  const reparsed = parseLanes(serialized);

  const malformed = lanes.filter((l) => l.malformed);
  const reparsedMalformed = reparsed.filter((l) => l.malformed);

  assert.equal(reparsedMalformed.length, malformed.length);

  for (let i = 0; i < malformed.length; i++) {
    const original = malformed[i];
    const roundTripped = reparsedMalformed[i];

    // Guard against undefined-equals-undefined trap: assert raw is a non-empty string
    assert.ok(typeof original.raw === 'string' && original.raw.length > 0,
      `malformed row ${i} must have non-empty raw field in original`);
    assert.ok(typeof roundTripped.raw === 'string' && roundTripped.raw.length > 0,
      `malformed row ${i} must have non-empty raw field after round-trip`);

    // Assert byte-identical preservation
    assert.equal(roundTripped.raw, original.raw,
      `malformed row ${i} raw text must be preserved exactly`);
  }
});

test("parses queue rows and their lane fields", () => {
  const rows = parseQueueRows(queue);
  // The fixture holds 7 rows (2, 4, 6, 8, 7, 9, 10). Rows 10 (a wrapped-header
  // regression case) and 7 (a trailing-prose regression case) are the two the
  // parser used to silently drop.
  assert.equal(rows.length, 7);
  const two = rows.find((r) => r.number === 2);
  assert.equal(two.repo, "esp");
  assert.equal(two.unit, 1);
  assert.equal(two.eligible, true);
});

test("a row with no lane field is not eligible", () => {
  const rows = parseQueueRows(queue);
  const eight = rows.find((r) => r.number === 8);
  assert.equal(eight.repo, null);
  assert.equal(eight.eligible, false);
});

// activeRepos treats every unshipped lane as holding its repo: running,
// pr-open, parked and stalled all keep an open PR. The sample fixture holds no
// parked or stalled lane, so this case covers running/pr-open/shipped; the
// parked and stalled cases are covered further down.
test("activeRepos counts every unshipped lane, and only shipped releases a repo", () => {
  const lanes = parseLanes(sample);
  const repos = activeRepos(lanes);
  assert.ok(repos.has("billing-service"));
  assert.ok(repos.has("overlap-mapper"));
  assert.ok(!repos.has("esp"), "a shipped lane no longer claims its repo");
});

test("a row whose repo is claimed by an active lane is filtered out", () => {
  const rows = parseQueueRows(queue);
  const out = eligibleRows(rows, parseLanes(sample));
  assert.ok(!out.some((r) => r.repo === "billing-service"));
  assert.ok(!out.some((r) => r.repo === "overlap-mapper"));
});

test("a unit over two sessions is filtered out", () => {
  const rows = parseQueueRows(queue);
  const out = eligibleRows(rows, []);
  assert.ok(!out.some((r) => r.number === 9), "unit=3 breaks the two-session rule");
});

test("the shipped lane frees its repo for a new lane", () => {
  const rows = parseQueueRows(queue);
  const out = eligibleRows(rows, parseLanes(sample));
  // Row 10 is genuinely eligible (repo=command-center, unclaimed by any active
  // lane in the sample, unit within the session limit), so it flows through
  // eligibleRows alongside row 2. Row 4 stays excluded (billing-service is
  // claimed) and row 9 stays excluded (unit=3).
  assert.deepEqual(out.map((r) => r.number), [2, 10]);
});

test("ranking preserves the queue's own file order, which the fixture happens to number ascending", () => {
  // rankRows is identity: a row's position in the queue already carries the
  // human's ordering judgement, made when the row was written, so ranking must
  // not re-sort it. This fixture's eligible subset happens to read in ascending
  // row-number order because that is also file order here, not because rankRows
  // sorts by number; a queue with rows out of numeric order would still come
  // back in file order, unsorted.
  const rows = parseQueueRows(queue).filter((r) => r.eligible);
  const ranked = rankRows(rows);
  assert.deepEqual(ranked.map((r) => r.number), [2, 4, 9, 10]);
});

// A header regex that requires the bold to close on the same line
// (`\*\*(\d+)\.\s*(.+?)\*\*\s*$`) silently drops a row whose header wraps across
// two lines: no error, the row simply never exists downstream. The parser makes
// the closing `**` optional so a wrapped header still parses.

test("a wrapped header (bold does not close on the starting line) still parses", () => {
  const rows = parseQueueRows(queue);
  const ten = rows.find((r) => r.number === 10);
  assert.ok(ten, "row 10's wrapped header must still produce a row");
  assert.equal(ten.repo, "command-center");
  assert.equal(ten.unit, 1);
  assert.equal(ten.eligible, true);
  assert.ok(!ten.title.includes("**"), `captured title must not carry a trailing bold marker: ${ten.title}`);
});

test("a normal single-line header still strips its trailing bold marker", () => {
  const rows = parseQueueRows(queue);
  const two = rows.find((r) => r.number === 2);
  assert.equal(two.title, "ESP provider-detection resurrection");
  assert.ok(!two.title.includes("**"));
});

// The wrapped-header fix must not overreach. A single regex with an optional
// closing `**` before `\s*$` backtracks past a REAL closing `**` whenever prose
// follows it on the same line, so the title swallows the marker. Matching
// loosely and cutting the title at the first literal `**` fixes this without
// breaking either of the other two shapes.
test("a header whose closing bold marker is followed by trailing prose does not swallow it into the title", () => {
  const rows = parseQueueRows(queue);
  const seven = rows.find((r) => r.number === 7);
  assert.ok(seven, "row 7 must still produce a row");
  assert.equal(seven.title, "A bold marker inside prose, not a header");
  assert.ok(!seven.title.includes("**"), `captured title must not carry an embedded bold marker: ${seven.title}`);
});

// A lane row malformed for a lane/row/pr/commits reason still has a legible
// status and repo, because only the column-count branch nulls status. That is
// correct and desirable: an invisible running lane must not be missed.
test("a lane malformed for a non-status reason still claims its repo via activeRepos", () => {
  const lanes = parseLanes(edge);
  const apiRow = lanes.find((l) => l.repo === "payments-api");
  assert.ok(apiRow, "the edge fixture must carry the payments-api row this test pins");
  assert.ok(apiRow.malformed, "the payments-api row must actually be malformed for this test to mean anything");
  assert.equal(apiRow.status, "running");
  const repos = activeRepos(lanes);
  assert.ok(repos.has("payments-api"), "a malformed-but-status-legible running row must still claim its repo");
});

import { mergeVerdict, PRODUCTION_REPOS } from "../lib/lane-tally.mjs";

const greenChecks = {
  hasTests: true,
  testsPass: true,
  shipCheckPassed: true,
  shipCheckAgent: "user-advocate-1",
  buildAgent: "execution-agent-1",
  scopeClean: true,
};

test("a green lane on a greenfield repo auto-merges", () => {
  const v = mergeVerdict({ repo: "esp" }, greenChecks);
  assert.equal(v.autoMerge, true);
  assert.deepEqual(v.reasons, []);
});

test("a build with no tests can never auto-merge", () => {
  const v = mergeVerdict({ repo: "esp" }, { ...greenChecks, hasTests: false });
  assert.equal(v.autoMerge, false);
  assert.ok(v.reasons.some((r) => /no tests/i.test(r)));
});

test("a protected repo stays human-merge even when fully green", () => {
  const v = mergeVerdict({ repo: "billing-service" }, greenChecks);
  assert.equal(v.autoMerge, false);
  assert.ok(v.reasons.some((r) => /protected/i.test(r)));
});

test("a lane cannot bless its own work", () => {
  const v = mergeVerdict({ repo: "esp" }, { ...greenChecks, shipCheckAgent: "execution-agent-1" });
  assert.equal(v.autoMerge, false);
  assert.ok(v.reasons.some((r) => /own work/i.test(r)));
});

test("scope drift blocks the merge", () => {
  const v = mergeVerdict({ repo: "esp" }, { ...greenChecks, scopeClean: false });
  assert.equal(v.autoMerge, false);
  assert.ok(v.reasons.some((r) => /scope/i.test(r)));
});

test("every failing gate is reported, not just the first", () => {
  const v = mergeVerdict({ repo: "billing-service" }, { ...greenChecks, hasTests: false, scopeClean: false });
  assert.equal(v.autoMerge, false);
  assert.equal(v.reasons.length, 3);
});

test("the protected set is exactly what the engine names", () => {
  assert.deepEqual([...PRODUCTION_REPOS].sort(), [
    "billing-service",
    "checkout-web",
    "core-platform",
    "data-pipeline",
    "payments-api",
    "user-directory",
  ]);
});

test("the three collected reasons are distinct gates, not one message repeated", () => {
  const v = mergeVerdict({ repo: "billing-service" }, { ...greenChecks, hasTests: false, scopeClean: false });
  assert.equal(v.reasons.length, 3);
  assert.equal(new Set(v.reasons).size, 3, "each reason must be unique, not the same gate firing three times");
  assert.ok(v.reasons.some((r) => /no tests/i.test(r)));
  assert.ok(v.reasons.some((r) => /protected/i.test(r)));
  assert.ok(v.reasons.some((r) => /scope/i.test(r)));
});

test("a lane whose ship-check agent differs from the build agent passes that gate", () => {
  const v = mergeVerdict({ repo: "esp" }, { ...greenChecks, shipCheckAgent: "user-advocate-1", buildAgent: "execution-agent-1" });
  assert.equal(v.autoMerge, true);
  assert.ok(!v.reasons.some((r) => /own work/i.test(r)));
});

test("a lane whose ship-check agent equals the build agent fails that gate", () => {
  const v = mergeVerdict({ repo: "esp" }, { ...greenChecks, shipCheckAgent: "execution-agent-1", buildAgent: "execution-agent-1" });
  assert.equal(v.autoMerge, false);
  assert.ok(v.reasons.some((r) => /own work/i.test(r)));
});

test("a non-protected repo is not blocked by the protected gate", () => {
  const v = mergeVerdict({ repo: "esp" }, greenChecks);
  assert.ok(!v.reasons.some((r) => /protected/i.test(r)));
});

import { laneMetrics, isCleanWeek, capRecommendation } from "../lib/lane-tally.mjs";

test("stalled counts open lanes older than seven days", () => {
  const m = laneMetrics(parseLanes(sample), "2026-08-27");
  assert.equal(m.started, 3);
  assert.equal(m.shipped, 1);
  assert.equal(m.stalled, 1, "the pr-open lane from 08-14 is stalled; the 08-27 one is not");
});

test("median commits-to-ship uses only shipped lanes", () => {
  const m = laneMetrics(parseLanes(sample), "2026-08-27");
  assert.equal(m.medianCommitsToShip, 14);
});

test("median is null when nothing has shipped", () => {
  const m = laneMetrics([], "2026-08-27");
  assert.equal(m.medianCommitsToShip, null);
});

test("a clean week has zero stalled and every launched lane shipped", () => {
  assert.equal(isCleanWeek({ started: 2, shipped: 2, stalled: 0 }), true);
  assert.equal(isCleanWeek({ started: 1, shipped: 1, stalled: 0 }), true, "one eligible row can still be clean");
  assert.equal(isCleanWeek({ started: 2, shipped: 1, stalled: 0 }), false);
  assert.equal(isCleanWeek({ started: 2, shipped: 2, stalled: 1 }), false);
});

test("two consecutive clean weeks at 2 unlock the third lane", () => {
  const clean = { started: 2, shipped: 2, stalled: 0 };
  const r = capRecommendation(2, [clean, clean]);
  assert.equal(r.cap, 3);
});

test("one clean week is not enough", () => {
  const clean = { started: 2, shipped: 2, stalled: 0 };
  const dirty = { started: 2, shipped: 1, stalled: 1 };
  assert.equal(capRecommendation(2, [dirty, clean]).cap, 2);
});

test("the cap never exceeds three", () => {
  const clean = { started: 3, shipped: 3, stalled: 0 };
  assert.equal(capRecommendation(3, [clean, clean]).cap, 3);
});

test("two or more stalled lanes drop the cap by one", () => {
  const bad = { started: 3, shipped: 1, stalled: 2 };
  const r = capRecommendation(3, [bad]);
  assert.equal(r.cap, 2);
  assert.ok(/stalled/.test(r.reason));
});

test("the cap never drops below one", () => {
  const bad = { started: 2, shipped: 0, stalled: 2 };
  assert.equal(capRecommendation(1, [bad]).cap, 1);
});

test("isCleanWeek rejects a week where nothing launched, even though 0 equals 0 vacuously", () => {
  assert.equal(isCleanWeek({ started: 0, shipped: 0, stalled: 0 }), false);
});

test("exactly one clean week in history does not raise the cap", () => {
  const clean = { started: 2, shipped: 2, stalled: 0 };
  const r = capRecommendation(2, [clean]);
  assert.equal(r.cap, 2);
});

test("exactly two clean weeks in history raises the cap by exactly one", () => {
  const clean = { started: 2, shipped: 2, stalled: 0 };
  const r = capRecommendation(1, [clean, clean]);
  assert.equal(r.cap, 2);
});

// laneMetrics takes an optional week boundary, or started/shipped accumulate
// forever as lane-state.md grows. Constructed lanes spanning three weeks, not a
// fixture file, because what matters here is the date math, not the markdown
// table shape. `started` scopes on the lane's own started date, `shipped` on
// its shipped date; `stalled` and `medianCommitsToShip` stay unscoped.
const threeWeeksOfLanes = [
  { status: "shipped", started: "2026-08-06", shipped: "2026-08-08", commits: 5, malformed: false },
  { status: "shipped", started: "2026-08-13", shipped: "2026-08-15", commits: 7, malformed: false },
  { status: "shipped", started: "2026-08-20", shipped: "2026-08-22", commits: 9, malformed: false },
];

test("an unscoped call still counts every lane across all three weeks", () => {
  const m = laneMetrics(threeWeeksOfLanes, "2026-08-27");
  assert.equal(m.started, 3);
  assert.equal(m.shipped, 3);
});

test("a since-scoped call excludes lanes started or shipped before the cutoff", () => {
  const m = laneMetrics(threeWeeksOfLanes, "2026-08-27", "2026-08-20");
  assert.equal(m.started, 1, "only the 08-20 lane started on or after the cutoff");
  assert.equal(m.shipped, 1, "only the 08-22 shipped date falls on or after the cutoff");
});

test("medianCommitsToShip stays unscoped even when since narrows started/shipped", () => {
  const scoped = laneMetrics(threeWeeksOfLanes, "2026-08-27", "2026-08-20");
  // Median of 5, 7, 9 across all three weeks, not just the one lane the
  // since-cutoff leaves in `shipped`. It is a quality signal over all time.
  assert.equal(scoped.medianCommitsToShip, 7);
});

// A lane whose status is literally "stalled" must count toward metrics.stalled
// on its own, independent of the age-based running/pr-open check. Two lanes,
// tested independently, so removing either branch fails a different test.
const explicitStalledRecent = [
  { status: "stalled", started: "2026-08-27", shipped: null, commits: null, malformed: false },
];
const oldOpenLane = [
  { status: "pr-open", started: "2026-08-01", shipped: null, commits: null, malformed: false },
];

test("a lane explicitly marked stalled counts even when it is not old", () => {
  const m = laneMetrics(explicitStalledRecent, "2026-08-27");
  assert.equal(m.stalled, 1, "status stalled must count regardless of age");
});

test("an open lane past STALL_DAYS still counts as stalled by age, independent of the status branch", () => {
  const m = laneMetrics(oldOpenLane, "2026-08-27");
  assert.equal(m.stalled, 1, "a pr-open lane 26 days old must still count as stalled");
});

test("an open lane exactly STALL_DAYS old is not yet stalled", () => {
  const m = laneMetrics(
    [{ status: "pr-open", started: "2026-08-20", shipped: null, commits: null, malformed: false }],
    "2026-08-27"
  );
  assert.equal(m.stalled, 0, "exactly 7 days open is the boundary, not yet over it");
});

test("an open lane one day past STALL_DAYS is stalled", () => {
  const m = laneMetrics(
    [{ status: "pr-open", started: "2026-08-19", shipped: null, commits: null, malformed: false }],
    "2026-08-27"
  );
  assert.equal(m.stalled, 1, "8 days open is the first stalled day");
});

// Missing agent identity on the self-bless gate must block, not pass open.
// Tested in all three states so an inverted or dropped check fails.
test("differing, present agent identities pass the self-bless gate", () => {
  const v = mergeVerdict({ repo: "esp" }, { ...greenChecks, shipCheckAgent: "user-advocate-1", buildAgent: "execution-agent-1" });
  assert.equal(v.autoMerge, true);
});

test("matching agent identities are blocked as self-bless", () => {
  const v = mergeVerdict({ repo: "esp" }, { ...greenChecks, shipCheckAgent: "execution-agent-1", buildAgent: "execution-agent-1" });
  assert.equal(v.autoMerge, false);
  assert.ok(v.reasons.some((r) => /own work/i.test(r)));
});

test("a missing shipCheckAgent is blocked, not waved through", () => {
  const v = mergeVerdict({ repo: "esp" }, { ...greenChecks, shipCheckAgent: undefined });
  assert.equal(v.autoMerge, false);
  assert.ok(v.reasons.some((r) => /missing/i.test(r)), `expected a missing-identity reason, got: ${v.reasons.join("; ")}`);
});

test("a missing buildAgent is blocked, not waved through", () => {
  const v = mergeVerdict({ repo: "esp" }, { ...greenChecks, buildAgent: "" });
  assert.equal(v.autoMerge, false);
  assert.ok(v.reasons.some((r) => /missing/i.test(r)), `expected a missing-identity reason, got: ${v.reasons.join("; ")}`);
});

// The lane table carries a `sha` column so the post-merge audit has a commit to
// run `git show --stat` against. Pins the column set itself, since a silently
// added or dropped column changes what every row means.
test("the lane table carries a sha column and it round-trips", () => {
  const lanes = parseLanes(sample);
  const shipped = lanes.find((l) => l.status === "shipped");
  assert.equal(shipped.sha, "a1b2c3d");
  assert.equal(lanes[0].sha, null, "an em dash in sha is null, not the string");
  const reparsed = parseLanes(serializeLanes(lanes));
  assert.deepEqual(reparsed, lanes);
});

test("the serialized header names all ten columns in order", () => {
  const header = serializeLanes([]).split("\n")[0];
  assert.equal(header, "| lane | row | repo | branch | pr | started | shipped | commits | status | sha |");
});

test("a row with nine cells is now malformed on column count", () => {
  const nine = "| 1 | 4 | esp | lane/a | 3 | 2026-08-20 | — | — | running |";
  const lanes = parseLanes(`| lane | row | repo | branch | pr | started | shipped | commits | status | sha |\n|---|---|---|---|---|---|---|---|---|---|\n${nine}\n`);
  assert.equal(lanes.length, 1);
  assert.match(lanes[0].malformed, /expected 10 columns, found 9/);
});

// parseLanes used to scan every pipe-delimited line in the whole file, so a
// stray table, a prose line containing a pipe, or the metrics history itself
// all parsed as malformed lane rows, taking the launcher offline. The parser is
// now scoped to the table that starts at the `lane` header row.
const strayPipe = readFileSync(join(here, "fixtures", "lane-state-stray-pipe.md"), "utf8");

test("a pipe-delimited line outside the lane table is not a lane row", () => {
  const lanes = parseLanes(strayPipe);
  assert.equal(lanes.length, 1, `only the one real lane row parses, got ${lanes.length}`);
  assert.equal(lanes[0].repo, "billing-service");
  assert.deepEqual(lanes.filter((l) => l.malformed), []);
});

test("a second markdown table below the lane table is never read as lane data", () => {
  const lanes = parseLanes(strayPipe);
  assert.ok(!lanes.some((l) => l.raw && /week-start|cap-after/.test(l.raw)),
    "the metrics history table must stay outside the lane scan");
});

test("a file whose only pipe line is not a lane table yields no lanes", () => {
  assert.deepEqual(parseLanes("| a | b |\n"), []);
});

// parseLanes([]) cannot tell "no lane table in this file" apart from "a lane
// table with zero rows." A header rename or a split table used to collapse into
// the same empty array as a genuinely clean board, which is what let --status
// report "None. All lanes are free." on a file that still held a running lane
// under an altered header. laneTableFound is the distinction, exported rather
// than folded into parseLanes's return value.
test("laneTableFound is true for a file that carries the lane table", () => {
  assert.equal(laneTableFound(sample), true);
});

test("laneTableFound is false when the header cell is altered, even with a live row below it", () => {
  assert.equal(laneTableFound(headerAltered), false);
  assert.deepEqual(parseLanes(headerAltered), []);
});

test("laneTableFound is false for a file with no lane table at all", () => {
  assert.equal(laneTableFound("| a | b |\n"), false);
});

test("laneTableFound is true for a lane table with a header but zero data rows", () => {
  assert.equal(laneTableFound("| lane | row | repo | branch | pr | started | shipped | commits | status | sha |\n|---|---|---|---|---|---|---|---|---|---|\n"), true);
});

test("parseMetricsHistory reads its own table and nothing else", () => {
  const weeks = parseMetricsHistory(strayPipe);
  assert.equal(weeks.length, 2);
  assert.deepEqual(weeks.map((w) => w.weekStart), ["2026-08-17", "2026-08-24"]);
  assert.equal(weeks[1].capAfter, 3);
  assert.deepEqual(weeks.filter((w) => w.malformed), []);
  // The lane table sits above it and must not leak in.
  assert.ok(!weeks.some((w) => w.raw.includes("billing-service")));
});

test("a history row with a non-date week-start is flagged, not silently counted", () => {
  const md = "| week-start | started | shipped | stalled | cap-after |\n|---|---|---|---|---|\n| lastweek | 2 | 2 | 0 | 2 |\n";
  const weeks = parseMetricsHistory(md);
  assert.equal(weeks.length, 1);
  assert.match(weeks[0].malformed, /week-start/);
});

test("a history row with a non-numeric count is flagged and never leaves NaN behind", () => {
  const md = "| week-start | started | shipped | stalled | cap-after |\n|---|---|---|---|---|\n| 2026-08-24 | two | 2 | 0 | 2 |\n";
  const weeks = parseMetricsHistory(md);
  assert.match(weeks[0].malformed, /started/);
  assert.equal(weeks[0].started, null, "a bad count is null, never NaN, so arithmetic downstream is safe");
});

test("parseCap returns null when no cap line exists, rather than guessing one", () => {
  assert.equal(parseCap("# Lane state\n\nno cap here\n"), null);
  assert.equal(parseCap("**Cap: 3.** moves by the rule"), 3);
});

// A parked lane and a stalled lane both hold an open unmerged PR against their
// repo. If neither claimed it, a second lane could branch, merge, and orphan
// the first PR into conflict. Only `shipped` releases a repo.
const heldRepos = [
  { status: "parked", repo: "esp", started: "2026-08-20", shipped: null, commits: null, sha: null },
  { status: "stalled", repo: "payments-api", started: "2026-08-10", shipped: null, commits: null, sha: null },
];

test("a parked lane still claims its repo, because its PR is still open", () => {
  assert.ok(activeRepos(heldRepos).has("esp"));
});

test("a stalled lane still claims its repo, because its PR is still open", () => {
  assert.ok(activeRepos(heldRepos).has("payments-api"));
});

test("a parked lane and a stalled lane together block both their repos", () => {
  assert.deepEqual([...activeRepos(heldRepos)].sort(), ["esp", "payments-api"]);
});

test("only a shipped lane releases its repo", () => {
  const lanes = [
    { status: "shipped", repo: "esp" },
    { status: "running", repo: "a" },
    { status: "pr-open", repo: "b" },
    { status: "parked", repo: "c" },
    { status: "stalled", repo: "d" },
  ];
  assert.deepEqual([...activeRepos(lanes)].sort(), ["a", "b", "c", "d"]);
});

test("a queue row is filtered out while a parked lane holds its repo", () => {
  const rows = parseQueueRows(queue);
  const out = eligibleRows(rows, [{ status: "parked", repo: "esp" }]);
  assert.ok(!out.some((r) => r.repo === "esp"), "row 2 cannot launch onto a repo with a parked PR open");
});

// An open lane with no started date was invisible to the stall detector:
// daysBetween returns NaN, `NaN > STALL_DAYS` is false, so the lane never
// tripped STALLED, never entered overdueOpen, and could never drag the cap
// down. It becomes malformed instead, which surfaces it in --status and halts
// the launcher until a human fixes the row.
const HEADER = "| lane | row | repo | branch | pr | started | shipped | commits | status | sha |\n|---|---|---|---|---|---|---|---|---|---|\n";

test("a running lane with no started date is malformed", () => {
  const lanes = parseLanes(HEADER + "| 1 | 4 | esp | lane/a | 3 | — | — | — | running | — |\n");
  assert.equal(lanes.length, 1);
  assert.ok(lanes[0].malformed, "a running lane with no started date must not parse as well-formed");
  assert.match(lanes[0].malformed, /started/);
});

test("a pr-open lane with no started date is malformed", () => {
  const lanes = parseLanes(HEADER + "| 2 | 5 | payments-api | lane/b | 4 | — | — | — | pr-open | — |\n");
  assert.match(lanes[0].malformed, /started/);
});

test("a shipped or parked lane with no started date is not malformed on that account", () => {
  const lanes = parseLanes(
    HEADER +
      "| 3 | 6 | a | lane/c | 5 | — | 2026-08-20 | 4 | shipped | abc1234 |\n" +
      "| 4 | 7 | b | lane/d | 6 | — | — | — | parked | — |\n"
  );
  assert.equal(lanes.filter((l) => l.malformed).length, 0, "only running and pr-open need a started date");
});

test("an open lane with a started date stays well-formed", () => {
  const lanes = parseLanes(HEADER + "| 5 | 8 | c | lane/e | 7 | 2026-08-20 | — | — | running | — |\n");
  assert.equal(lanes[0].malformed, undefined);
});

test("an undated open lane can no longer hide from the stall count", () => {
  // laneMetrics filters malformed rows out, so the row stops being counted as a
  // healthy in-flight lane. The visibility it gains is in --status, which prints
  // every malformed row, and in the launcher, which halts on one.
  const lanes = parseLanes(HEADER + "| 6 | 9 | d | lane/f | 8 | — | — | — | running | — |\n");
  const m = laneMetrics(lanes, "2026-09-30");
  assert.equal(m.started, 0, "a malformed row is not counted as a started lane");
  assert.ok(lanes[0].malformed);
});

// rankRows must preserve the queue's own file order rather than sorting by row
// number, because a row's position already carries the human's ordering
// judgement. The queue fixture places row 8 before row 7 deliberately, so a
// sort and a position-preserving pass give different answers here.
test("rankRows preserves file position rather than sorting by row number", () => {
  const ranked = rankRows(parseQueueRows(queue));
  assert.deepEqual(ranked.map((r) => r.number), [2, 4, 6, 8, 7, 9, 10],
    "row 8 sits above row 7 in the file and must stay there");
});

test("rankRows does not mutate the array it is handed", () => {
  const rows = parseQueueRows(queue);
  const before = rows.map((r) => r.number);
  rankRows(rows);
  assert.deepEqual(rows.map((r) => r.number), before);
});

// The de-nested mergeVerdict: a lane can fail ship-check AND have no recorded
// agent identity, and both must be reported.
test("a lane that fails ship-check and has no agent identity reports both reasons", () => {
  const v = mergeVerdict({ repo: "esp" }, { ...greenChecks, shipCheckPassed: false, shipCheckAgent: undefined, buildAgent: undefined });
  assert.equal(v.autoMerge, false);
  assert.equal(v.reasons.length, 2, `expected both gates, got: ${v.reasons.join("; ")}`);
  assert.ok(v.reasons.some((r) => /ship-check did not pass/.test(r)));
  assert.ok(v.reasons.some((r) => /identity is missing/.test(r)));
});

test("a lane that fails ship-check and blessed its own work reports both reasons", () => {
  const v = mergeVerdict({ repo: "esp" }, { ...greenChecks, shipCheckPassed: false, shipCheckAgent: "a1", buildAgent: "a1" });
  assert.equal(v.reasons.length, 2, `expected both gates, got: ${v.reasons.join("; ")}`);
  assert.ok(v.reasons.some((r) => /own work/.test(r)));
});
