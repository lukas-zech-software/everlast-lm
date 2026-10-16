# Security policy

## Supported versions

Everlast LM is in its specification phase; no application code has been released yet. Security reports about the
repository itself (for example leaked credentials, unsafe workflow configuration or a weakness in the specified
security model) are welcome now.

| Version | Supported |
| :- | :-: |
| `main` | ✅ |

## Reporting a vulnerability

Please **do not open a public issue.** Report it privately through GitHub:
**[Report a vulnerability](https://github.com/lukas-zech-software/everlast-lm/security/advisories/new)**.

Include what you found, where (file, line or setting), and how it could be exploited. You will get a first response
within 7 days. Confirmed issues are fixed on `main` and credited in the advisory unless you prefer otherwise.

## Security model in the specification

The intended runtime security model is part of the specification and binding for every implementation agent:

- [Constitution, Principle VI "Security & Data"](.specify/memory/constitution.md): enterprise model endpoints only (no
  training on customer data), server-side authorisation on every endpoint, no secrets in the repository or in plain
  environment variables, prompt-injection screening for web content, EU data residency by default.
- [Solution architecture §5.1](docs/solution-architecture.md#51-security-privacy-and-compliance): least-privilege
  service accounts, internal ingress for workers, IAM database authentication, signed URLs, Model Armor.
- Agents that run with relaxed permissions must run in isolated sandboxes without production credentials
  ([`AGENTS.md`](AGENTS.md)).

## Repository safeguards

- Secret scanning with push protection, Dependabot alerts and security updates, CodeQL code scanning and private
  vulnerability reporting are enabled: every security feature GitHub offers for public repositories on a personal
  account. Generic-pattern detection and validity checks require GitHub Secret Protection on an organization plan and
  are deliberately not used (owner decision, 2026-10-16).
- GitHub Actions run with read-only tokens by default, are restricted to GitHub-owned and verified actions, and must
  be pinned to a full commit SHA.
- `main` is protected: changes merge through pull requests with passing checks; force pushes and deletion are blocked.
