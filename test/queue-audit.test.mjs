// Unit tests for auditQueue — the control-plane integrity check.
//
// The queue and the lane board are an operating system's two mutable surfaces,
// and they drift: a row ships and stays eligible, a lane runs without a row, a
// second row claims an ID an earlier row already owns. Every one of those has
// actually happened on a live board, and each one silently corrupts what the
// launcher offers next. auditQueue finds them and REPORTS the repair; it never
// edits either file, because a control plane that silently rewrites itself is
// the thing it exists to prevent.
import { test } from "node:test";
import assert from "node:assert/strict";
import { auditQueue } from "../lib/lane-tally.mjs";

const LANES_HEADER = `| lane | row | repo | branch | pr | started | shipped | commits | status | sha |
|---|---|---|---|---|---|---|---|---|---|`;

function lanes(...rows) {
  return `${LANES_HEADER}\n${rows.join("\n")}\n`;
}

function row(n, title, lane) {
  return `**${n}. ${title}**\n- **Lane:** ${lane}\n`;
}

const CLEAN_QUEUE = row(1, "Enrichment kit", "repo=`gtm` unit=1 eligible=yes");
const CLEAN_LANES = lanes("| 1 | 1 | gtm | lane/a | — | 2026-09-01 | 2026-09-02 | 4 | shipped | abc |");

test("a clean board reports no findings", () => {
  const found = auditQueue(row(9, "Something", "repo=`x` unit=1 eligible=no"), CLEAN_LANES);
  assert.deepEqual(found, []);
});

test("a duplicate row ID is reported, naming both titles", () => {
  const md = row(34, "Ship Check kit", "repo=`ship-check` unit=1 eligible=no") +
    row(34, "Research citation gate", "repo=`citation-gate` unit=2 eligible=yes");
  const found = auditQueue(md, CLEAN_LANES);
  const dup = found.find((f) => f.check === "duplicate-row-id");
  assert.ok(dup, "expected a duplicate-row-id finding");
  assert.equal(dup.row, 34);
  assert.match(dup.message, /Ship Check kit/);
  assert.match(dup.message, /Research citation gate/);
  // The repair moves the newcomer above the high-water mark (34 here → 35+) and
  // keeps the earlier row's ID, so existing citations of 34 stay meaningful.
  assert.match(dup.repair, /35\+/);
  assert.match(dup.repair, /alias/i);
});

test("the renumber target clears the highest row in use, not just the duplicate", () => {
  const md = row(34, "First", "repo=`a` unit=1 eligible=no") +
    row(34, "Second", "repo=`b` unit=1 eligible=no") +
    row(40, "Much later row", "repo=`c` unit=1 eligible=no");
  const dup = auditQueue(md, CLEAN_LANES).find((f) => f.check === "duplicate-row-id");
  assert.match(dup.repair, /41\+/, "must clear the real high-water mark (40), not the duplicate's number");
});

test("a row whose lane already shipped but is still eligible is reported", () => {
  const md = row(12, "Post-call kit", "repo=`post-call` unit=1 eligible=yes");
  const board = lanes("| 1 | 12 | post-call | lane/post-call | 1 | 2026-08-30 | 2026-08-30 | 1 | shipped | 03bb8a7 |");
  const found = auditQueue(md, board);
  const stale = found.find((f) => f.check === "shipped-still-eligible");
  assert.ok(stale, "expected a shipped-still-eligible finding");
  assert.equal(stale.row, 12);
  assert.match(stale.repair, /eligible=no/);
});

test("a running lane whose row is absent from the queue is reported", () => {
  const board = lanes("| 1 | 77 | mystery-repo | lane/x | — | 2026-09-06 | | | running | — |");
  const found = auditQueue(CLEAN_QUEUE, board);
  const orphan = found.find((f) => f.check === "lane-missing-row");
  assert.ok(orphan, "expected a lane-missing-row finding");
  assert.equal(orphan.row, 77);
  assert.match(orphan.message, /mystery-repo/);
});

test("an eligible row with no repo is reported as undispatchable", () => {
  const md = row(5, "Vague idea", "unit=1 eligible=yes");
  const found = auditQueue(md, CLEAN_LANES);
  const bad = found.find((f) => f.check === "eligible-missing-repo");
  assert.ok(bad, "expected an eligible-missing-repo finding");
  assert.equal(bad.row, 5);
});

test("an eligible row with no unit is reported", () => {
  const md = row(6, "Unsized idea", "repo=`x` eligible=yes");
  const found = auditQueue(md, CLEAN_LANES);
  assert.ok(found.some((f) => f.check === "eligible-missing-unit" && f.row === 6));
});

test("an ineligible row missing repo or unit is NOT reported", () => {
  // A candidate that has not been scoped yet is not a defect. Only a row the
  // launcher may actually pick has to be dispatchable.
  const found = auditQueue(row(7, "Just an idea", "eligible=no"), CLEAN_LANES);
  assert.deepEqual(found, []);
});

test("two eligible rows claiming the same repo are reported as a collision", () => {
  const md = row(20, "A thing", "repo=`same-repo` unit=1 eligible=yes") +
    row(21, "Another thing", "repo=`same-repo` unit=1 eligible=yes");
  const found = auditQueue(md, CLEAN_LANES);
  const clash = found.find((f) => f.check === "duplicate-active-repo");
  assert.ok(clash, "expected a duplicate-active-repo finding");
  assert.match(clash.message, /same-repo/);
});

test("findings carry a repair line and never mutate the input", () => {
  const md = row(12, "Post-call kit", "repo=`post-call` unit=1 eligible=yes");
  const board = lanes("| 1 | 12 | post-call | lane/x | — | 2026-08-30 | 2026-08-30 | 1 | shipped | abc |");
  const before = md;
  const found = auditQueue(md, board);
  assert.equal(md, before, "auditQueue must not mutate its input");
  for (const f of found) {
    assert.ok(typeof f.repair === "string" && f.repair.length > 0, `finding ${f.check} needs a repair`);
    assert.ok(typeof f.severity === "string", `finding ${f.check} needs a severity`);
  }
});

test("a malformed lane board is refused, not read as an all-clear", () => {
  // The same fail-closed rule the other modes follow: an unreadable board must
  // never look like a board with nothing on it.
  assert.throws(() => auditQueue(CLEAN_QUEUE, "no table here at all"), /lane table/i);
});
