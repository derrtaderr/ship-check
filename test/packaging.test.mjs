// Packaging invariants. The repo's signature command is `ship-check`, so the
// package must expose it as a bin, with `lane-report` kept as an alias so
// existing users are not broken.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(here, "..", "package.json"), "utf8"));

test("package.json exposes ship-check as a bin pointing at the CLI entry", () => {
  assert.equal(pkg.bin["ship-check"], "./lib/lane-report.mjs");
});

test("package.json keeps lane-report as a bin alias so nothing breaks", () => {
  assert.equal(pkg.bin["lane-report"], "./lib/lane-report.mjs");
});
