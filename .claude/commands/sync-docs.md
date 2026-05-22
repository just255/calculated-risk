# /sync-docs — batch-update drifted KB docs

Run the full drift report and walk through each affected doc with the user, invoking the `/update-doc` workflow per doc.

## Steps

1. Run:
   ```bash
   node tools/doc-context.js --full
   ```
   Parse the JSON output. Capture the `affected` array.

2. If `affected_count === 0`, tell the user "KB is clean — no drift." and exit.

3. Summarize what was found:
   - Total drifted count
   - List doc names + status (`drifted` / `needs-reverify` / `no-verified-hash`)
   - List any `missing_referenced_files` separately — these need `files:` frontmatter cleanup before re-verification

4. Ask via `AskUserQuestion`:
   - "Process all in order" / "Pick which to process" / "Cancel"

5. For each doc to process, follow the `/update-doc <slug>` workflow:
   - Phase 1 (locate) is already done — you have the path
   - Phase 2 (scope) — use the `commits_since_verify` from the drift report
   - Phases 3–5 proceed normally

6. After each doc, ask: "Continue to next?" / "Pause here" / "Cancel remaining".

7. When done, summarize how many docs were updated and remind the user to commit them.

---

**Anti-patterns:**
- Batching all edits without per-doc user review — drift fixes are often non-trivial and need approval
- Skipping `missing_referenced_files` — those are louder signals than drift (a file is gone or renamed)
- Running silently without surfacing the report — the user should see what's being touched
