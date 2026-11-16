import { test } from "node:test";
import assert from "node:assert/strict";
import { determinePackageState, resolveIssueState, resolveGateState } from "./sync-github-project.mjs";

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
