# /log-decision — record an architecture decision

Either author a new ADR or append a Log entry to an existing one. The slug is `$ARGUMENTS`. If empty, ask the user.

**Rules:**
- ADRs are append-only. Never edit prior Log entries or prior body sections after acceptance.
- Both the body's `## Log` section AND the frontmatter `log:` array must stay in sync.
- New ADRs use the next free `ADR-NNNN` number, zero-padded.

---

## Phase 1: Detect new vs. existing

1. Glob `docs/decisions/ADR-*-<slug>.md`.
2. If exists → **append-log flow** (Phase A).
3. If not → **new-ADR flow** (Phase B).

If `$ARGUMENTS` is empty, ask the user for a slug (kebab-case, no number prefix).

---

## Phase A — Append Log entry to existing ADR

A1. Read the existing ADR. Note current status.

A2. Ask via `AskUserQuestion`:
- "What kind of update?"
  - "Implementation milestone (still accurate)"
  - "Refinement (small adjustment to the decision)"
  - "Supersede (this ADR is now obsolete; new ADR replaces it)"
  - "Deprecate (no replacement, just retired)"

A3. Ask for a one-line note describing what changed. Get current HEAD hash:
```bash
git rev-parse --short HEAD
```

A4. Propose two edits:
- Append to body `## Log` section: `- **<today> @ <hash>:** <note>`
- Append to frontmatter `log:` array: `{ date, hash, note }`
- If superseding: also change frontmatter `status:` to `superseded-by-ADR-NNNN` (ask which)
- If deprecating: change `status:` to `deprecated`

A5. Show diff. Ask "Apply" / "Revise" / "Cancel". Write on approval.

---

## Phase B — Author new ADR

B1. Find next free number: `ls docs/decisions/ | grep -oE '^ADR-[0-9]+' | sort | tail -1`, increment.

B2. Q&A through each section (`AskUserQuestion` with "Other" for open text):

- **Context** — What prompted this? Constraints? Why now? Ask the user to describe; if they're terse, ask follow-ups.
- **Decision** — What was chosen? One paragraph.
- **Alternatives Considered** — At least one alternative + status quo. Ask the user to list options + cons.
- **Consequences** — What's easier, what's harder, what cost was accepted.

B3. Ask for `affected_files` (which code files this decision constrains) and `related` (which system docs / other ADRs).

B4. Get current HEAD hash for the initial Log entry:
```bash
git rev-parse --short HEAD
```

B5. Draft the full ADR using `docs/templates/adr.md` skeleton:
- Frontmatter with `status: accepted`, today's date, deciders `[dev, claude]`, initial `log:` entry
- Body sections filled in
- Body `## Log` matches frontmatter (one entry)

B6. Present draft. Ask "Approve and write" / "Revise section X" / "Cancel".

B7. Write to `docs/decisions/ADR-NNNN-<slug>.md`.

---

**Anti-patterns:**
- Editing a prior Log entry instead of appending a new one
- Forgetting to sync body `## Log` with frontmatter `log:` array
- Reusing an ADR number that's already taken
- Skipping "Alternatives Considered" — the value of an ADR is partly the rejected options
- Vague decisions like "we'll think about it later" — if it's not actually decided, it's not an ADR
