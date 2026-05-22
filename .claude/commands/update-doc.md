# /update-doc — refresh an existing system doc

Update `docs/systems/<slug>.md` to reflect recent code changes. The slug is `$ARGUMENTS`. If empty, ask the user which doc.

**Rules:**
- One phase at a time. Never skip ahead.
- Use `AskUserQuestion` for all clarifying choices.
- Preserve frontmatter fields you're not deliberately changing.
- Always refresh `verified` (today's date) and `verified_hash` (current HEAD short) on any successful update.

---

## Phase 1: Locate the doc

1. If `$ARGUMENTS` is empty, list docs in `docs/systems/` and ask which.
2. Read the doc, parse the frontmatter, note `files`, `verified`, `verified_hash`.

## Phase 2: Determine scope of update

Ask via `AskUserQuestion`:
- "What triggered the update?"
  - "Code changed (drift refresh)"
  - "Found a gotcha / wrong info"
  - "Status change (stable ↔ in-flux ↔ legacy)"
  - "Adding new section / cross-reference"

Then run drift report for context:
```bash
node tools/doc-context.js --full --verbose
```
Find this doc in the output. Note `commits_since_verify` — these are the commits to inspect.

## Phase 3: Inspect the changes

For each commit in `commits_since_verify` (or the user's described change):
- Read the diff: `git show <hash> -- <files from frontmatter>`
- Identify what changed semantically (renames, new functions, behavior changes)
- If the diff is large or unclear, dispatch an `Explore` subagent to re-trace the relevant slice

## Phase 4: Propose edits

Build a list of specific section edits. Examples:
- "Quick Reference: add `roster.js:184 dedupeArmoryByOwnerSlot`"
- "Gotchas: append entry for the mission.js double-equip bug (resolved 2026-05-21)"
- "State Shape: rename `Game.foo.items` → `Game.foo.entries`"

Always update:
- Frontmatter `verified` → today's date
- Frontmatter `verified_hash` → `git rev-parse --short HEAD`
- Frontmatter `files` if any code was renamed/moved

Present the edit list. Ask via `AskUserQuestion`:
- "Apply all" / "Apply some (I'll pick)" / "Revise proposal" / "Cancel"

## Phase 5: Write the edits

Use `Edit` (preferred) or `Write` (for large rewrites). Verify the result by re-reading the file's frontmatter.

Tell the user the doc is updated and remind them to commit it alongside the code change that triggered the drift.

---

**Anti-patterns:**
- Updating only the body without refreshing `verified`/`verified_hash`
- Bumping `verified` without actually re-reading the code
- Rewriting sections that weren't affected (preserve unrelated content verbatim)
- Removing a gotcha just because you don't remember the incident — gotchas accumulate
