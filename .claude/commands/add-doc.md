# /add-doc — author a new system doc

Walk the user through writing a new system doc in `docs/systems/<slug>.md` via phased Q&A. The slug is `$ARGUMENTS` (kebab-case, no extension). If empty, ask the user for one.

**Rules:**
- One phase at a time. Never skip ahead.
- Use `AskUserQuestion` for all clarifying choices.
- Summarize before proceeding to the next phase.
- Do NOT write the file until Phase 6.
- Use `docs/templates/system.md` as the structural template — copy its sections exactly.

---

## Phase 1: Verify slug + check for collision

1. Confirm slug is kebab-case. If `$ARGUMENTS` is empty or malformed, ask:
   > "What kebab-case slug for this doc? (e.g., `soldier-lifecycle`)"
2. Check `docs/systems/<slug>.md` doesn't already exist (use `Glob`).
3. If it exists, redirect the user to `/update-doc <slug>` and exit.

## Phase 2: Discover scope

Ask via `AskUserQuestion`:
- What subsystem does this doc cover? *(open-ended via "Other")*
- What's the primary entry point? *(file:line or function name)*

Then ask the user to list the files that belong to this system. If they're unsure, offer to dispatch an Explore agent to trace from the entry point.

## Phase 3: Trace the code

Dispatch an `Explore` (or `general-purpose`) subagent to trace the system:
- Map the call graph from entry point(s)
- Identify state locations (`Game.foo`, `localStorage.cr_xxx`, module-private)
- List every function that mutates state
- Identify persistence (save/load) paths
- Find any gotchas / non-obvious behaviors

Brief the subagent fully: paste the entry points, files list, and ask for a structured report matching the system doc template's body sections.

## Phase 4: Draft proposal

Build the draft in memory (do NOT write yet). Use `docs/templates/system.md` as the skeleton. Fill in:
- Frontmatter (`name`, `type: system`, `status: stable`, `verified: <today>`, `verified_hash: <current HEAD short hash>`, `tags`, `files`, `entry_points`, `related`)
- Every body section. Mark "N/A" if truly not applicable (the user must agree).

Get current HEAD hash:
```bash
git rev-parse --short HEAD
```

## Phase 5: Review with user

Present the draft. Ask via `AskUserQuestion`:
- "Approve and write?" / "Revise section X" / "Add a gotcha I forgot" / "Cancel"

If revise, loop back. Do not write until "Approve and write" is selected.

## Phase 6: Write + index

1. Write the file via `Write` tool to `docs/systems/<slug>.md`.
2. Tell the user the file is written and remind them to commit it alongside any code changes.

---

**Anti-patterns:**
- Writing the doc before the user has approved the draft
- Skipping the Explore step because "I already know the code" — fresh sessions don't have your context
- Inventing entries for `files:` or `entry_points:` without verifying they exist
- Leaving body sections blank instead of writing "N/A"
