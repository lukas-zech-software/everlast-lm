# Contributing

Thanks for your interest. Everlast LM is a showcase for spec-driven development with coding agents, so contributions
follow the same rules the agents do. The full operating manual is [`AGENTS.md`](AGENTS.md); this page is the short
version for humans.

## Ground rules

1. **Traceability.** Every spec, plan, task, test and pull request cites at least one ID from the
   [release index](spec/System_Requirements_Specification_Gemeni_Notebook.md) and [FR cards](spec/requirements/README.md) (`FR-*`, `NFR-*`, `C-01`..`C-03` or a release
   gate). Behaviour without an ID is not built.
2. **Order of precedence.** Constitution → release index → FR cards & FR README → solution architecture. Resolve conflicts against this
   order, never by picking a side.
3. **Test-first.** Spec-derived tests are written before the implementation and must fail first
   ([Constitution, Principle II](.specify/memory/constitution.md)).
4. **Record changes before acting on them.** New scope is an SRS amendment, removed or deferred scope is an
   architecture decision (`Dn`), and a deliberate difference from the reference product is a `DEV-xx` entry plus a `Dn`.

## Workflow

Feature work uses [GitHub Spec Kit](https://github.com/github/spec-kit), one function package per feature:

```text
/speckit-specify → /speckit-clarify → /speckit-plan → /speckit-tasks → /speckit-analyze → /speckit-implement
```

Work in your own branch (and Git worktree if other sessions are active), keep each pull request scoped to one package
or one clearly named shared prerequisite, and fill in the pull request template.

## Reporting problems

- **Spec problems** (contradictions, untestable wording, missing detail): open a
  [spec change request](https://github.com/lukas-zech-software/everlast-lm/issues/new?template=spec-change.yml).
- **Security issues:** see [`SECURITY.md`](SECURITY.md). Please do not open a public issue.

By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).
