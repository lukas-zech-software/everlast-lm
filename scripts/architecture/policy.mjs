// D21/CC-09 legacy exception policy validation and anti-expansion governance.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const violationKey = (violation) =>
  JSON.stringify([violation.rule, violation.from, violation.to, violation.fingerprint]);

export function isValidExceptionSchema(entry) {
  const hasRequiredStrings = ["owner", "decision", "baseline", "removalTask", "reason"].every(
    (key) => typeof entry[key] === "string" && entry[key].trim(),
  );
  const validDates =
    /^\d{4}-\d{2}-\d{2}$/.test(entry.expires) &&
    !Number.isNaN(Date.parse(entry.expires)) &&
    new Date(entry.expires).toISOString().slice(0, 10) === entry.expires;
  return (
    hasRequiredStrings &&
    /^D\d+$/.test(entry.decision) &&
    validDates &&
    Number.isInteger(entry.count) &&
    entry.count >= 1
  );
}

function checkRemovalTask(root, removalTask, error) {
  const removal =
    typeof removalTask === "string" && removalTask.match(/^(specs\/[a-zA-Z0-9_-]+) (T\d+)$/);
  if (!removal || !existsSync(join(root, removal[1], "tasks.md"))) {
    error("invalid-removal-task");
    return;
  }
  const tasksContent = readFileSync(join(root, removal[1], "tasks.md"), "utf8");
  if (!new RegExp(`^- \\[ \\] ${removal[2]}\\b`, "m").test(tasksContent)) {
    error("completed-or-missing-removal-task");
  }
}

export function validateExceptionRecord(root, entry, state) {
  const { now, remaining, seen, basePolicy, findings } = state;
  const key = violationKey(entry);
  const matched = remaining.get(key);
  const error = (rule) => findings.push({ ...entry, rule });

  if (seen.has(key)) {
    error("duplicate-exception");
  }
  seen.add(key);
  if (!isValidExceptionSchema(entry)) {
    error("invalid-exception");
  }
  if (entry.expires <= now) {
    error("expired-exception");
  }
  checkRemovalTask(root, entry.removalTask, error);
  if (matched) {
    if (matched.count !== entry.count) {
      error("exception-count");
    }
  } else {
    error("stale-exception");
  }
  if (
    basePolicy &&
    !basePolicy.exceptions.some(
      (old) => JSON.stringify({ ...old, line: 0 }) === JSON.stringify({ ...entry, line: 0 }),
    )
  ) {
    error("exception-expansion");
  }
  remaining.delete(key);
}

export function evaluatePolicy(root, violations, { policy, now, basePolicy }) {
  if (policy.version !== 1 || !Array.isArray(policy.exceptions)) {
    throw new Error("Invalid architecture policy schema");
  }
  const findings = [];
  const remaining = new Map(violations.map((violation) => [violationKey(violation), violation]));
  const seen = new Set();
  for (const entry of policy.exceptions) {
    validateExceptionRecord(root, entry, { now, remaining, seen, basePolicy, findings });
  }
  findings.push(...remaining.values());
  return { violations, findings, exceptions: policy.exceptions };
}
