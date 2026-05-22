# /doc-status — report KB doc drift

Run `node tools/doc-context.js --full --verbose` and surface the result to the user. Read-only — does not modify any doc.

## Steps

1. Run:
   ```bash
   node tools/doc-context.js --full --verbose
   ```
2. If the output is empty or says "No docs affected", tell the user: "KB is clean — no drift."
3. Otherwise, summarize:
   - How many docs are affected
   - Which are drifted (have commits since `verified_hash`) vs. needs-reverify (orphaned hash) vs. missing referenced files
   - For each drifted doc: list the doc name and the count of commits since verify
4. Offer next step via `AskUserQuestion`:
   - "Run `/sync-docs` to update them all"
   - "Pick one to update with `/update-doc <slug>`"
   - "Just informational, do nothing"

**Do not propose edits.** This is a status command. To act on drift, use `/sync-docs` or `/update-doc`.
