# /add-ref — author a new object-shape reference

Walk the user through writing `docs/references/<slug>.md` — a canonical field reference for an in-memory object (e.g., Soldier, Item, Battle). Slug is `$ARGUMENTS`. If empty, ask.

**Rules:**
- One phase at a time. Never skip.
- Use `AskUserQuestion` for clarifying choices.
- Use `docs/templates/reference.md` as the skeleton.
- The table must be **exhaustive** — every field. Reference docs lose value the moment they're partial.

---

## Phase 1: Identify the object

1. Confirm slug + glob `docs/references/<slug>.md` — redirect to `/update-ref` if it exists.
2. Identify the object: where does an instance live (e.g., `Game.roster[]`)? What's its primary constructor function + file:line?

## Phase 2: Build the field inventory

Dispatch an `Explore` subagent with the object's constructor file as the entry point. Brief it to:
- Read the constructor function and list **every field** it sets, with type and default
- Grep the codebase for every other site that **sets** any field on objects of this shape (e.g., `s.foo =`, `Object.assign(s, ...)`, migrations, post-processors)
- Grep for every site that **reads** non-trivial fields (skip universal ones like `.id` / `.name` — note as "universal" instead)
- Flag any fields that ONLY appear in old save files (deprecated / removed)
- Return a structured table draft

## Phase 3: Verify + augment

1. Read the constructor file yourself — spot-check 3-5 fields against the agent's findings
2. For each removed field, find the ADR that retired it (if any) and add a **REMOVED** row pointing at it
3. Add Invariants section: rules that must hold (id uniqueness, mutual-exclusion of fields, etc.) and which code enforces them
4. Add Persistence section: saved/loaded/migrated-by + storage key
5. Add Gotchas section: known landmines specific to this shape

## Phase 4: Review with user

Present the draft. Ask via `AskUserQuestion`: "Approve and write?" / "Revise section X" / "Add a field I forgot" / "Cancel".

## Phase 5: Write

Write to `docs/references/<slug>.md`. Remind the user to commit.

---

**Anti-patterns:**
- Partial field tables (every field must appear or the reference is worse than no doc)
- Confusing "set sites" with "read sites" — the table column matters
- Skipping the construction sites section — that's where bugs cluster
- Inventing fields you didn't see in code (grep before adding a row)
