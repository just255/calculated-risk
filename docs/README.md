# Calculated Risk — Knowledge Base

Project documentation, indexed and machine-readable so fresh Claude sessions can pull accurate context fast.

Read this file first. It defines the standard.

---

## Layout

```
docs/
├── README.md         ← this file (standard + index)
├── glossary.md       ← single-file domain terms
├── systems/          ← per-subsystem how-it-works
├── decisions/        ← ADRs (architecture decision records, append-only)
└── templates/        ← copy these when creating new docs
    ├── system.md
    └── adr.md
```

Markdown files at `docs/` root that aren't `README.md` or `glossary.md` are **legacy design notes** that predate this KB system. They may or may not reflect current reality. Migrate them to `systems/` with proper frontmatter when you touch them.

---

## How to use this KB

- **Need to understand a subsystem?** Look in `systems/<name>.md`.
- **Need to know *why* something was built that way?** Look in `decisions/`.
- **Confused by a term?** `glossary.md`.
- **About to make a non-trivial change?** Read the relevant system doc *first*, then update it as part of your change.

A fresh Claude agent can be dispatched to read this directory and pull context on any topic. The frontmatter is the index.

---

## Doc types

### 1. System docs (`systems/<name>.md`)
How a subsystem works. Entry points, state shape, mutation points, lifecycle, gotchas. Audience: anyone modifying or extending the subsystem.

### 2. ADRs (`decisions/ADR-NNNN-<slug>.md`)
*Why* a design choice was made. Append-only — once accepted, don't edit the original body; add to the `Log` section. Audience: anyone questioning a design choice.

### 3. Glossary (`glossary.md`)
Domain terms (MOS, PPB, MMR, S5, etc.). Single file, alphabetical. Cross-link from system docs.

### 4. Gotchas
Live as a **section inside each system doc**, not as separate files. Surfacing a gotcha next to the system that owns it is more discoverable than a global dump.

---

## Doc standard

### Required: YAML frontmatter at the top of every doc

This is the index. Without it, the drift script and `/doc-status` can't see your doc.

**System doc frontmatter:**

```yaml
---
name: soldier-lifecycle
type: system
status: stable        # stable | in-flux | legacy
verified: 2026-05-22  # YYYY-MM-DD, refreshed when you re-verify against code
verified_hash: abc123 # short commit hash at verification time
tags: [roster, gear, mission]
files:
  - js/roster.js
  - js/mission.js
entry_points:
  - "roster.js:92 createSoldier"
  - "mission.js:40 launchMission"
related:
  - systems/armory.md
  - decisions/ADR-0001-s5-star-thresholds.md
---
```

**ADR frontmatter** (includes a `log` field that mirrors the body's Log section, for indexability):

```yaml
---
name: ADR-0001-s5-star-thresholds
type: adr
status: accepted      # proposed | accepted | superseded-by-ADR-NNNN | deprecated
date: 2026-05-20
deciders: [dev, claude]
affected_files: [js/ui.js]
related: [systems/dossier.md]
log:
  - date: 2026-05-20
    hash: f84482e
    note: Initial decision
---
```

**YAML subset supported by the drift script:** scalars, lists of scalars, lists of objects (for `log:`). No anchors, no multiline strings, no nested objects deeper than 2 levels.

### Required body sections

System docs use all of these, marking "N/A" when not applicable so agents grep reliably:

- **Purpose** — one paragraph, why this system exists
- **Quick Reference** — common operations with code refs
- **Call Graph** — text tree or Mermaid showing how calls flow
- **State Shape** — where state lives (`Game.X`, localStorage keys, etc.)
- **Mutation Points** — every function that changes state, with `file:line` refs
- **Persistence** — what's saved/loaded, by whom, in what order
- **Lifecycle** — step-by-step for flow-shaped systems
- **Gotchas** — known sharp edges (each with date + code ref)
- **Cross-references** — related systems and ADRs

ADRs use: **Context / Decision / Alternatives Considered / Consequences / Log**.

See `templates/system.md` and `templates/adr.md` for copy-paste skeletons.

### Naming

- System docs: `kebab-case.md` (e.g., `soldier-lifecycle.md`)
- ADRs: `ADR-NNNN-slug.md` with 4-digit zero-padded number

### Status badges

| Badge | Status | Meaning |
|---|---|---|
| ✅ | `stable` | Verified within 30 days, no known drift |
| ⚠ | (verified > 30 days) | Stale; treat as suspect until reverified |
| 🚧 | `in-flux` | System being refactored; doc may lag |
| 🚫 | `legacy` | System being removed; doc preserved for archeology |

---

## Doc rules

These are non-negotiable:

1. **Code is the source of truth.** Docs link to `file:line` (e.g., `roster.js:158 generateRecruit`); they don't re-explain logic. If the code changes, the doc's line refs go wrong — that's how staleness gets detected.
2. **Update in the same commit as the code change.** A commit touching a documented system MUST update its doc in the same commit. No "I'll do it later."
3. **`verified` is a promise.** When you update the date+hash, you're asserting "I've actually re-read this against the current code." Don't bump it for cosmetic edits.
4. **All required sections present.** Skipped section → write "N/A" so agents grepping for `## Mutation Points` always find a heading.
5. **Cross-link.** When mentioning another system, ADR, or glossary term, link to it explicitly.

---

## Tooling

### `tools/doc-context.js`
Data-only script. Reads frontmatter, cross-references with `git`, outputs JSON. Doesn't modify anything.

CLI:
```bash
node tools/doc-context.js --staged       # WIP-vs-docs drift
node tools/doc-context.js --commit HEAD  # latest-commit-vs-docs drift
node tools/doc-context.js --full         # historical drift (verified_hash vs HEAD)
node tools/doc-context.js --verbose      # human-readable
```

Default: JSON, silent if no docs affected.

### Slash commands

| Command | Purpose |
|---|---|
| `/add-doc <name>` | Create a new system doc via Q&A workflow |
| `/update-doc <name>` | Refresh an existing system doc |
| `/log-decision <slug>` | Write a new ADR or append a Log entry to an existing one |
| `/doc-status` | Report which docs are drifted (no action) |
| `/sync-docs` | Propose updates for all currently-drifted docs |

### Claude Code hooks

- **PostToolUse** — fires after `git commit`. Pipes `doc-context.js --commit HEAD` output back into the conversation. Claude reviews + proposes updates.
- **SessionStart** — fires at session start. Briefing: git status, drift summary, recent commits. Claude addresses drift before proceeding.

If you commit outside Claude (terminal), SessionStart catches up next time. `/sync-docs` is also a manual fallback.

---

## Index

### Systems
*(seed content pending — see `decisions/ADR-NNNN-` once seeded)*

### Decisions
*(seed content pending)*

### Templates
- [system.md](templates/system.md)
- [adr.md](templates/adr.md)

### Glossary
- [glossary.md](glossary.md)
