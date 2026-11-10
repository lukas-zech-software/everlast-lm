import { test } from "node:test";
import assert from "node:assert/strict";
import { determinePackageState, resolveIssueState, resolveGateState } from "./sync-github-project.mjs";

// Constitution V / CC-06: merged implementation is not release acceptance.
test("known live failures remain open after a convergence PR merges", () => {
  assert.equal(resolveIssueState(40, "Done"), "In Progress");
  assert.equal(resolveIssueState(43, "Done"), "In Progress");
  assert.equal(resolveIssueState(7, "Done"), "In Progress");
  assert.equal(resolveIssueState(82, "Done"), "Done");
});

test("Gate v2 owner acceptance is preserved and V3 needs release proof", () => {
  assert.equal(resolveGateState("v2.0"), "Done");
  assert.equal(resolveGateState("v3.0"), "In Progress");
  assert.equal(resolveGateState("v4.0"), "Backlog");
});

test("merged implementation does not imply package acceptance", () => {
  assert.equal(determinePackageState("3.4", { initialPr: 162 }, new Set([162]), []), "In Progress");
  assert.equal(determinePackageState("6.3", { deferred: true, convergePr: 125 }, new Set([125]), []), "Backlog");
});

test("explicit report acceptance requires its merged evidence PR", () => {
  const reports = { initialPr: 122, acceptancePr: 151 };
  assert.equal(determinePackageState("2.4", reports, new Set([122]), []), "In Progress");
  assert.equal(determinePackageState("2.4", reports, new Set([122, 151]), []), "Done");
});
