import { existsSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { determinePackageState, PACKAGES, resolveIssueState, resolveGateState } from "./sync-github-project.mjs";

// Constitution V / CC-06 & D24/DEV-07: v2/v3 follow-ups and Gate v3.0 resolved under PR #192.
test("resolved v2/v3 issues track their owning package Done state after D24/DEV-07 calibration", () => {
  assert.equal(resolveIssueState(40, "Done"), "Done");
  assert.equal(resolveIssueState(43, "Done"), "Done");
  assert.equal(resolveIssueState(7, "Done"), "Done");
  assert.equal(resolveIssueState(82, "Done"), "Done");
  assert.equal(resolveIssueState(153, "Done"), "Done");
});

test("Gate v1, v2, and v3 resolve to Done while v4–v6 remain Backlog", () => {
  assert.equal(resolveGateState("v1.0"), "Done");
  assert.equal(resolveGateState("v2.0"), "Done");
  assert.equal(resolveGateState("v3.0"), "Done");
  assert.equal(resolveGateState("v4.0"), "Backlog");
});

test("merged implementation does not imply package acceptance without acceptancePr", () => {
  assert.equal(determinePackageState("3.4", { initialPr: 162, acceptancePr: 192 }, new Set([162]), []), "In Progress");
  assert.equal(determinePackageState("3.4", { initialPr: 162, acceptancePr: 192 }, new Set([162, 192]), []), "Done");
  assert.equal(determinePackageState("6.3", { deferred: true, convergePr: 125 }, new Set([125]), []), "Backlog");
});

test("explicit acceptance requires its merged evidence PR", () => {
  const reports = { initialPr: 122, acceptancePr: 151 };
  assert.equal(determinePackageState("2.4", reports, new Set([122]), []), "In Progress");
  assert.equal(determinePackageState("2.4", reports, new Set([122, 151]), []), "Done");
  for (const [key, initialPr] of [["3.1", 160], ["3.2", 159], ["3.3", 161]]) {
    assert.equal(determinePackageState(key, { initialPr, acceptancePr: 192 }, new Set([initialPr, 192]), []), "Done");
  }
});

test("v4.0 packages 4.1 and 4.2 track their spec slugs while Gate v4.0 stays Backlog until acceptance", () => {
  assert.equal(PACKAGES["4.1"].slug, "014-studio-active-learning-suite");
  assert.equal(PACKAGES["4.1"].initialPr, 207);
  assert.equal(PACKAGES["4.2"].slug, "015-studio-visuals-presentations");
  assert.equal(PACKAGES["4.2"].initialPr, 208);
  assert.equal(resolveGateState("v4.0"), "Backlog");

  if (existsSync("specs/014-studio-active-learning-suite")) {
    assert.equal(determinePackageState("4.1", PACKAGES["4.1"], new Set(), []), "In Progress");
  }
  if (existsSync("specs/015-studio-visuals-presentations")) {
    assert.equal(determinePackageState("4.2", PACKAGES["4.2"], new Set(), []), "In Progress");
  }

  assert.equal(
    determinePackageState("4.1", PACKAGES["4.1"], new Set([207]), []),
    "In Progress"
  );
  assert.equal(
    determinePackageState("4.2", { ...PACKAGES["4.2"], convergePr: 302 }, new Set([302]), []),
    "Done"
  );
});
