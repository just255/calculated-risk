# /add-flow — author a new user-journey flow doc

Walk the user through writing `docs/flows/<slug>.md` — a cross-system sequence diagram for a user-driven journey (e.g., intro mission, recruit + equip, save+load). Slug is `$ARGUMENTS`. If empty, ask.

**Rules:**
- One phase at a time.
- Use `AskUserQuestion` for clarifying choices.
- Use `docs/templates/flow.md` as the skeleton.
- Flow docs describe **cross-system orchestration** — defer to system docs for per-system detail.

---

## Phase 1: Identify the trigger

1. Confirm slug + glob `docs/flows/<slug>.md` — redirect to `/update-flow` if it exists.
2. Identify the user action that starts the flow (button click, key press, mount event) and the entry handler.

## Phase 3: Trace the chain

Dispatch an `Explore` subagent with the entry handler as the starting point. Brief it to:
- Walk the call chain across modules, capturing each function + file:line
- Note which `Game.*` fields are mutated at each step
- Flag any **non-obvious facts** — e.g., "does NOT call load()", "fires async without awaiting", "bypasses normal X path"
- Return: ordered call sequence + per-step file:line refs + non-obvious facts list

## Phase 3: Draft the diagram

Build a Mermaid `sequenceDiagram` from the call chain. Keep participants to 4-6 (user + 3-5 modules). Hide internal helper calls — flow docs are about the cross-system trace, not the internal call tree.

## Phase 4: Walkthrough + non-obvious facts

For each step in the diagram, write 1-2 sentences pairing it with file:line refs. Highlight non-obvious facts in the dedicated section — these are the gotchas the diagram alone won't convey.

Also fill out **"What this flow doesn't do"** — things readers might assume happen but don't. This section catches the most common comprehension errors.

## Phase 5: Review with user

Present the draft. Ask via `AskUserQuestion`: "Approve and write?" / "Revise sequence" / "Add a non-obvious fact" / "Cancel".

## Phase 6: Write

Write to `docs/flows/<slug>.md`. Remind the user to commit.

---

**Anti-patterns:**
- Recreating system-internal call trees (use system docs for that)
- More than ~6 participants in the diagram (loses scannability)
- Skipping non-obvious facts — that's the highest-value section
- Stale flow that doesn't match current code (verify with grep before finalizing)
