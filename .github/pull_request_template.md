## Summary

<!-- What changes and why, in two or three sentences. -->

## Traceability

- **SRS IDs:** <!-- e.g. FR-SI-03, NFR-EVAL-04 -->
- **Package / spec path:** <!-- e.g. spec/requirements/v1/package_1_2_… or specs/NNN-… -->
- **Spec Kit stage:** <!-- specify · clarify · plan · tasks · analyze · implement · n/a -->
- **Task IDs:** <!-- qualified by spec path, e.g. specs/001-workspace-foundation T004–T009 -->

## Checklist

- [ ] Every new spec, plan, task and test cites an SRS ID
- [ ] Spec-derived tests were written first and observed failing (implementation PRs)
- [ ] No spec-derived test was skipped or weakened without an SRS amendment
- [ ] Scope or technical changes are recorded first (SRS amendment, `Dn` or `DEV-xx`)
- [ ] Shared files (SRS, constitution, architecture, contracts, CI, `AGENTS.md`) are changed only by their assigned owner
- [ ] Checks pass locally: `node scripts/check-spec-integrity.mjs`

## Validation

<!-- Commands run and their results. Say explicitly if a check does not exist yet. -->
