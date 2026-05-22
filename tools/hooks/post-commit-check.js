#!/usr/bin/env node
/**
 * PostToolUse hook — fires after every Bash tool use.
 *
 * Reads the tool invocation JSON from stdin. If the command was a git commit,
 * runs doc-context.js against HEAD and emits the result as additionalContext
 * so Claude can decide whether the commit affected any documented systems.
 *
 * Silent (no output) if:
 *   - The Bash command was not a git commit
 *   - The git commit failed (non-zero exit; tool_response.success === false)
 *   - doc-context found no affected docs
 *
 * Designed to be idempotent and fast. Any error short-circuits to silent exit
 * so a broken hook never blocks the user's commit flow.
 */

const { execSync, spawnSync } = require('child_process');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
    // Safety: if no stdin within 2s, resolve empty
    setTimeout(() => resolve(data), 2000);
  });
}

function isGitCommit(cmd) {
  if (!cmd || typeof cmd !== 'string') return false;
  // Must contain "git commit" but not "git commit --help", "git commit-tree", etc.
  // Simple heuristic: match `git commit` followed by space or end
  return /\bgit\s+commit(\s|$)/.test(cmd);
}

function commitSucceeded(toolResponse) {
  if (!toolResponse) return true; // assume yes if we can't tell
  // tool_response.exit_code === 0, or tool_response.success === true
  if (typeof toolResponse.exit_code === 'number') return toolResponse.exit_code === 0;
  if (typeof toolResponse.success === 'boolean') return toolResponse.success;
  return true;
}

async function main() {
  const raw = await readStdin();
  if (!raw) { process.exit(0); }

  let payload;
  try { payload = JSON.parse(raw); } catch { process.exit(0); }

  const cmd = payload?.tool_input?.command;
  if (!isGitCommit(cmd)) { process.exit(0); }
  if (!commitSucceeded(payload?.tool_response)) { process.exit(0); }

  // Run doc-context against HEAD
  const result = spawnSync(
    process.execPath,
    [path.join(REPO_ROOT, 'tools', 'doc-context.js'), '--commit', 'HEAD'],
    { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
  );

  // If silent (no affected docs), exit silent
  const out = (result.stdout || '').trim();
  if (!out) { process.exit(0); }

  // Build additionalContext message
  const additional = [
    '## KB doc-context (PostToolUse, git commit HEAD)',
    '',
    'The commit you just made touches files referenced by one or more KB docs. Review the affected docs against the actual code changes and propose updates (refresh `verified` + `verified_hash`, and update body if logic changed). If the change is cosmetic-only, no doc update is needed — say so and move on.',
    '',
    '```json',
    out,
    '```',
  ].join('\n');

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      additionalContext: additional,
    },
  }));
}

main().catch(() => process.exit(0));
