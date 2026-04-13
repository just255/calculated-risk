const fs = require('fs');
const path = require('path');

const files = [
  'data/replays/20260321-215701-665462.json',
  'data/replays/20260321-215745-643544.json',
  'data/replays/20260321-215904-628379.json',
  'data/replays/20260321-220958-486440.json',
  'data/replays/20260321-221718-865539.json',
  'data/replays/20260321-222719-984184.json',
  'data/replays/20260321-223216-66767.json',
];

const advancingStates = new Set(['advancing','bounding_advance','closing_to_fire','aiming']);
const fleeingStates = new Set(['breaking_los','hidden','rushing_to_cover','falling_back','disengaging']);

const rows = [];

for (const f of files) {
  const r = JSON.parse(fs.readFileSync(f, 'utf8'));
  const fname = path.basename(f);
  const frames = r.frames || [];
  const frameCount = frames.length;
  const duration = (frameCount / 10).toFixed(1);
  const mapW = r.mapWidth;
  const mapH = r.mapHeight;

  const result = r.result || 'unknown';
  const isWin = result.includes('complete') || result === 'victory';

  const bs = r.stats?.blue || {};
  const rs = r.stats?.red || {};

  const heroFirst = frames[0]?.hero;
  const heroLast = frames[frameCount - 1]?.hero;
  const heroHpStart = heroFirst?.hp ?? 'N/A';
  const heroHpEnd = heroLast?.hp ?? 'N/A';

  // Red behavior analysis
  let redAdvFrames = 0, redFleeFrames = 0, redTotalStateFrames = 0;
  let survivalEvents = 0;

  // Track unit positions for stuck detection
  const unitEdgeFrames = {}; // index -> count of alive-near-edge frames

  for (let fi = 0; fi < frameCount; fi++) {
    const frame = frames[fi];
    const enemies = frame.enemies || [];

    for (let ei = 0; ei < enemies.length; ei++) {
      const e = enemies[ei];
      if (e.dead) continue;
      redTotalStateFrames++;
      if (advancingStates.has(e.st)) redAdvFrames++;
      if (fleeingStates.has(e.st)) redFleeFrames++;
      if (e.st === 'survival') survivalEvents++;

      // Edge detection
      const edgeMargin = 50;
      if (e.x < edgeMargin || e.x > mapW - edgeMargin || e.y < edgeMargin || e.y > mapH - edgeMargin) {
        unitEdgeFrames[ei] = (unitEdgeFrames[ei] || 0) + 1;
      }
    }
  }

  const redAdvPct = redTotalStateFrames > 0 ? (redAdvFrames / redTotalStateFrames * 100).toFixed(1) : '0.0';
  const redFleePct = redTotalStateFrames > 0 ? (redFleeFrames / redTotalStateFrames * 100).toFixed(1) : '0.0';

  let stuckCount = 0;
  for (const [key, count] of Object.entries(unitEdgeFrames)) {
    if (count > 100) stuckCount++;
  }

  // Perf analysis
  const perfLog = r.perfLog || [];
  let aiSum = 0, aiCount = 0, aiPeak = 0;
  for (const p of perfLog) {
    const avg = p.avgAi;
    if (avg !== undefined) {
      aiSum += avg;
      aiCount++;
      if (avg > aiPeak) aiPeak = avg;
    }
  }
  const avgAi = aiCount > 0 ? (aiSum / aiCount).toFixed(1) : 'N/A';
  const peakAi = aiPeak.toFixed(1);

  rows.push({
    fname: fname.replace('.json',''),
    result: isWin ? 'WIN' : 'LOSS',
    resultRaw: result,
    duration,
    mapSize: mapW + 'x' + mapH,
    blueAlive: bs.survivors + '/' + bs.total,
    redAlive: rs.survivors + '/' + rs.total,
    blueShots: bs.shots, blueHits: bs.hits, blueKills: bs.kills, blueAcc: bs.accuracy + '%',
    redShots: rs.shots, redHits: rs.hits, redKills: rs.kills, redAcc: rs.accuracy + '%',
    redDmg: rs.damage,
    heroHp: heroHpStart + ' -> ' + heroHpEnd,
    redAdvPct: redAdvPct + '%',
    redFleePct: redFleePct + '%',
    survivalEvents,
    avgAi,
    peakAi,
    stuckCount,
  });
}

// Print table
console.log('');
console.log('='.repeat(180));
console.log('REPLAY ANALYSIS - Session 2026-03-21');
console.log('='.repeat(180));
console.log('');

const cols = [
  ['#', 2],
  ['Filename', 30],
  ['Result', 6],
  ['Dur(s)', 6],
  ['Map', 11],
  ['Blue A/T', 8],
  ['Red A/T', 7],
  ['B Sh/Hi/Ki', 11],
  ['B Acc', 5],
  ['R Sh/Hi/Ki', 11],
  ['R Acc', 5],
  ['R Dmg', 5],
  ['Hero HP', 12],
  ['R Adv%', 6],
  ['R Flee%', 7],
  ['Surv', 4],
  ['AvgAI', 6],
  ['PkAI', 5],
  ['Edge', 4],
];

const header = cols.map(([name, w]) => name.padEnd(w)).join(' | ');
console.log(header);
console.log(cols.map(([_, w]) => '-'.repeat(w)).join('-+-'));

for (let i = 0; i < rows.length; i++) {
  const r = rows[i];
  const vals = [
    String(i+1).padEnd(2),
    r.fname.padEnd(30),
    r.result.padEnd(6),
    r.duration.padStart(6),
    r.mapSize.padEnd(11),
    r.blueAlive.padEnd(8),
    r.redAlive.padEnd(7),
    (r.blueShots+'/'+r.blueHits+'/'+r.blueKills).padEnd(11),
    r.blueAcc.padStart(5),
    (r.redShots+'/'+r.redHits+'/'+r.redKills).padEnd(11),
    r.redAcc.padStart(5),
    String(r.redDmg).padStart(5),
    r.heroHp.padEnd(12),
    r.redAdvPct.padStart(6),
    r.redFleePct.padStart(7),
    String(r.survivalEvents).padStart(4),
    r.avgAi.padStart(6),
    r.peakAi.padStart(5),
    String(r.stuckCount).padStart(4),
  ];
  console.log(vals.join(' | '));
}

console.log('');
console.log('Raw results: ' + rows.map(r => r.resultRaw).join(', '));

console.log('');
console.log('='.repeat(180));
console.log('TREND ANALYSIS');
console.log('='.repeat(180));

// Helpers
const advValues = rows.map(r => parseFloat(r.redAdvPct));
const fleeValues = rows.map(r => parseFloat(r.redFleePct));
const dmgValues = rows.map(r => r.redDmg);
const aiAvgValues = rows.map(r => parseFloat(r.avgAi));
const redAccValues = rows.map(r => parseInt(r.redAcc));
const redKillValues = rows.map(r => r.redKills);
const heroHpEnds = rows.map(r => {
  const parts = r.heroHp.split(' -> ');
  return parseInt(parts[1]) || 0;
});

const avg = arr => arr.reduce((a,b) => a+b, 0) / arr.length;
const avgFirst3 = arr => avg(arr.slice(0, 3));
const avgLast3 = arr => avg(arr.slice(-3));

console.log('');
console.log('--- Red Aggression (Advancing %) ---');
rows.forEach((r, i) => {
  const v = parseFloat(r.redAdvPct);
  const bar = '#'.repeat(Math.round(v / 2));
  console.log('  ' + (i+1) + '. ' + r.redAdvPct.padStart(6) + ' ' + bar);
});
console.log('  Early avg: ' + avgFirst3(advValues).toFixed(1) + '% -> Late avg: ' + avgLast3(advValues).toFixed(1) + '%');

console.log('');
console.log('--- Red Fleeing % ---');
rows.forEach((r, i) => {
  const v = parseFloat(r.redFleePct);
  const bar = '#'.repeat(Math.round(v / 2));
  console.log('  ' + (i+1) + '. ' + r.redFleePct.padStart(7) + ' ' + bar);
});
console.log('  Early avg: ' + avgFirst3(fleeValues).toFixed(1) + '% -> Late avg: ' + avgLast3(fleeValues).toFixed(1) + '%');

console.log('');
console.log('--- Red Damage Dealt ---');
rows.forEach((r, i) => {
  const bar = '#'.repeat(Math.round(r.redDmg / 10));
  console.log('  ' + (i+1) + '. ' + String(r.redDmg).padStart(5) + ' ' + bar);
});
console.log('  Early avg: ' + avgFirst3(dmgValues).toFixed(0) + ' -> Late avg: ' + avgLast3(dmgValues).toFixed(0));

console.log('');
console.log('--- AI Performance (avg ms per tick) ---');
rows.forEach((r, i) => {
  const bar = '#'.repeat(Math.round(parseFloat(r.avgAi)));
  console.log('  ' + (i+1) + '. ' + r.avgAi.padStart(6) + 'ms (peak ' + r.peakAi + 'ms) ' + bar);
});
console.log('  Overall avg: ' + avg(aiAvgValues).toFixed(1) + 'ms, Session peak: ' + Math.max(...rows.map(r => parseFloat(r.peakAi))).toFixed(1) + 'ms');

console.log('');
console.log('--- Key Findings ---');
console.log('');
console.log('  RESULTS: ' + rows.filter(r=>r.result==='WIN').length + ' wins, ' + rows.filter(r=>r.result==='LOSS').length + ' losses out of 7 battles');
console.log('  RED KILLS: ' + redKillValues.join(', ') + ' (total: ' + redKillValues.reduce((a,b)=>a+b,0) + ')');
console.log('  RED ACCURACY: ' + rows.map(r=>r.redAcc).join(', ') + ' | early avg ' + avgFirst3(redAccValues).toFixed(0) + '% -> late avg ' + avgLast3(redAccValues).toFixed(0) + '%');
console.log('  HERO HP (end): ' + heroHpEnds.join(', ') + ' | hero took damage in ' + heroHpEnds.filter(h => h < 200).length + '/7 battles');
console.log('  SURVIVAL EVENTS: ' + rows.map(r=>r.survivalEvents).join(', ') + ' (total: ' + rows.map(r=>r.survivalEvents).reduce((a,b)=>a+b,0) + ')');
console.log('  EDGE-STUCK UNITS: ' + rows.map(r=>r.stuckCount).join(', ') + ' (' + rows.filter(r=>r.stuckCount>0).length + '/7 battles had edge-stuck units)');

// Red state distribution across all replays
console.log('');
console.log('--- Red State Distribution (all replays combined) ---');
const stateCounts = {};
for (const f of files) {
  const r = JSON.parse(fs.readFileSync(f, 'utf8'));
  for (const frame of r.frames) {
    for (const e of (frame.enemies || [])) {
      if (e.dead) continue;
      stateCounts[e.st] = (stateCounts[e.st] || 0) + 1;
    }
  }
}
const totalStates = Object.values(stateCounts).reduce((a,b) => a+b, 0);
const sorted = Object.entries(stateCounts).sort((a,b) => b[1] - a[1]);
for (const [st, count] of sorted) {
  const pct = (count / totalStates * 100).toFixed(1);
  const bar = '#'.repeat(Math.round(count / totalStates * 50));
  console.log('  ' + st.padEnd(25) + String(count).padStart(6) + ' (' + pct.padStart(5) + '%) ' + bar);
}
console.log('');
