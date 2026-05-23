#!/usr/bin/env node
/**
 * doc-context.js — KB doc context fetcher.
 *
 * Reads YAML frontmatter from docs/systems/* and docs/decisions/*, cross-references
 * with git changes, outputs structured context. PURE DATA. Does not modify any doc.
 * Claude consumes the output and decides what to do.
 *
 * Usage:
 *   node tools/doc-context.js                       (silent if nothing affected)
 *   node tools/doc-context.js --staged              (WIP-vs-docs drift)
 *   node tools/doc-context.js --commit HEAD         (latest-commit-vs-docs drift)
 *   node tools/doc-context.js --commit <hash>       (specific commit)
 *   node tools/doc-context.js --changed file1 file2 (explicit file list)
 *   node tools/doc-context.js --full                (historical drift: verified_hash vs HEAD)
 *   node tools/doc-context.js --verbose             (human-readable)
 *
 * Output (JSON to stdout, default):
 *   {
 *     mode: "commit" | "staged" | "changed" | "full",
 *     checked: N,
 *     affected_count: N,
 *     drifted_count: N,
 *     affected: [ { name, path, type, status, verified, verified_hash,
 *                   latest_relevant_commit, changed_files_matched,
 *                   commits_since_verify } ],
 *     missing_referenced_files: [ { doc, file } ],
 *     parse_errors: [ { path, error } ]
 *   }
 *
 * Exit codes:
 *   0  — clean run (regardless of whether any docs are affected)
 *   1  — script error (couldn't read docs dir, git not available, etc.)
 *   2  — YAML parse error in at least one doc (still produces partial output)
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const yaml = require('yaml');

const REPO_ROOT = path.resolve(__dirname, '..');
const DOCS_DIR = path.join(REPO_ROOT, 'docs');
const SYSTEMS_DIR = path.join(DOCS_DIR, 'systems');
const DECISIONS_DIR = path.join(DOCS_DIR, 'decisions');
const REFERENCES_DIR = path.join(DOCS_DIR, 'references');
const FLOWS_DIR = path.join(DOCS_DIR, 'flows');

// ─── CLI parsing ──────────────────────────────────────────────

function parseArgs(argv) {
  const args = { mode: null, files: [], commit: null, verbose: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--staged') args.mode = 'staged';
    else if (a === '--full') args.mode = 'full';
    else if (a === '--verbose') args.verbose = true;
    else if (a === '--commit') {
      args.mode = 'commit';
      args.commit = argv[++i] || 'HEAD';
    } else if (a === '--changed') {
      args.mode = 'changed';
      while (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
        args.files.push(argv[++i]);
      }
    } else if (a === '--help' || a === '-h') {
      printHelp();
      process.exit(0);
    }
  }
  // Default mode if none specified: commit HEAD
  if (!args.mode) {
    args.mode = 'commit';
    args.commit = 'HEAD';
  }
  return args;
}

function printHelp() {
  process.stdout.write([
    'doc-context.js — KB doc context fetcher',
    '',
    'Usage:',
    '  node tools/doc-context.js [mode] [--verbose]',
    '',
    'Modes:',
    '  --staged              WIP-vs-docs drift (git diff --cached)',
    '  --commit <hash>       commit-vs-docs drift (defaults HEAD)',
    '  --changed <files...>  explicit file list',
    '  --full                historical drift (verified_hash vs HEAD)',
    '',
    'Default mode: --commit HEAD',
    '',
  ].join('\n'));
}

// ─── Git helpers ──────────────────────────────────────────────

function git(args, opts = {}) {
  try {
    return execSync(`git ${args}`, { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], ...opts }).trim();
  } catch (e) {
    if (opts.allowFail) return null;
    throw e;
  }
}

function getStagedFiles() {
  const out = git('diff --cached --name-only');
  return out ? out.split('\n').filter(Boolean) : [];
}

function getCommitFiles(commitHash) {
  // Use --name-only on the diff between HEAD~1 and HEAD (or against parent of given commit)
  const out = git(`show --name-only --pretty=format: ${commitHash}`);
  return out ? out.split('\n').filter(Boolean) : [];
}

function getLatestCommitTouching(file) {
  const out = git(`log -1 --format=%h -- ${JSON.stringify(file)}`, { allowFail: true });
  return out || null;
}

function getCommitsBetween(verifiedHash, headHash, files) {
  if (!verifiedHash) return [];
  // Use git log between verified_hash..HEAD for the given files
  const fileArgs = files.map(f => JSON.stringify(f)).join(' ');
  const out = git(`log --format=%h%x09%s ${verifiedHash}..${headHash} -- ${fileArgs}`, { allowFail: true });
  if (!out) return [];
  return out.split('\n').filter(Boolean).map(line => {
    const [hash, subject] = line.split('\t');
    return { hash, subject };
  });
}

function hashExists(hash) {
  if (!hash) return false;
  const out = git(`cat-file -t ${hash}`, { allowFail: true });
  return out === 'commit';
}

// ─── Doc walking ──────────────────────────────────────────────

function listDocFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.md'))
    .map(f => path.join(dir, f));
}

function parseDoc(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  // Frontmatter is bracketed by `---` lines at the very top
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!match) return null; // No frontmatter — skip
  let parsed;
  try {
    parsed = yaml.parse(match[1]);
  } catch (e) {
    throw new Error(`YAML parse error in ${path.relative(REPO_ROOT, filePath)}: ${e.message}`);
  }
  return {
    path: filePath,
    relPath: path.relative(REPO_ROOT, filePath).replace(/\\/g, '/'),
    frontmatter: parsed || {},
  };
}

function loadAllDocs() {
  const docs = [];
  const errors = [];
  const all = [
    ...listDocFiles(SYSTEMS_DIR),
    ...listDocFiles(DECISIONS_DIR),
    ...listDocFiles(REFERENCES_DIR),
    ...listDocFiles(FLOWS_DIR),
  ];
  for (const f of all) {
    try {
      const doc = parseDoc(f);
      if (doc && doc.frontmatter && doc.frontmatter.name) {
        docs.push(doc);
      }
    } catch (e) {
      errors.push({ path: path.relative(REPO_ROOT, f).replace(/\\/g, '/'), error: e.message });
    }
  }
  return { docs, errors };
}

// ─── Cross-reference logic ────────────────────────────────────

function docReferencesFile(doc, file) {
  const files = doc.frontmatter.files || doc.frontmatter.affected_files || [];
  return files.some(f => f === file || file.endsWith(`/${f}`) || f.endsWith(`/${file}`));
}

function findAffected(docs, changedFiles) {
  const affected = [];
  for (const doc of docs) {
    const matched = changedFiles.filter(f => docReferencesFile(doc, f));
    if (matched.length > 0) {
      affected.push({ doc, changedFilesMatched: matched });
    }
  }
  return affected;
}

function checkMissingFiles(docs) {
  const missing = [];
  for (const doc of docs) {
    const files = doc.frontmatter.files || doc.frontmatter.affected_files || [];
    for (const f of files) {
      const abs = path.join(REPO_ROOT, f);
      if (!fs.existsSync(abs)) {
        missing.push({ doc: doc.frontmatter.name, file: f });
      }
    }
  }
  return missing;
}

function checkHistoricalDrift(docs) {
  // For each doc, compare verified_hash against latest commit touching any referenced file.
  // A doc is drifted if there are commits between verified_hash and HEAD that touch its files.
  // ADRs are skipped — they're append-only decision records, not state snapshots. Their
  // "freshness" signal is the log[] array (managed via /log-decision), not verified_hash.
  const drifted = [];
  for (const doc of docs) {
    const fm = doc.frontmatter;
    if (fm.type === 'adr') continue;
    const files = fm.files || fm.affected_files || [];
    if (files.length === 0) continue;

    const verifiedHash = fm.verified_hash;
    const hashOk = verifiedHash && hashExists(verifiedHash);

    if (!hashOk && verifiedHash) {
      // Orphaned hash (rebased/squashed) — flag as needs-reverify
      drifted.push({
        doc,
        status: 'needs-reverify',
        reason: `verified_hash ${verifiedHash} no longer exists in git history`,
      });
      continue;
    }

    if (!verifiedHash) {
      drifted.push({ doc, status: 'no-verified-hash', reason: 'frontmatter missing verified_hash' });
      continue;
    }

    const commits = getCommitsBetween(verifiedHash, 'HEAD', files);
    if (commits.length > 0) {
      drifted.push({
        doc,
        status: 'drifted',
        latestRelevantCommit: commits[0].hash,
        commitsSinceVerify: commits,
      });
    }
  }
  return drifted;
}

// ─── Output formatting ────────────────────────────────────────

function buildAffectedEntry(doc, extras = {}) {
  const fm = doc.frontmatter;
  return {
    name: fm.name,
    path: doc.relPath,
    type: fm.type,
    status: extras.status || 'affected',
    verified: fm.verified,
    verified_hash: fm.verified_hash,
    latest_relevant_commit: extras.latestRelevantCommit || null,
    changed_files_matched: extras.changedFilesMatched || [],
    commits_since_verify: extras.commitsSinceVerify || [],
    reason: extras.reason,
  };
}

function formatJson(result) {
  return JSON.stringify(result, null, 2);
}

function formatVerbose(result) {
  const lines = [];
  lines.push(`Doc Context Report — mode: ${result.mode}`);
  lines.push(`  Checked: ${result.checked} docs`);
  lines.push(`  Affected: ${result.affected_count}`);
  lines.push(`  Drifted: ${result.drifted_count}`);
  lines.push('');
  if (result.affected.length === 0) {
    lines.push('No docs affected.');
  } else {
    lines.push('Affected docs:');
    for (const a of result.affected) {
      lines.push(`  • ${a.name} (${a.path})`);
      lines.push(`      status: ${a.status}`);
      lines.push(`      verified: ${a.verified || '(none)'} @ ${a.verified_hash || '(none)'}`);
      if (a.changed_files_matched.length) {
        lines.push(`      changed files matched: ${a.changed_files_matched.join(', ')}`);
      }
      if (a.commits_since_verify.length) {
        lines.push(`      commits since verify (${a.commits_since_verify.length}):`);
        for (const c of a.commits_since_verify.slice(0, 5)) {
          lines.push(`        - ${c.hash} ${c.subject}`);
        }
        if (a.commits_since_verify.length > 5) {
          lines.push(`        ... and ${a.commits_since_verify.length - 5} more`);
        }
      }
      if (a.reason) lines.push(`      reason: ${a.reason}`);
    }
  }
  if (result.missing_referenced_files.length) {
    lines.push('');
    lines.push('Missing referenced files (frontmatter points to files that no longer exist):');
    for (const m of result.missing_referenced_files) {
      lines.push(`  • ${m.doc}: ${m.file}`);
    }
  }
  if (result.parse_errors.length) {
    lines.push('');
    lines.push('Parse errors:');
    for (const e of result.parse_errors) {
      lines.push(`  • ${e.path}: ${e.error}`);
    }
  }
  return lines.join('\n');
}

// ─── Main ─────────────────────────────────────────────────────

function main() {
  const args = parseArgs(process.argv);
  const { docs, errors } = loadAllDocs();

  let changedFiles = [];
  let affectedRaw = [];

  if (args.mode === 'staged') {
    changedFiles = getStagedFiles();
    affectedRaw = findAffected(docs, changedFiles).map(({ doc, changedFilesMatched }) => ({
      doc, status: 'affected', changedFilesMatched,
    }));
  } else if (args.mode === 'commit') {
    changedFiles = getCommitFiles(args.commit);
    affectedRaw = findAffected(docs, changedFiles).map(({ doc, changedFilesMatched }) => ({
      doc, status: 'affected', changedFilesMatched,
    }));
  } else if (args.mode === 'changed') {
    changedFiles = args.files;
    affectedRaw = findAffected(docs, changedFiles).map(({ doc, changedFilesMatched }) => ({
      doc, status: 'affected', changedFilesMatched,
    }));
  } else if (args.mode === 'full') {
    affectedRaw = checkHistoricalDrift(docs);
  }

  const drifted = affectedRaw.filter(a => a.status === 'drifted' || a.status === 'needs-reverify' || a.status === 'no-verified-hash');

  const result = {
    mode: args.mode,
    checked: docs.length,
    affected_count: affectedRaw.length,
    drifted_count: drifted.length,
    affected: affectedRaw.map(a => buildAffectedEntry(a.doc, a)),
    missing_referenced_files: checkMissingFiles(docs),
    parse_errors: errors,
  };

  // Output
  if (args.verbose) {
    process.stdout.write(formatVerbose(result) + '\n');
  } else {
    // JSON; silent if no affected (for hook integration)
    if (result.affected_count === 0 && result.parse_errors.length === 0 && result.missing_referenced_files.length === 0) {
      // Silent
      process.exit(0);
    }
    process.stdout.write(formatJson(result) + '\n');
  }

  process.exit(errors.length > 0 ? 2 : 0);
}

try {
  main();
} catch (e) {
  process.stderr.write(`doc-context: ${e.message}\n`);
  process.exit(1);
}
