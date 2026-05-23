# /update-ref — refresh an existing object-shape reference

Update `docs/references/<slug>.md` to reflect recent code changes. Slug is `$ARGUMENTS`. If empty, ask the user which reference.

**Rules:**
- One phase at a time.
- Preserve frontmatter fields you're not deliberately changing.
- Always refresh `verified` (today) and `verified_hash` (current HEAD short) on successful update.
- The table must remain exhaustive — never leave fields out.

---

## Phase 1: Locate

1. If `$ARGUMENTS` empty, list `docs/references/`, ask which.
2. Read the doc + parse frontmatter (note `files:`, `verified_hash`).

## Phase 2: Determine scope

Ask via `AskUserQuestion`:
- "What changed?"
  - "Field added"
  - "Field renamed / shape changed"
  - "Field removed (mark REMOVED + cite ADR)"
  - "New set/read site for existing field"
  - "Drift refresh after touching the listed files"

Run drift report:
```bash
node tools/doc-context.js --full --verbose
```
Find this reference in the output. Note `commits_since_verify` — those commits are what to inspect.

## Phase 3: Inspect changes

For each commit (or the user's described change):
- Read the diff: `git show <hash> -- <files>`
- For each new/changed field, find every set + read site (grep)
- For removed fields, locate the ADR that retired them

## Phase 4: Propose edits

Specific edits to the table + sections:
- Field added: new row with type, set sites, read sites
- Field removed: convert row to **REMOVED** + ADR link, do NOT delete the row (prevents reintroduction)
- Field renamed: update name, preserve history in Notes if it'd help
- New set/read site: append to existing row's columns
- Persistence / Invariants / Gotchas: update if the change affects them

Always update frontmatter `verified` → today, `verified_hash` → current HEAD short.

Show the edit list. Ask "Apply all" / "Apply some" / "Revise" / "Cancel".

## Phase 5: Write

Use `Edit` for surgical changes; `Write` only for full table rewrites. Verify by re-reading the frontmatter section.

---

**Anti-patterns:**
- Deleting REMOVED rows — they're load-bearing (prevent reintroducing the field)
- Bumping `verified_hash` without actually re-checking the code
- Leaving the table partial after a field rename (rename both the row and any cross-refs in other docs)
