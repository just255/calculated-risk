#!/usr/bin/env node
/**
 * SessionStart hook — fires at the start of every Claude Code session.
 *
 * Emits a briefing as additionalContext containing:
 *   - git status --short (uncommitted work)
 *   - git log --oneline -5 (recent activity)
 *   - doc-context --staged --verbose (WIP-vs-docs drift)
 *   - doc-context --full --verbose (historical drift from prior commits)
 *
 * Designed to be a passive briefing — Claude reads, optionally addresses, then
 * proceeds with the user's instruction. Never blocking; any failure produces
 * a partial briefing rather than no briefing.
 */

const { spawnSync } = require('child_process');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

function run(cmd, args = []) {
  const r = spawnSync(cmd, args, { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return {
    stdout: (r.stdout || '').trim(),
    stderr: (r.stderr || '').trim(),
    code: r.status,
  };
}

function git(args) { return run('git', args); }
function docContext(args) {
  return run(process.execPath, [path.join(REPO_ROOT, 'tools', 'doc-context.js'), ...args]);
}

function section(title, body) {
  return body ? `### ${title}\n\n${body}\n` : `### ${title}\n\n_(none)_\n`;
}

function main() {
  const status = git(['status', '--short']).stdout;
  const log = git(['log', '--oneline', '-5']).stdout;
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']).stdout;

  const staged = docContext(['--staged', '--verbose']);
  const full = docContext(['--full', '--verbose']);

  // Filter "No docs affected" noise unless that's the only thing in the report
  const stagedReport = staged.stdout.includes('No docs affected') ? '_(no WIP drift)_' : staged.stdout;
  const fullReport = full.stdout.includes('No docs affected') ? '_(no historical drift)_' : full.stdout;

  const briefing = [
    '## Session start briefing',
    '',
    `**Branch:** \`${branch}\``,
    '',
    section('Working tree (git status --short)', status ? '```\n' + status + '\n```' : null),
    section('Recent commits (last 5)', log ? '```\n' + log + '\n```' : null),
    section('KB doc drift — WIP (staged)', '```\n' + stagedReport + '\n```'),
    section('KB doc drift — historical (verified_hash vs HEAD)', '```\n' + fullReport + '\n```'),
    '',
    '_Skim, address obvious drift if any, then proceed with the user\'s instruction._',
  ].join('\n');

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: briefing,
    },
  }));
}

try { main(); } catch { process.exit(0); }
