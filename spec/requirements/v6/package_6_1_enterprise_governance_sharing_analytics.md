# Package 6.1 — Enterprise Governance, Sharing & Analytics

- **Release:** v6.0
- **Goal:** Scale the platform for enterprise multi-user collaboration with fine-grained role-based sharing (`Owner/Editor`, `Viewer Full`, `Viewer Chat-Only`), usage analytics dashboards, enterprise quota management, and strict SSO/OIDC authentication + document-level ACL enforcement.
- **FRs:** FR-WM-05, FR-WM-06, FR-WM-07 (Enterprise scale), NFR-SEC-02
- **Gate criteria (SRS §5.4):** Gate v6.0 #1 — Penetration-/RBAC-Test: Ein *Chat-Only*-Nutzer kann weder über UI noch via direktem API-Call Rohquellen oder Studio-Endpunkte abrufen; Gate v6.0 #2 — ACL-Test (`NFR-SEC-02`): *Discover Sources* findet niemals Intranet-Dokumente, für die dem anfragenden Nutzer die Leseberechtigung fehlt.
- **Out of scope:** Public anonymous internet sharing outside the enterprise tenant boundary.

---

### FR-WM-05 — Role-Based Collaboration & Sharing (incl. Chat-Only Mode)

| Field | Value |
| :- | :- |
| Release / Package | v6.0 / 6.1 |
| Priority (within package) | P1 |
| Actors | Owner/Editor (manage shares), Viewer (Full), Viewer (Chat-Only) |
| Depends on | FR-WM-01, FR-UI-01, NFR-SEC-02 |
| Observed | 2026-10-15, Gemini Notebook Plus / Enterprise web |

**Requirement (EARS)**
- *Event:* When an `Owner` clicks the `"Share"` (`"Teilen"`) button in the top-right workspace header, the system shall open a sharing modal allowing the owner to grant access to internal users or enterprise groups with one of three roles:
  1. **`Editor` (`Owner / Editor`):** Full access to add/delete sources, edit notes, trigger Studio generators, and chat.
  2. **`Viewer (Full)` (`Betrachter – Vollansicht`):** Read-only access to view sources in the Source Inspector, play/view generated Studio artifacts and notes, and conduct their own private chat sessions against the notebook.
  3. **`Viewer (Chat-Only)` (`Betrachter – Nur Chat`):** Restricted access to the Center Chat Panel only; cannot view the Left Sources Panel, the Source Inspector, the Right Studio/Notes Panel, or any raw source documents via UI or API.
- *State:* While a user with role `Viewer (Chat-Only)` accesses a notebook, the RBAC middleware shall return HTTP `403 Forbidden` on any direct API request to `/sources`, `/chunks`, `/notes`, or `/studio`, and the Frontend (`FR-UI-01`) shall render exclusively the centered Chat interface.
- *Event:* When an `Owner` sets an optional `"Welcome note"` (`"Begrüßungsnotiz"`) in the Share modal, the system shall display that welcome message at the top of the Chat panel for shared viewers.

**User story:** As a department head or subject-matter expert, I want to curate a notebook of policies and share it with colleagues either as full viewers/editors or as a clean "Chat-Only" helpdesk bot, so that teams can query our knowledge base without altering or downloading the underlying raw files.

**Reference behaviour**
1. Owner clicks `Share` in the top-right header.
2. Modal allows adding user emails / groups, picking `Viewer` or `Editor`, and toggling viewer access between `Full notebook` (`Vollständiges Notebook`) and `Chat only` (`Nur Chat`).
3. When a `Chat-only` viewer opens the shared notebook link, the Left (`Sources`) and Right (`Studio`) panels are completely hidden; only the Chat interface is shown.

Evidence: `https://support.google.com/notebooklm/answer/16213268`, `SRS §3.1 FR-WM-05` (Local screenshot: `Unknown`)

**Inputs & limits**

| Input | Format | Constraint | Default |
| :- | :- | :- | :- |
| Grantee principal | User UUID or Group ID | Must belong to the authenticated enterprise tenant (`NFR-SEC-02`) | — |
| Role | Enum | `owner` \| `editor` \| `viewer_full` \| `viewer_chat_only` | `viewer_full` |
| Welcome note | UTF-8 string (optional) | $0\text{–}500$ characters | Empty |

**Outputs & state**
- Visible: `"Shared"` badge on notebook card and header; single-column Chat-only layout for `viewer_chat_only` users.
- Persisted: `NotebookACL` records (`notebook_id`, `principal_id`, `principal_type`, `role`, `created_at`).
- States: `Private` $\leftrightarrow$ `Shared`.

**Acceptance criteria (Gherkin)**

```gherkin
Scenario: Penetration / RBAC test for Viewer (Chat-Only) role (Gate v6.0 #1)
  Given Notebook N1 is shared with User U_chat with role "viewer_chat_only"
  When U_chat opens Notebook N1 in the browser
  Then only the Center Chat Panel is rendered and the Sources and Studio panels are absent from the DOM
  And U_chat can ask grounded questions in the chat and see inline citation snippets on hover
  When U_chat sends direct authenticated API requests to GET /api/v1/notebooks/N1/sources or /chunks or /studio
  Then every request is rejected by the backend RBAC middleware with HTTP 403 Forbidden
```

**Edge & error cases**
- User belongs to a Group granted `viewer_chat_only` AND has an individual grant of `editor` $\rightarrow$ Least-restrictive explicit grant (`editor`) wins within the notebook ACL.
- Access revoked while a viewer has the notebook open $\rightarrow$ Next API request returns `403 Forbidden` and redirects to the home overview.

**Measurable criteria**
- $100\%$ of unauthorized direct API calls by `viewer_chat_only` and `viewer_full` principals are blocked with HTTP `403` (`Gate v6.0 #1`).

**Deviations from reference:** Allows per-principal assignment of `viewer_full` vs. `viewer_chat_only` (in addition to a notebook-wide viewer toggle). Also resolves the `v1.0` open question for `FR-GC-03`: `viewer_chat_only` users see the full citation hover snippet for answer verification, while click-through to the full raw `Source` document and `/chunks` download endpoint is blocked (`403`).

**Out of scope:** Public anonymous link sharing without SSO login.

**Open questions:** `None`

---

### FR-WM-06 — Notebook Usage Analytics for Shared Notebooks

| Field | Value |
| :- | :- |
| Release / Package | v6.0 / 6.1 |
| Priority (within package) | P2 |
| Actors | Owner/Editor |
| Depends on | FR-WM-05 |
| Observed | 2026-10-15, Gemini Notebook Plus / Enterprise web |

**Requirement (EARS)**
- *Event:* When an `Owner` or `Editor` of a shared notebook clicks the `"Analytics"` (`"Nutzungsstatistiken"`) button in the top header, the system shall display a dashboard modal showing two time-series charts over the last $7$, $30$, or $90$ days:
  1. **Active Users per Day (`Nutzer pro Tag`):** Count of distinct authenticated users who accessed or queried the notebook each day.
  2. **Queries per Day (`Fragen pro Tag`):** Total number of chat queries submitted to the notebook each day.
- *Ubiquitous:* To protect employee privacy, the Analytics dashboard shall display aggregate counts only and shall **never** expose the private chat prompts or conversation logs of individual viewers to the notebook owner.

**User story:** As the owner of a shared onboarding or policy notebook, I want to see how many colleagues use the notebook and how many questions they ask each day without spying on their private chat threads, so that I can measure adoption while respecting privacy.

**Reference behaviour**
1. Once a notebook is shared with at least one other user/group, an `Analytics` icon appears in the top bar.
2. Clicking `Analytics` opens a modal with two charts: `Users per day` and `Queries per day`.
3. Individual users' chat histories remain strictly private to each user.

Evidence: `https://support.google.com/notebooklm/answer/16213268`, `SRS §3.1 FR-WM-06` (Local screenshot: `Unknown`)

**Inputs & limits**

| Input | Format | Constraint | Default |
| :- | :- | :- | :- |
| Time range | Enum | `7d` \| `30d` \| `90d` | `7d` |

**Outputs & state**
- Visible: Time-series line/bar charts for `Users per day` and `Queries per day`.
- Persisted: Aggregated daily telemetry counters (`NotebookDailyMetrics`: `notebook_id`, `date_utc`, `unique_users_count`, `queries_count`).
- States: `AnalyticsAvailable`.

**Acceptance criteria (Gherkin)**

```gherkin
Scenario: Shared notebook records aggregate daily users and queries without leaking private chat text
  Given Notebook N1 is shared with 5 viewers
  When 3 viewers ask a total of 12 questions in Notebook N1 today
  And the owner opens the "Analytics" dashboard for N1
  Then today's metrics display "3 users" and "12 queries"
  And the API response contains zero prompt texts or individual user chat transcripts
```

**Edge & error cases**
- Notebook has $0$ activity in the selected window $\rightarrow$ Renders zero-baseline chart cleanly.

**Measurable criteria**
- Analytics modal loads in $\le 500\text{ ms}$.

**Deviations from reference:** Reference consumer Plus requires $\ge 4$ users per day before plotting; in our enterprise platform, aggregate counts are shown from $1+$ users while keeping prompt contents strictly private.

**Out of scope:** Per-user surveillance logs of chat questions.

**Open questions:** `None`

---

### FR-WM-07 (Enterprise Tier) — Enterprise Quota & Tier Management

| Field | Value |
| :- | :- |
| Release / Package | v6.0 / 6.1 |
| Priority (within package) | P2 |
| Actors | Platform Administrator, Owner/Editor |
| Depends on | FR-WM-07 (Baseline v1.0) |
| Observed | 2026-10-15, Gemini Notebook Plus / Enterprise web |

**Requirement (EARS)**
- *Ubiquitous:* In `v6.0`, the system shall support role/tenant-based Enterprise Quotas raising the default notebook capacity up to $N_{\text{max}} = 300$ sources per notebook (up to $500,000$ words / $200\text{ MB}$ per source $\rightarrow 150,000,000$ words per notebook), $500$ notebooks per user, and configurable daily generation quotas for Chat, Audio Overviews, and Video Overviews.

**User story:** As an enterprise administrator, I want to assign higher resource quotas (up to 300 sources per notebook) to enterprise teams and control daily media generation limits, so that heavy research departments are never bottlenecked.

**Reference behaviour**
1. Enterprise/Plus users see `Source limit: <n> / 300` in the upload modal and enjoy $5\times$ higher daily Studio generation quotas.

Evidence: `https://support.google.com/notebooklm/answer/16213268`, `SRS §3.1 FR-WM-07`

**Inputs & limits**

| Input | Format | Constraint | Default (Enterprise) |
| :- | :- | :- | :- |
| `max_sources_per_notebook` | Integer | $50\text{–}300$ | $300$ |
| `max_notebooks_per_user` | Integer | $100\text{–}1,000$ | $500$ |
| `max_audio_generations_per_day` | Integer | Configurable | $20\text{ / day / user}$ |

**Outputs & state**
- Visible: Updated `n / 300` quota bar in UI.
- Persisted: `TenantQuotaPolicy` configuration.
- States: `WithinQuota` $\leftrightarrow$ `QuotaExceeded`.

**Acceptance criteria (Gherkin)**

```gherkin
Scenario: Enterprise user uploads up to 300 sources into a single notebook
  Given a user assigned the Enterprise Quota Policy (N_max = 300)
  When the user opens the "Add sources" modal in a notebook with 55 sources
  Then the quota indicator displays "55 / 300" and allows adding up to 245 additional sources
```

**Edge & error cases**
- Standard user (`N_max = 50`) is invited as `Editor` to an Enterprise Owner's notebook (`N_max = 300`) $\rightarrow$ Quota follows the **notebook owner's tier** ($300$ sources).

**Measurable criteria**
- Quota evaluation executes in $\le 10\text{ ms}$ via cached policy lookup.

**Deviations from reference:** None.

**Out of scope:** Credit-card consumer checkout flows.

**Open questions:** `None`

---

### NFR-SEC-02 — Enterprise SSO (OIDC/SAML) & Document-Level ACL Enforcement

| Field | Value |
| :- | :- |
| Release / Package | v6.0 / 6.1 |
| Priority (within package) | P1 |
| Actors | All Users, Identity Provider (IdP), Discovery & Research Agent |
| Depends on | FR-WM-05, FR-SI-06, FR-SI-07 |
| Observed | 2026-10-15, Enterprise SRS §4.3 |

**Requirement (EARS)**
- *Ubiquitous:* All web UI and API endpoints shall authenticate users via the enterprise Identity Provider using OpenID Connect (OIDC) or SAML 2.0, extracting the user's verified `user_id`, email, and security group memberships (`groups`).
- *Ubiquitous:* Whenever any search or ingestion agent (`Discover Sources` `FR-SI-06` or `Deep Research` `FR-SI-07`) queries connected enterprise repositories (Intranet, SharePoint, Confluence, Google Drive, DMS), the query shall execute strictly with the calling user's OAuth2 On-Behalf-Of (OBO) token or pre-filtered security group ACL filter (`user_principals INTERSECT document_acl != EMPTY`).
- *Unwanted:* If a document in the enterprise intranet lacks read permission for the requesting user, then the system shall **never** return its title, snippet, URL, or content in search results or research reports.

**User story:** As a CISO, I want the platform to authenticate via corporate SSO and strictly enforce existing intranet document ACLs during agentic search, so that employees can never discover or import restricted HR, legal, or M&A documents they aren't authorized to read.

**Reference behaviour**
1. User logs in via corporate SSO (OIDC/SAML).
2. When user runs `Discover Sources` (`FR-SI-06`) on the company intranet, the search connector passes the user's identity token/ACL principals to the enterprise search index and returns only documents the user is permitted to read.

Evidence: `SRS §4.3 NFR-SEC-02`, `SRS §5.4 Gate v6.0 #2`

**Inputs & limits**

| Input | Format | Constraint | Default |
| :- | :- | :- | :- |
| OIDC / SAML Token | Signed JWT / SAML Assertion | Valid signature, non-expired (`exp`), matching issuer (`iss`) and audience (`aud`) | Required on all routes |
| Document ACL Principals | Array of User/Group IDs | Evaluated at retrieval time before LLM context injection | Deny by default |

**Outputs & state**
- Visible: Seamless SSO login; ACL-filtered search results.
- Persisted: Security audit log of authentication and cross-repository imports.
- States: `Unauthenticated` $\rightarrow$ `AuthenticatedWithPrincipals`.

**Acceptance criteria (Gherkin)**

```gherkin
Scenario: Intranet ACL enforcement prevents unauthorized document discovery (Gate v6.0 #2)
  Given Intranet Document D_secret has ACL allowing only Group "Board_Members"
  And Intranet Document D_public has ACL allowing Group "All_Employees"
  And User U_engineer belongs only to "All_Employees"
  When U_engineer runs "Discover Sources" or "Deep Research" for a keyword present in both D_secret and D_public
  Then the search query filters by U_engineer's principals at the index level
  And D_public is returned while D_secret is completely excluded (0 titles, 0 snippets, 0 chunks leaked)
```

**Edge & error cases**
- Expired OBO / OIDC token during a long-running Deep Research job $\rightarrow$ Refreshes token via refresh token or aborts the restricted intranet branch with an auth-expired notice rather than falling back to a privileged service account.

**Measurable criteria**
- $0$ unauthorized intranet documents surfaced across all `Gate v6.0 #2` ACL penetration test cases.

**Deviations from reference:** None.

**Out of scope:** Managing/editing upstream SharePoint/Confluence permissions from inside Gemini Notebook.

**Open questions:** `None`