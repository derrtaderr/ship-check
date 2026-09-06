// lane-tally: pure functions behind the lane engine. No file I/O, no process
// access. lane-report.mjs owns every read. The split keeps the rules in one
// place, unit-testable without touching the filesystem.
// Docs: docs/architecture.md

export const LANE_STATUSES = ["running", "pr-open", "shipped", "stalled", "parked"];

// `sha` holds the squash commit a lane merged as. The post-merge audit runs
// `git -C <repo-path> show --stat <sha>` to make an auto-merge visible, so
// without this column the audit has nothing to point at.
const COLUMNS = ["lane", "row", "repo", "branch", "pr", "started", "shipped", "commits", "status", "sha"];

// A cell holding an em dash means "not yet", which is null everywhere downstream.
// Returning the literal string would make `commits` sort and average wrongly.
function cell(v) {
  const t = (v ?? "").trim();
  return t === "" || t === "—" || t === "-" ? null : t;
}

function num(v) {
  const c = cell(v);
  if (c === null) return null;
  return /^\d+$/.test(c) ? Number(c) : NaN;
}

function splitCells(t) {
  return t.slice(1, t.endsWith("|") ? -1 : undefined).split("|").map((c) => c.trim());
}

// Table scoping. Every parser here reads ONE named markdown table rather than
// every pipe-delimited line in the file. lane-state.md is hand-edited and the
// weekly step appends to it, so a stray pipe anywhere in the prose used to
// surface as a malformed lane row, and the launcher halts on a malformed row.
// The scan starts at the header row whose first cell matches `headerFirstCell`
// and stops at the first blank line, the first line starting with `#`, or the
// first line that is not part of the table.
//
// Returns `{ found, rows }` rather than just an array. "No header row matched"
// and "the header matched but the table has zero data rows" are different
// facts, and collapsing them into one empty array is what let an altered or
// missing header parse as an empty, harmless board instead of an unreadable
// file. Callers that need the distinction use `laneTableFound` below; callers
// that only ever want the rows keep destructuring `.rows` and are unaffected.
function tableRows(md, headerFirstCell) {
  const out = [];
  let inTable = false;
  let found = false;
  for (const line of md.split("\n")) {
    const t = line.trim();
    if (!inTable) {
      if (t.startsWith("|") && splitCells(t)[0] === headerFirstCell) {
        inTable = true;
        found = true;
      }
      continue;
    }
    if (t === "" || t.startsWith("#") || !t.startsWith("|")) break;
    const cells = splitCells(t);
    if (/^-+$/.test(cells[0])) continue;
    out.push({ raw: t, cells });
  }
  return { found, rows: out };
}

// The distinction lane-report.mjs needs before it trusts an empty parseLanes()
// result: did this file actually carry a lane table, or did the header get
// edited (or the table go missing) so the scan never started. A file that
// fails this check must not be read as "zero lanes," because zero lanes reads
// as every repo being free, which is the opposite of what an unreadable table
// should mean.
export function laneTableFound(md) {
  return tableRows(md, "lane").found;
}

// A malformed row is kept and flagged rather than dropped. A dropped lane is an
// invisible lane, and an invisible running lane is exactly what the repo
// independence check must not miss.
export function parseLanes(md) {
  const lanes = [];
  for (const { raw, cells } of tableRows(md, "lane").rows) {
    if (cells.length !== COLUMNS.length) {
      lanes.push({
        lane: null,
        row: null,
        repo: null,
        branch: null,
        pr: null,
        started: null,
        shipped: null,
        commits: null,
        status: null,
        sha: null,
        raw,
        malformed: `expected ${COLUMNS.length} columns, found ${cells.length}`
      });
      continue;
    }

    const lane = num(cells[0]);
    const row = num(cells[1]);
    const pr = num(cells[4]);
    const commits = num(cells[7]);
    const rec = {
      lane,
      row,
      repo: cell(cells[2]),
      branch: cell(cells[3]),
      pr,
      started: cell(cells[5]),
      shipped: cell(cells[6]),
      commits,
      status: cell(cells[8]),
      sha: cell(cells[9]),
      raw,
    };

    if (!Number.isInteger(lane)) {
      rec.malformed = `lane number is not an integer`;
    } else {
      // Check row, pr and commits independently, not as an else-if chain. A
      // chain stops at the first bad field and leaves the rest as NaN, which
      // is exactly the leak this block exists to close.
      const badFields = [];
      if (row !== null && !Number.isInteger(row)) {
        rec.row = null;
        badFields.push("row");
      }
      if (pr !== null && !Number.isInteger(pr)) {
        rec.pr = null;
        badFields.push("pr");
      }
      if (commits !== null && !Number.isInteger(commits)) {
        rec.commits = null;
        badFields.push("commits");
      }

      if (badFields.length === 1) {
        rec.malformed = `${badFields[0]} field is not an integer`;
      } else if (badFields.length > 1) {
        // Each piece keeps the "<name> field" shape so a test grepping for
        // "pr field" still matches a message that also names row and commits.
        rec.malformed = `${badFields.map((f) => `${f} field`).join(", ")} are not integers`;
      } else if (!LANE_STATUSES.includes(rec.status)) {
        rec.malformed = `unknown status "${rec.status}"`;
      } else if ((rec.status === "running" || rec.status === "pr-open") && !rec.started) {
        // An open lane with no started date is invisible to the stall detector.
        // daysBetween returns NaN, `NaN > STALL_DAYS` is false, so the lane
        // never trips STALLED, never enters overdueOpen, and can never drag the
        // cap down. Flagging the row surfaces it in --status and halts the
        // launcher until a human fills the date in.
        rec.malformed = `a ${rec.status} lane needs a started date`;
      }
    }

    lanes.push(rec);
  }
  return lanes;
}

export const HISTORY_COLUMNS = ["week-start", "started", "shipped", "stalled", "cap-after"];

// The metrics history the weekly step appends to, one row per week. Scoped to
// its own table by the same rule parseLanes uses, which is what lets it be a
// real table rather than a bullet list. Rows are returned in file order, so the
// last entry is the most recent week.
export function parseMetricsHistory(md) {
  const weeks = [];
  for (const { raw, cells } of tableRows(md, "week-start").rows) {
    if (cells.length !== HISTORY_COLUMNS.length) {
      weeks.push({ weekStart: null, started: null, shipped: null, stalled: null, capAfter: null, raw, malformed: `expected ${HISTORY_COLUMNS.length} columns, found ${cells.length}` });
      continue;
    }
    const rec = {
      weekStart: cell(cells[0]),
      started: num(cells[1]),
      shipped: num(cells[2]),
      stalled: num(cells[3]),
      capAfter: num(cells[4]),
      raw,
    };
    const bad = ["started", "shipped", "stalled"].filter((f) => !Number.isInteger(rec[f]));
    if (!rec.weekStart || !/^\d{4}-\d{2}-\d{2}$/.test(rec.weekStart)) rec.malformed = "week-start is not a YYYY-MM-DD date";
    else if (bad.length) rec.malformed = `${bad.join(", ")} must be whole numbers`;
    for (const f of ["started", "shipped", "stalled", "capAfter"]) if (Number.isNaN(rec[f])) rec[f] = null;
    weeks.push(rec);
  }
  return weeks;
}

// The cap lives in one line at the top of lane-state.md. The weekly step writes
// it and the launcher reads it, so it is parsed here rather than eyeballed.
export function parseCap(md) {
  const m = md.match(/\*\*Cap:\s*(\d+)\s*\.?\*\*/);
  return m ? Number(m[1]) : null;
}

export const MAX_UNIT_SESSIONS = 2;

// Queue rows are headed by a bold "**N. Title**" line. The Lane field is a
// bullet beneath it. Both formats are human-maintained, so parsing stays
// forgiving: a row missing its Lane field is simply not eligible, never an
// error.
//
// The closing `**` is not required on the header's starting line. A human
// writing a long queue header routinely wraps it across two lines, and the bold
// marker then lands on the second line, not the first. A regex that demands the
// close on the starting line makes that row silently vanish: no error, the row
// simply does not exist downstream.
//
// The match and the title cut are two separate steps, not one combined regex. A
// single regex with an optional `(?:\*\*)?` before `\s*$` backtracks past a
// REAL closing `**` to reach end of line whenever there is trailing prose after
// it, so the title swallows the marker instead of stopping at it. Matching the
// header loosely and then cutting the title at the first literal `**`, if there
// is one, handles all three shapes correctly: closes on the same line, wraps
// with no close at all, and closes with more text following on the same line.
export function parseQueueRows(md) {
  const rows = [];
  const lines = md.split("\n");
  let current = null;
  for (const line of lines) {
    const head = line.match(/^\*\*(\d+)\.\s*(.+)$/);
    if (head) {
      let title = head[2];
      const close = title.indexOf("**");
      if (close !== -1) title = title.slice(0, close);
      title = title.trim();
      current = { number: Number(head[1]), title, repo: null, unit: null, eligible: false };
      rows.push(current);
      continue;
    }
    if (!current) continue;
    if (!/\*\*Lane:\*\*/.test(line)) continue;
    const repo = line.match(/repo=`?([\w./-]+)`?/);
    const unit = line.match(/unit=(\d+)/);
    const elig = line.match(/eligible=(yes|no)/);
    current.repo = repo ? repo[1] : null;
    current.unit = unit ? Number(unit[1]) : null;
    current.eligible = elig ? elig[1] === "yes" : false;
  }
  return rows;
}

// Only a shipped lane releases its repo. Everything else still holds an open
// unmerged PR against it: running and pr-open obviously, and parked and stalled
// just as much, since parking a lane leaves its PR sitting there waiting for a
// human and stalling one leaves it sitting there waiting for nobody. Letting a
// second lane branch off the same repo while either is open orphans the first
// PR into conflict, which is exactly what the independence rule exists to
// prevent.
const REPO_RELEASING_STATUS = "shipped";
export function activeRepos(lanes) {
  return new Set(
    lanes.filter((l) => l.status && l.status !== REPO_RELEASING_STATUS).map((l) => l.repo).filter(Boolean)
  );
}

export function eligibleRows(rows, lanes) {
  const claimed = activeRepos(lanes);
  return rows.filter(
    (r) =>
      r.eligible &&
      r.repo &&
      !claimed.has(r.repo) &&
      r.unit !== null &&
      r.unit <= MAX_UNIT_SESSIONS
  );
}

// A row's position in the queue already carries the human's ordering judgement,
// made when the row was written. Row numbers are stable identifiers, not
// positions, and rows leave gaps rather than renumbering when they ship, so
// sorting by number actively discards the judgement the file already encodes.
// This preserves file position and adds no ordering of its own.
export function rankRows(rows) {
  return [...rows];
}

export function serializeLanes(lanes) {
  const out = [
    `| ${COLUMNS.join(" | ")} |`,
    `|${COLUMNS.map(() => "---").join("|")}|`,
  ];
  for (const l of lanes) {
    // Emit raw line for any malformed row
    if (l.malformed && l.raw) {
      out.push(l.raw);
      continue;
    }
    const v = (x) => (x === null || x === undefined ? "—" : String(x));
    out.push(
      `| ${v(l.lane)} | ${v(l.row)} | ${v(l.repo)} | ${v(l.branch)} | ${v(l.pr)} | ` +
        `${v(l.started)} | ${v(l.shipped)} | ${v(l.commits)} | ${v(l.status)} | ${v(l.sha)} |`
    );
  }
  return out.join("\n") + "\n";
}

// The protected set — repos that stay human-merge regardless of test state,
// because their blast radius is too large to auto-merge into — is CONFIGURATION,
// not a source edit. It loads from ship-check.config.json (see lane-report.mjs).
// This keeps the library from shipping an effective default of example names
// that silently protects nothing on a real adopter's production repo.
//
// resolveProtectionPolicy turns a parsed config object (or null when no file
// exists) into one of three states, plus a malformed marker:
//   - null / undefined config      -> { configured: false }  (gate PARKS)
//   - { protectedRepos: [...] }     -> { configured: true, repos, optOut:false }
//   - { protectedRepos: [] }        -> { configured: true, repos: [], optOut:true }
//   - missing / non-array / non-string entries -> { malformed } (caller exits 2)
// This is a pure function: no file I/O. lane-report.mjs owns the read.
export function resolveProtectionPolicy(config) {
  if (config === null || config === undefined)
    return { configured: false, repos: [], optOut: false };
  const repos = config.protectedRepos;
  if (!Array.isArray(repos))
    return { malformed: 'protectedRepos must be an array of repo names (use [] to opt out of protection)' };
  if (!repos.every((r) => typeof r === "string"))
    return { malformed: "every entry in protectedRepos must be a string repo name" };
  return { configured: true, repos, optOut: repos.length === 0 };
}

// The three severities a review grades every finding against. The order is the
// blocking order: a blocker stops the ship, a minor never does.
export const FINDING_SEVERITIES = ["blocker", "important", "minor"];

// Parse the reviewer's structured findings summary into per-severity counts. A
// structured review states either an explicit clean pass ("none" — an
// adversarial walk that found nothing) or severity-tagged counts like
// "blocker=0,important=2,minor=1". A hedge, an empty value, a bare "yes", or a
// non-numeric count is NOT structured, and the gate refuses it: an unstructured
// "looks fine" is exactly the review a senior gate must not bless. Pure: no I/O.
export function parseReviewFindings(spec) {
  const empty = { blocker: 0, important: 0, minor: 0 };
  if (typeof spec !== "string") return { structured: false, counts: { ...empty }, total: 0 };
  const s = spec.trim().toLowerCase();
  if (s === "") return { structured: false, counts: { ...empty }, total: 0 };
  if (s === "none") return { structured: true, counts: { ...empty }, total: 0 };
  const counts = { ...empty };
  const parts = s.split(",").map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return { structured: false, counts: { ...empty }, total: 0 };
  for (const part of parts) {
    const m = part.match(/^(blocker|important|minor)=(\d+)$/);
    if (!m) return { structured: false, counts: { ...empty }, total: 0 };
    counts[m[1]] = Number(m[2]);
  }
  return { structured: true, counts, total: counts.blocker + counts.important + counts.minor };
}

// Human review no longer gates the merge, so "green" carries the weight review
// used to. These conditions are that weight.
//
// `policy` is the resolved protection policy from resolveProtectionPolicy. It is
// required: a missing or not-configured policy PARKS with the not-configured
// reason rather than waving the merge through, because "no config" must never
// read as "nothing protected" on a fail-closed gate.
//
// Every failing gate is collected rather than short-circuited, so one run tells
// you everything wrong with the lane instead of one thing at a time.
export function mergeVerdict(lane, checks, policy) {
  const reasons = [];

  if (!checks.hasTests) reasons.push("no tests in the build, so green means nothing ran");
  else if (!checks.testsPass) reasons.push("tests are present but failing");

  if (!checks.shipCheckPassed) reasons.push("ship-check did not pass");

  // The identity gate is its own branch, not nested under the ship-check
  // result. A lane that both fails ship-check and has no recorded agent
  // identity has two things wrong with it, and the promise above is that one
  // run tells you all of them.
  //
  // Missing identity is itself suspicious, not a pass. checks.shipCheckAgent
  // === checks.buildAgent would read as false when both are undefined, which
  // fails open on exactly the build this gate exists to catch: no recorded
  // agent identity at all.
  if (!checks.shipCheckAgent || !checks.buildAgent)
    reasons.push("ship-check or build agent identity is missing, so self-bless cannot be ruled out");
  else if (checks.shipCheckAgent === checks.buildAgent)
    reasons.push("ship-check ran as the build agent, so the lane blessed its own work");

  // The review must be structured and calibrated. The gate cannot verify a
  // blast-radius pass happened — that is the reviewer contract's discipline —
  // but it can refuse a review that reached no structured result, and it can
  // refuse a bless that contradicts its own severity grades.
  const findings = checks.reviewFindings;
  if (!findings || !findings.structured)
    reasons.push(
      "ship-check produced no structured findings; pass severity-tagged counts (e.g. blocker=0,important=2,minor=1) or 'none', not an unstructured verdict"
    );
  else if (checks.shipCheckPassed && findings.counts.blocker > 0)
    reasons.push(
      `ship-check blessed a review carrying ${findings.counts.blocker} blocker finding${findings.counts.blocker === 1 ? "" : "s"}, so a blocker must block`
    );

  // The protection gate has three states. Not configured is a PARK, never a
  // silent pass: a safe-looking policy that was never actually configured is
  // the worst failure for a fail-closed gate. An empty configured list is the
  // deliberate opt-out and protects nothing.
  if (!policy || !policy.configured)
    reasons.push(
      "production-protection policy is not configured; create ship-check.config.json (protectedRepos: [...]), or set it to [] to opt out deliberately."
    );
  else if (policy.repos.includes(lane.repo))
    reasons.push(`${lane.repo} is a protected repo, so this merge stays human`);

  if (!checks.scopeClean) reasons.push("diff drifted outside the row's declared scope");

  return { autoMerge: reasons.length === 0, reasons };
}

export const MIN_CAP = 1;
export const MAX_CAP = 3;
export const STALL_DAYS = 7;

function daysBetween(a, b) {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
}

function median(nums) {
  if (!nums.length) return null;
  const s = [...nums].sort((x, y) => x - y);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// A lane is stalled on elapsed days, not on how the week felt, so the cap moves
// on recorded numbers.
//
// `since` (optional, YYYY-MM-DD) scopes the metrics to one week without ever
// pruning lane-state.md, which stays worth keeping as an audit trail. Each
// counter scopes on the date that actually names it:
//   - started scopes on the lane's own `started` date.
//   - shipped scopes on the lane's own `shipped` date.
//   - stalled scopes on nothing. A lane that stalled two weeks ago is still
//     stalled today and must still drag the cap down; scoping it to "this
//     week" would hide exactly the rot the cap exists to catch.
//   - medianCommitsToShip stays unscoped by `since` on purpose: it is a
//     quality signal across all shipped lanes over all time, not a weekly
//     figure.
// Omitting `since` reproduces the pre-scoping behaviour exactly, so nothing
// already calling laneMetrics(lanes, today) breaks.
export function laneMetrics(lanes, today, since) {
  const real = lanes.filter((l) => !l.malformed);
  const startedLanes = since ? real.filter((l) => l.started && l.started >= since) : real;
  const shippedLanesAllTime = real.filter((l) => l.status === "shipped");
  const shippedLanes = since
    ? shippedLanesAllTime.filter((l) => l.shipped && l.shipped >= since)
    : shippedLanesAllTime;

  // A lane counts as stalled if it is explicitly status "stalled", or it is
  // still open (running/pr-open) and has sat past STALL_DAYS. Neither branch
  // substitutes for the other: a fresh row can be marked stalled by a human
  // before STALL_DAYS elapses, and an open row can age past STALL_DAYS
  // without anyone updating its status yet.
  const explicitlyStalled = real.filter((l) => l.status === "stalled");
  const overdueOpen = real.filter(
    (l) =>
      (l.status === "running" || l.status === "pr-open") &&
      l.started &&
      daysBetween(l.started, today) > STALL_DAYS
  );

  return {
    started: startedLanes.length,
    shipped: shippedLanes.length,
    stalled: explicitlyStalled.length + overdueOpen.length,
    medianCommitsToShip: median(shippedLanesAllTime.map((l) => l.commits).filter((c) => Number.isInteger(c))),
  };
}

// Phrased against lanes launched rather than a flat count, so a week with only
// one eligible row can still be clean.
export function isCleanWeek(m) {
  return m.stalled === 0 && m.started > 0 && m.shipped === m.started;
}

export function capRecommendation(currentCap, weekHistory) {
  const last = weekHistory[weekHistory.length - 1];
  if (last && last.stalled >= 2)
    return {
      cap: Math.max(MIN_CAP, currentCap - 1),
      reason: `${last.stalled} stalled lanes last week, so the cap drops by one`,
    };

  const lastTwo = weekHistory.slice(-2);
  if (lastTwo.length === 2 && lastTwo.every(isCleanWeek))
    return {
      cap: Math.min(MAX_CAP, currentCap + 1),
      reason: "two consecutive clean weeks, so the cap earns one more lane",
    };

  return { cap: currentCap, reason: "no change; the cap moves only on two clean weeks or two stalled lanes" };
}
