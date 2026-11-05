# Spec Kit package agents

These are project-scoped [Codex custom agents](https://developers.openai.com/codex/subagents). Each standalone TOML file defines `name`, `description` and self-contained `developer_instructions`. No model, reasoning, permission or MCP override is installed; agents inherit the parent session. No global configuration was changed.

| Agent | Responsibility |
| --- | --- |
| `speckit-release-controller` | Resolve release packages, assign specialists, serialize dependencies, relay questions, integrate and independently verify. |
| `speckit-package-refresh` | Update an already-refined package after upstream changes; bounded spec review, replanning and checklist updates. |
| `speckit-package-specify` | Create/amend one package specification. |
| `speckit-package-clarify` | Encode answers; collect literal questions for controller-mediated user interaction. |
| `speckit-package-plan` | Research and Phase 0/1 design for one package. |
| `speckit-package-checklist` | Append unchecked requirements-quality questions. |
| `speckit-package-tasks` | Generate/update stable, traceable test-first tasks. |
| `speckit-package-analyze` | Read-only consistency analysis after complete task generation. |
| `speckit-package-implement` | Execute authorized tasks with release/checklist gates and test-first evidence. |
| `speckit-package-converge` | Assess implementation and append genuinely remaining work. |

Use the [workflow guide and dispatch contract](../../docs/spec-kit-package-workflow.md). Essential repository rules are intentionally embedded in every worker so the controller does not have to reconstruct them in each prompt. Live governance and installed skills must still be read; these definitions are project instructions, not replacements for skills or sandbox permissions. When common rules change, update every worker definition together and check consistency.

Example request in a checkout containing these files:

```text
Use speckit-release-controller to refresh release v3 against current main.
Assign speckit-package-refresh once per package, following dependency order.
Preserve accepted decisions. Stop after design and checklist generation.
Collect unresolved product questions verbatim; use recommended routine technical choices.
```

Ask the controller to select the named custom agent where the client exposes custom-agent selection. If the current client/tool only supports a generic spawn prompt, read the TOML and pass its full `developer_instructions` plus the concrete dispatch to that subagent. A filename/name in a prompt alone is not proof that the definition was loaded. Keep one package identity per worker. A resumed question/permission interruption uses the same assignment's worktree; a new package/stage assignment starts a new worktree.

Files are available only in checkouts/commits containing them; existing chats may need to reload project configuration. TOML/schema checks establish file validity, not proof that a client has discovered or executed a custom role. Do not start agents, implementation or cloud operations just to test discovery.
