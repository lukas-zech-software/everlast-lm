---
name: sync-github-project
description: >-
  Synchronize implementation progress, pull requests, releases, and quality gates
  with GitHub Project 2 (Everlast LM – Produkt-Roadmap) and GitHub Issues. Use when
  checking or updating the roadmap status, closing completed milestone issues,
  moving converged packages to Done, setting active packages to In Progress, or reconciling
  the codebase reality with GitHub.
compatibility: Everlast LM repository; requires gh CLI authenticated with repo and project scopes.
metadata:
  author: everlast-core
  version: 1.0.0
---

# Sync GitHub Project & Issues Skill

This skill synchronizes the actual implementation state of the Everlast LM codebase with:
1. **GitHub Project 2** (`Everlast LM – Produkt-Roadmap`): Updates card columns (`Done`, `In Progress`, `Backlog`), release tags, and PR metadata across View 1 (*Release-Übersicht*) and View 2 (*Status-Board*).
2. **GitHub Issues** (`lukas-zech-software/everlast-lm`): Closes completed functional requirement issues and gates with verifiable release proof comments; keeps in-progress issues aligned; documents deferred items (D5/DEV-03).
3. **Roadmap Checklists**: Ensures markdown checkboxes in Issue #1 (`[ROADMAP]`) and Epic issues reflect merged and converged packages.

---

## When to Run

- **After merging feature or convergence PRs** (e.g. after `/speckit-converge` or release PRs).
- **At the start or conclusion of a release milestone** to verify project board accuracy.
- **Whenever there is suspicion that GitHub Issues or Project cards are lagging** behind the codebase state.

---

## Prerequisites

1. **GitHub CLI (`gh`)**:
   Verify authentication and necessary scopes (`repo`, `project`):
   ```bash
   gh auth status
   ```
2. **Repository context**:
   Run from the repository root or worktree of `everlast-lm`.

---

## Execution Instructions

### 1. Dry Run (Preview Changes)

Always run a dry run first to inspect what would change:

```bash
pnpm sync:project --dry-run
# or directly:
node scripts/sync-github-project.mjs --dry-run
```

Review the printed list of status transitions:
- `[STATUS CHANGE] Issue #...: "Backlog" -> "In Progress"`
- `[STATUS CHANGE] Issue #...: "In Progress" -> "Done"`
- `[CLOSE ISSUE] Closing Issue #...`

### 2. Apply Synchronization

Execute without `--dry-run` to apply changes directly to GitHub:

```bash
pnpm sync:project
# or directly:
node scripts/sync-github-project.mjs
```

### 3. Verify GitHub Board & Views

Verify that the views are updated:
- **View 1 (Release-Übersicht)**: [https://github.com/users/lukas-zech-software/projects/2/views/1](https://github.com/users/lukas-zech-software/projects/2/views/1)
- **View 2 (Status-Board)**: [https://github.com/users/lukas-zech-software/projects/2/views/2](https://github.com/users/lukas-zech-software/projects/2/views/2)
- **Open Issues**: [https://github.com/lukas-zech-software/everlast-lm/issues](https://github.com/lukas-zech-software/everlast-lm/issues)

---

## State Resolution Rules

The synchronizer determines package and issue states deterministically:

1. **Done**:
   - Package convergence PR has merged into `main` (e.g. PR #125 for v1.1–v1.4, PR #128 for v2.1).
   - Or contract verification suite passed (e.g. Issue #80 / Contract C-03 merged in PR #122).
   - Corresponding GitHub Issue is closed with an audit comment and Project status is set to `Done`.
2. **In Progress**:
   - Initial implementation PR has merged or is open in review.
   - Or an active branch/PR exists for the package slug (e.g. `specs/<slug>` or PR #118 for Package 3.1).
   - Corresponding GitHub Issue remains `OPEN` and Project status is set to `In Progress`.
3. **Backlog**:
   - No branch, PR, or spec directory exists yet.
   - Corresponding GitHub Issue remains `OPEN` and Project status is set to `Backlog`.
4. **Deferred (D5 / DEV-03)**:
   - Issue #20 (`[EPIC-6.3] Ökosystem-Integration`) and Issue #77 (`[FR-INT-01]`) are deferred per Constitution and Architecture Decisions.

---

## Best Practice for Autonomous Agents

To maintain real-time synchronization automatically in future PRs, all agent-generated pull request descriptions should include GitHub closing keywords:

```markdown
## Related Issues
Closes #<epic-id>
Closes #<requirement-id-1>
Closes #<requirement-id-2>
```

When GitHub PR descriptions include `Closes #...`, GitHub's native automation will automatically close the issues and move them to `Done` upon merge.
