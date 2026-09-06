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
//     --ship-check-passed yes|no --ship-check-agent ID --build-agent ID --scope-clean yes|no \
//     --ship-check-findings none|blocker=N,important=N,minor=N [--config PATH] [--ci|--strict] [--json]
//
// Default lanes/queue files resolve against the current working directory
// (./lane-state.md, ./build-queue.md). Pass explicit paths to read elsewhere.
// The protected-repo policy loads from ./ship-check.config.json (or --config
// PATH); with no config the gate parks rather than treating it as all-clear.
//
// Exit codes (human modes): 0 success (PARKED included — read the word), 1 bad
// usage, 2 unreadable/malformed file or config. With --gate --ci the verdict
// itself becomes the exit code: 0 auto-merge, 3 parked, 1 usage, 2 bad evidence.
// Docs: docs/architecture.md, docs/harden-and-configure.md
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
  resolveProtectionPolicy,
  parseReviewFindings,
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

// The protection policy is loaded from a config file, not a source edit.
// `--config <path>` overrides the default `ship-check.config.json` in the
// working directory. An explicit path that cannot be read is an error (the
// caller named a file that is not there); a missing DEFAULT file is the
// legitimate "not configured" state and returns null, which the gate reports as
// a park, never as a silent all-clear.
function loadConfig(explicitPath) {
  const path = explicitPath ?? join(process.cwd(), "ship-check.config.json");
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    if (explicitPath) die(`Cannot read --config ${path}`, 2);
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch (e) {
    die(`Cannot parse config ${path}: not valid JSON (${e.message})`, 2);
  }
}

// Removes a boolean `--flag` from argv (in place) and reports whether it was
// present. Used for --ci/--strict/--json, which carry no value.
function takeBoolFlag(argv, flag) {
  const idx = argv.indexOf(flag);
  if (idx === -1) return false;
  argv.splice(idx, 1);
  return true;
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
  findings: takeFlag(argv, "--ship-check-findings"),
  config: takeFlag(argv, "--config"),
};
// Machine-safe surface, additive to the human --gate. --ci (alias --strict)
// turns the verdict into distinct exit codes (0 auto-merge, 3 parked); --json
// prints the { verdict, autoMerge, reasons } envelope so a consumer reads a
// field, not a word or an exit code. Both are extracted before the stray-flag
// check below so they are not mistaken for unknown flags.
const ciExplicit = takeBoolFlag(argv, "--ci");
const strictExplicit = takeBoolFlag(argv, "--strict");
const ciMode = ciExplicit || strictExplicit;
const jsonMode = takeBoolFlag(argv, "--json");

const mode = argv[0];
const rest = argv.slice(1);
// Anything left starting with `--` is a flag this script does not know. Silently
// dropping it used to shift the remaining positionals and fall back to the
// default files, so a typo could read the wrong board.
const stray = rest.find((a) => a.startsWith("--"));
if (stray) die(`Unknown flag ${stray}`, 1);

const USAGE = `lane-report — read lane state and gate a merge.

Modes:
  --eligible [queue.md] [lanes.md]   launchable queue rows, ranked
  --status   [lanes.md] [--today D]  open lanes, ages, stalls, malformed rows
  --metrics  [lanes.md] [--today D] [--since D]   started/shipped/stalled/median
  --landed   [lanes.md] --since D    lanes shipped since D (post-merge audit)
  --cap      [lanes.md]              current cap, recommended cap, and why
  --gate --repo NAME --has-tests yes|no --tests-pass yes|no \\
         --ship-check-passed yes|no --ship-check-agent ID --build-agent ID \\
         --scope-clean yes|no --ship-check-findings SPEC \\
         [--config PATH] [--ci|--strict] [--json]
                                     AUTO-MERGE or PARKED, with every reason

Gate options:
  --ship-check-findings SPEC
                  the review's severity-tagged result: 'none' (a clean
                  adversarial pass) or blocker=N,important=N,minor=N. An
                  unstructured value (a hedge, empty, a bare 'yes') PARKS the
                  lane, and a bless carrying a blocker PARKS it too.
  --config PATH   protected-repo policy (default ./ship-check.config.json).
                  No config -> the gate PARKS, never a silent all-clear.
                  protectedRepos: [] is the deliberate opt-out.
  --ci, --strict  the verdict becomes the exit code: 0 auto-merge, 3 parked.
  --json          print { verdict, autoMerge, reasons } instead of prose.

Default lanes/queue files resolve against the current working directory
(./lane-state.md, ./build-queue.md). Dates are YYYY-MM-DD.
Exit codes: 0 success (including PARKED on the human --gate — read the word),
1 bad usage, 2 unreadable or malformed board or config. Under --ci a parked
verdict exits 3 instead of 0.`;

if (mode === "--help" || mode === "-h") {
  console.log(USAGE);
  process.exit(0);
} else if (mode === "--eligible") {
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
  // Fail closed like the launcher inputs: a malformed board produces no metrics
  // answer. Without these two guards, laneMetrics() filters malformed lanes out
  // and a broken active lane silently vanishes from started/shipped/stalled.
  const lanes = parseLanes(readLaneFile(rest[0] ?? DEFAULT_LANES));
  refuseOnMalformedLanes(lanes, "report metrics");
  const m = laneMetrics(lanes, today, since);
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
  // Fail closed: a malformed SHIPPED row would otherwise be dropped by the
  // filter below and silently disappear from the post-merge audit — a merge
  // nobody can audit. Refuse and name the row instead of hiding it.
  refuseOnMalformedLanes(lanes, "audit landed lanes");
  const landed = lanes.filter(
    (l) => l.status === "shipped" && l.shipped && l.shipped >= since
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
  // Resolve the protection policy before deciding. A malformed config is
  // unreadable evidence (exit 2), an empty list is the deliberate opt-out (say
  // so once), and a missing config is the not-configured park handled inside
  // mergeVerdict.
  const policy = resolveProtectionPolicy(loadConfig(gateFlags.config));
  if (policy.malformed) die(`Invalid ship-check config: ${policy.malformed}`, 2);
  if (policy.optOut)
    process.stderr.write("Production protection is deliberately disabled (protectedRepos: []).\n");
  const verdict = mergeVerdict(
    { repo: gateFlags.repo },
    {
      hasTests: requireYesNo("--has-tests", gateFlags.hasTests),
      testsPass: requireYesNo("--tests-pass", gateFlags.testsPass),
      shipCheckPassed: requireYesNo("--ship-check-passed", gateFlags.shipCheckPassed),
      shipCheckAgent: gateFlags.shipCheckAgent,
      buildAgent: gateFlags.buildAgent,
      scopeClean: requireYesNo("--scope-clean", gateFlags.scopeClean),
      // An absent or unstructured findings value is a review-quality signal, not
      // operator error, so it is NOT a die() here — parseReviewFindings turns it
      // into an unstructured result and mergeVerdict parks the lane with a
      // reason, in the accumulate-all-failures style.
      reviewFindings: parseReviewFindings(gateFlags.findings),
    },
    policy
  );
  if (jsonMode) {
    // The envelope: a machine reads autoMerge, not a word or an exit code.
    console.log(
      JSON.stringify({
        verdict: verdict.autoMerge ? "AUTO-MERGE" : "PARKED",
        autoMerge: verdict.autoMerge,
        reasons: verdict.reasons,
      })
    );
  } else {
    console.log(`## Merge gate, repo ${gateFlags.repo}\n`);
    if (verdict.autoMerge) {
      console.log("AUTO-MERGE");
    } else {
      console.log("PARKED");
      for (const reason of verdict.reasons) console.log(`- ${reason}`);
    }
  }
  // Human --gate keeps exit-0-on-park, unchanged. --ci makes a parked verdict a
  // distinct non-zero exit so `ship-check --gate --ci && gh pr merge` cannot
  // merge a park. Usage (1) and unreadable-evidence (2) exits already happened
  // above via die(); here only auto-merge (0) vs park (3) remain to encode.
  if (ciMode) process.exit(verdict.autoMerge ? 0 : 3);
} else {
  die(
    "Usage: lane-report.mjs --eligible|--status|--metrics|--landed|--cap|--gate [files] [flags]",
    1
  );
}
