#!/usr/bin/env node
// lane-report: read lane state and the build queue, print what the launcher,
// the post-merge audit and the weekly cap decision each need.
//
// This file is the ONLY caller of lane-tally's decision functions. The rules
// live in code exactly once, and the surrounding procedure says what to run and
// what to do with the answer rather than restating the rule in prose, because a
// prose restatement drifts from the code and nothing catches it.
//
// Usage:
//   node lane-report.mjs --eligible [queue.md] [lanes.md]
//   node lane-report.mjs --status   [lanes.md] [--today YYYY-MM-DD]
//   node lane-report.mjs --metrics  [lanes.md] [--today YYYY-MM-DD] [--since YYYY-MM-DD]
//   node lane-report.mjs --landed   [lanes.md] --since YYYY-MM-DD
//   node lane-report.mjs --cap      [lanes.md]
//   node lane-report.mjs --gate --repo NAME --has-tests yes|no --tests-pass yes|no \
//     --ship-check-passed yes|no --ship-check-agent ID --build-agent ID --scope-clean yes|no
//
// Default lanes/queue files resolve against the current working directory
// (./lane-state.md, ./build-queue.md). Pass explicit paths to read elsewhere.
//
// Exit codes: 0 success, 1 bad usage, 2 unreadable file.
// Docs: docs/architecture.md
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  parseLanes,
  parseQueueRows,
  parseMetricsHistory,
  parseCap,
  eligibleRows,
  rankRows,
  laneMetrics,
  mergeVerdict,
  capRecommendation,
  laneTableFound,
  STALL_DAYS,
} from "./lane-tally.mjs";
import { localToday } from "./local-date.mjs";

// Resolved against the current working directory, so a stranger runs the gate
// against a lane-state.md sitting next to them. Pass an explicit path to read a
// file elsewhere (the examples/ and test/fixtures/ files are read this way).
const DEFAULT_QUEUE = join(process.cwd(), "build-queue.md");
const DEFAULT_LANES = join(process.cwd(), "lane-state.md");

function die(msg, code) {
  process.stderr.write(msg + "\n");
  process.exit(code);
}

function read(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    die(`Cannot read ${path}`, 2);
  }
}

// parseLanes([]) cannot tell "no lane table in this file" apart from "a lane
// table with zero rows." Both come back as an empty array, and reading that
// silence as a clean board is exactly how a header rename or a split table
// turns into "None. All lanes are free." on a file that is still holding a
// running lane. Every mode below that needs lane-state.md reads it through
// here first, so an unrecognisable table is a loud exit 2 naming the file,
// never a quiet empty parse.
function readLaneFile(path) {
  const md = read(path);
  if (!laneTableFound(md))
    die(`No lane table found in ${path}: the header row starting "| lane |" was not found.`, 2);
  return md;
}

// A malformed ROW inside an otherwise-valid table is not a safe, empty board — it
// is a board with a broken in-flight lane in it. Reading past it and offering the
// other rows as launchable is exactly how the launcher gets told to start a
// second lane onto a repo that already has a broken one, the repo collision the
// independence rule exists to prevent. So the launcher inputs fail closed: name
// every malformed row and what is wrong with it, then exit 2, the same convention
// an unreadable table already uses. This is the guard the missing-table check
// (above) never covered.
function refuseOnMalformedLanes(lanes, action) {
  const bad = lanes.filter((l) => l.malformed);
  if (!bad.length) return;
  process.stderr.write(
    `Refusing to ${action}: the lane board carries ${bad.length} malformed row${bad.length === 1 ? "" : "s"}, and a malformed board is not an empty all-clear board. Fix by hand before launching:\n`
  );
  for (const b of bad) process.stderr.write(`- ${b.malformed}: ${b.raw ?? ""}\n`);
  process.exit(2);
}

// Pulls a `--flag VALUE` pair out of argv (in place).
function takeFlag(argv, flag) {
  const idx = argv.indexOf(flag);
  if (idx === -1) return undefined;
  const v = argv[idx + 1];
  if (v === undefined || v.startsWith("--")) die(`${flag} needs a value`, 1);
  argv.splice(idx, 2);
  return v;
}

// --today and --since share this exact check on purpose: a malformed date on
// either flag must fail loudly rather than widen or narrow the metrics window
// on a value that does not describe a real day.
function takeDateFlag(argv, flag) {
  const v = takeFlag(argv, flag);
  if (v === undefined) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v)))
    die(`${flag} needs a YYYY-MM-DD date`, 1);
  return v;
}

// Every gate flag is required and there is no permissive default. A missing
// flag that quietly read as `true` would wave through the exact build the gate
// exists to catch, which is the deal made when human review was traded for
// these four checks.
function requireYesNo(flag, v) {
  if (v === undefined) die(`--gate requires ${flag} yes|no`, 1);
  if (v !== "yes" && v !== "no") die(`${flag} must be yes or no, got "${v}"`, 1);
  return v === "yes";
}

const argv = process.argv.slice(2);
// The LOCAL calendar date. toISOString() gives the UTC one, which aged every
// lane by an extra day on any evening run west of UTC and could flag a lane as
// stalled a day early. See docs/local-date.md.
const today = takeDateFlag(argv, "--today") ?? localToday();
const since = takeDateFlag(argv, "--since");
const gateFlags = {
  repo: takeFlag(argv, "--repo"),
  hasTests: takeFlag(argv, "--has-tests"),
  testsPass: takeFlag(argv, "--tests-pass"),
  shipCheckPassed: takeFlag(argv, "--ship-check-passed"),
  shipCheckAgent: takeFlag(argv, "--ship-check-agent"),
  buildAgent: takeFlag(argv, "--build-agent"),
  scopeClean: takeFlag(argv, "--scope-clean"),
};

const mode = argv[0];
const rest = argv.slice(1);
// Anything left starting with `--` is a flag this script does not know. Silently
// dropping it used to shift the remaining positionals and fall back to the
// default files, so a typo could read the wrong board.
const stray = rest.find((a) => a.startsWith("--"));
if (stray) die(`Unknown flag ${stray}`, 1);

if (mode === "--eligible") {
  const rows = parseQueueRows(read(rest[0] ?? DEFAULT_QUEUE));
  const lanes = parseLanes(readLaneFile(rest[1] ?? DEFAULT_LANES));
  refuseOnMalformedLanes(lanes, "list launchable rows");
  const out = rankRows(eligibleRows(rows, lanes));
  if (!out.length) {
    console.log("No eligible rows. Every candidate is claimed, ineligible, or over two sessions.");
  } else {
    console.log("## Launchable rows, ranked\n");
    for (const r of out) console.log(`- Row ${r.number}. ${r.title} (repo ${r.repo}, ${r.unit} session)`);
  }
} else if (mode === "--status") {
  const lanes = parseLanes(readLaneFile(rest[0] ?? DEFAULT_LANES));
  const bad = lanes.filter((l) => l.malformed);
  const open = lanes.filter((l) => l.status === "running" || l.status === "pr-open");
  console.log("## Active lanes\n");
  if (!open.length) console.log("None. All lanes are free.");
  for (const l of open) {
    // A malformed row can reach here with an unparseable lane number or no
    // started date, and "Lane NaN, NaN days old" reads as a bug rather than as
    // the row it is telling you to go fix.
    const id = Number.isInteger(l.lane) ? l.lane : "unnumbered";
    const days = l.started ? Math.round((Date.parse(today) - Date.parse(l.started)) / 86400000) : null;
    const age = Number.isInteger(days) ? `${days}d old` : "age unknown, no started date";
    const flag = Number.isInteger(days) && days > STALL_DAYS ? "  <- STALLED" : "";
    console.log(`- Lane ${id}: row ${l.row ?? "unknown"}, ${l.repo ?? "unknown repo"}, PR ${l.pr ?? "none"}, ${age}${flag}`);
  }
  if (bad.length) {
    console.log("\n## Malformed rows, fix by hand\n");
    for (const b of bad) console.log(`- ${b.malformed}: ${b.raw ?? ""}`);
    console.log("\nThis board is not a clean all-clear board. Fix the rows above before launching.");
    // Fail closed: a malformed board must not read as exit 0. exitCode rather
    // than exit() so the board above flushes to stdout before the process ends.
    process.exitCode = 2;
  }
} else if (mode === "--metrics") {
  const m = laneMetrics(parseLanes(read(rest[0] ?? DEFAULT_LANES)), today, since);
  console.log("## Lane metrics\n");
  if (since) console.log(`- window: since ${since}`);
  console.log(`- started: ${m.started}`);
  console.log(`- shipped: ${m.shipped}`);
  console.log(`- stalled: ${m.stalled}`);
  console.log(`- median commits to ship: ${m.medianCommitsToShip ?? "none yet"}`);
} else if (mode === "--landed") {
  // --since is required here, not optional like --metrics. A landed report
  // with no window silently reprints every lane that ever shipped, which is
  // exactly the false "nothing new" or "everything new" read the audit exists
  // to prevent. Fail loudly instead of guessing a window.
  if (!since) die("--landed requires --since YYYY-MM-DD", 1);
  const lanes = parseLanes(readLaneFile(rest[0] ?? DEFAULT_LANES));
  const landed = lanes.filter(
    (l) => !l.malformed && l.status === "shipped" && l.shipped && l.shipped >= since
  );
  console.log(`## Landed since ${since}\n`);
  if (!landed.length) {
    console.log("Nothing landed in this window.");
  } else {
    for (const l of landed)
      console.log(
        `- Lane ${l.lane}: row ${l.row}, ${l.repo}, PR ${l.pr ?? "none"}, ${l.commits ?? "unknown"} commits, sha ${l.sha ?? "unrecorded"}`
      );
  }
} else if (mode === "--cap") {
  // The cap rule lives in capRecommendation and isCleanWeek, and this is what
  // executes them. The weekly step reads the recommendation and writes it down;
  // it does not re-derive the rule, because a prose copy of a rule drifts from
  // the code and nothing catches the drift.
  const md = readLaneFile(rest[0] ?? DEFAULT_LANES);
  const currentCap = parseCap(md);
  if (currentCap === null) die(`No "**Cap: N.**" line found in ${rest[0] ?? DEFAULT_LANES}`, 2);
  const weeks = parseMetricsHistory(md);
  const badWeeks = weeks.filter((w) => w.malformed);
  if (badWeeks.length) {
    process.stderr.write("Malformed metrics history rows, fix by hand before the cap moves:\n");
    for (const w of badWeeks) process.stderr.write(`- ${w.malformed}: ${w.raw}\n`);
    process.exit(2);
  }
  const lastTwo = weeks.slice(-2);
  const r = capRecommendation(currentCap, lastTwo);
  console.log("## Cap decision\n");
  console.log(`- weeks read: ${lastTwo.length ? lastTwo.map((w) => w.weekStart).join(", ") : "none yet"}`);
  console.log(`- current cap: ${currentCap}`);
  console.log(`- recommended cap: ${r.cap}`);
  console.log(`- reason: ${r.reason}`);
} else if (mode === "--gate") {
  // mergeVerdict is the merge gate. Every flag is required, and every failing
  // gate is printed on its own line so one run names everything wrong with the
  // lane. A parked lane is a normal outcome, so this exits 0 either way; only a
  // bad invocation is an error.
  if (!gateFlags.repo) die("--gate requires --repo NAME", 1);
  // The two agent ids are required as flags too. If the harness genuinely does
  // not know one, pass the same placeholder for both, which trips the self-bless
  // gate and parks the lane. Omitting them is not an option, because a gate that
  // can be skipped is not a gate.
  if (!gateFlags.shipCheckAgent) die("--gate requires --ship-check-agent ID", 1);
  if (!gateFlags.buildAgent) die("--gate requires --build-agent ID", 1);
  const verdict = mergeVerdict(
    { repo: gateFlags.repo },
    {
      hasTests: requireYesNo("--has-tests", gateFlags.hasTests),
      testsPass: requireYesNo("--tests-pass", gateFlags.testsPass),
      shipCheckPassed: requireYesNo("--ship-check-passed", gateFlags.shipCheckPassed),
      shipCheckAgent: gateFlags.shipCheckAgent,
      buildAgent: gateFlags.buildAgent,
      scopeClean: requireYesNo("--scope-clean", gateFlags.scopeClean),
    }
  );
  console.log(`## Merge gate, repo ${gateFlags.repo}\n`);
  if (verdict.autoMerge) {
    console.log("AUTO-MERGE");
  } else {
    console.log("PARKED");
    for (const reason of verdict.reasons) console.log(`- ${reason}`);
  }
} else {
  die(
    "Usage: lane-report.mjs --eligible|--status|--metrics|--landed|--cap|--gate [files] [flags]",
    1
  );
}
