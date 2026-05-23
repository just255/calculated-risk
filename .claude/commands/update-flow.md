# /update-flow — refresh an existing user-journey flow doc

Update `docs/flows/<slug>.md` to reflect recent code changes. Slug is `$ARGUMENTS`. If empty, ask.

**Rules:**
- One phase at a time.
- Preserve frontmatter fields you're not deliberately changing.
- Always refresh `verified` (today) and `verified_hash` (current HEAD short) on successful update.

---

## Phase 1: Locate

1. If empty, list `docs/flows/`, ask which.
2. Read the doc + parse frontmatter.

## Phase 2: Determine scope

Ask via `AskUserQuestion`:
- "What changed?"
  - "New step inserted in the chain"
  - "Step removed / consolidated"
  - "Entry handler renamed or moved"
  - "Non-obvious fact discovered (add to that section)"
  - "Drift refresh after touching the listed files"

Run drift report:
```bash
node tools/doc-context.js --full --verbose
```
Find this flow. Inspect `commits_since_verify`.

## Phase 3: Inspect changes

For each commit, read the diff. Re-walk the chain — Mermaid diagrams drift quickly when handlers are renamed or steps re-ordered.

## Phase 4: Propose edits

- Update Mermaid diagram if the chain changed
- Update walkthrough prose (each step's file:line)
- Add/remove rows in "Non-obvious facts" and "What this flow doesn't do"
- Refresh frontmatter `verified` + `verified_hash`

Show edits. Ask "Apply" / "Revise" / "Cancel".

## Phase 5: Write

Use `Edit` for surgical changes (most cases). `Write` only if the entire diagram needs rebuilding.

---

**Anti-patterns:**
- Updating prose but leaving the Mermaid diagram stale (or vice versa)
- Forgetting the "What this flow doesn't do" section when code starts/stops doing something
- Bumping `verified_hash` without walking the actual chain
