const r = require('./data/replays/20260311-231034-641240.json');
const fires = r.events.filter(e => e.action === 'fire');
const hits = r.events.filter(e => e.action === 'hit');

function parseDetail(d) {
  const m = {};
  d.split(' ').forEach(p => {
    const [k,v] = p.split(':');
    if (k && v) m[k] = parseFloat(v);
  });
  return m;
}

const defMap = {};
r.unitDefs.forEach(d => defMap[d.id] = d.unitId);

// ======= 1. PER-UNIT ACCURACY =======
console.log('=== 1. PER-UNIT ACCURACY WITH STABILITY ===\n');

const unitFires = {};
fires.forEach(f => {
  if (!unitFires[f.who]) unitFires[f.who] = [];
  unitFires[f.who].push(f);
});
const unitHits = {};
hits.forEach(h => {
  if (!unitHits[h.who]) unitHits[h.who] = [];
  unitHits[h.who].push(h);
});

const allUnits = new Set([...Object.keys(unitFires), ...Object.keys(unitHits)]);
const sorted = [...allUnits].sort();

for (const uid of sorted) {
  const fList = unitFires[uid] || [];
  const hList = unitHits[uid] || [];
  const team = fList[0]?.team || hList[0]?.team || '?';
  const type = defMap[uid] || '?';
  const stabs = fList.map(f => parseDetail(f.detail).stability).filter(s => s !== undefined);
  const accs = fList.map(f => parseFloat(f.acc)).filter(a => !isNaN(a));
  const avgStab = stabs.length ? (stabs.reduce((a,b)=>a+b,0)/stabs.length).toFixed(3) : 'N/A';
  const avgAcc = accs.length ? (accs.reduce((a,b)=>a+b,0)/accs.length).toFixed(3) : 'N/A';
  const hitRate = fList.length ? (hList.length / fList.length * 100).toFixed(1) : 'N/A';
  console.log(`  ${uid.padEnd(12)} [${type.padEnd(10)}] ${team.padEnd(5)} shots:${String(fList.length).padStart(3)} hits:${String(hList.length).padStart(3)} hitRate:${hitRate.padStart(6)}%  avgAcc:${avgAcc}  avgStab:${avgStab}`);
}
for (const team of ['blue','red']) {
  const tFires = fires.filter(f => f.team === team);
  const tHits = hits.filter(h => h.team === team);
  console.log(`  ${team.toUpperCase()} TOTAL: ${tFires.length} shots, ${tHits.length} hits, ${(tHits.length/tFires.length*100).toFixed(1)}%`);
}

// ======= 2. TARGET SWITCHING COUNT =======
console.log('\n=== 2. TARGET SWITCHING PER UNIT ===\n');

const choseEvents = r.events.filter(e => e.action.startsWith('chose '));
const targetEvents = r.events.filter(e => e.action.startsWith('target \u2192 '));
const lostTarget = r.events.filter(e => e.action === 'lost target');

const choseByUnit = {};
choseEvents.forEach(e => {
  if (!choseByUnit[e.who]) choseByUnit[e.who] = 0;
  choseByUnit[e.who]++;
});
const switchByUnit = {};
targetEvents.forEach(e => {
  if (!switchByUnit[e.who]) switchByUnit[e.who] = 0;
  switchByUnit[e.who]++;
});
const lostByUnit = {};
lostTarget.forEach(e => {
  if (!lostByUnit[e.who]) lostByUnit[e.who] = 0;
  lostByUnit[e.who]++;
});

const allTargetUnits = new Set([...Object.keys(choseByUnit), ...Object.keys(switchByUnit)]);
for (const uid of [...allTargetUnits].sort()) {
  const type = defMap[uid] || '?';
  const team = choseEvents.find(e => e.who === uid)?.team || targetEvents.find(e => e.who === uid)?.team || '?';
  console.log(`  ${uid.padEnd(12)} [${type.padEnd(10)}] ${team.padEnd(5)} chose:${String(choseByUnit[uid]||0).padStart(3)}  switches:${String(switchByUnit[uid]||0).padStart(3)}  lost:${String(lostByUnit[uid]||0).padStart(3)}`);
}
console.log(`  TOTAL chose: ${choseEvents.length}, switches: ${targetEvents.length}, lost: ${lostTarget.length}`);

// Show sherman switching specifically
console.log('\n  Sherman target-switch detail:');
for (const uid of [...allTargetUnits].sort()) {
  if (!uid.includes('shm')) continue;
  const myChoices = choseEvents.filter(e => e.who === uid).map(e => `${(e.t/1000).toFixed(1)}s:${e.action.replace('chose ','')}`);
  const mySwitches = targetEvents.filter(e => e.who === uid).map(e => `${(e.t/1000).toFixed(1)}s:${e.action.replace('target \u2192 ','')}`);
  console.log(`    ${uid}: choices=[${myChoices.join(', ')}]`);
  console.log(`    ${uid}: switches=[${mySwitches.join(', ')}]`);
}

// ======= 3. SUPPRESSION AT FIRE TIME =======
console.log('\n=== 3. SUPPRESSION LEVELS AT FIRE TIME ===\n');

// Check frame data for suppression
const frame0 = r.frames[0];
const sampleUnit = frame0.units?.[0];
console.log('  Frame unit fields:', sampleUnit ? Object.keys(sampleUnit) : 'none');

// Fire detail fields
const allKeys = new Set();
fires.forEach(f => {
  f.detail.split(' ').forEach(p => {
    const k = p.split(':')[0];
    if (k) allKeys.add(k);
  });
});
console.log('  Fire detail fields:', [...allKeys]);

// Check if there's suppression data in frames near fire times
// Look for 'sup' or similar field in unit frame data
if (sampleUnit) {
  const hasSupp = 'sup' in sampleUnit || 'suppression' in sampleUnit || 'stress' in sampleUnit;
  console.log('  Has suppression in frames:', hasSupp);
  if (hasSupp) {
    // Cross-reference fire events with frame suppression
    for (const uid of sorted) {
      const fList = unitFires[uid] || [];
      if (fList.length === 0) continue;
      const supAtFire = [];
      fList.forEach(f => {
        // Find nearest frame
        const frame = r.frames.reduce((best, fr) => Math.abs(fr.t - f.t) < Math.abs(best.t - f.t) ? fr : best, r.frames[0]);
        const allFrameUnits = [...(frame.units||[]), ...(frame.enemies||[])];
        const fUnit = allFrameUnits.find(u => u.id === uid);
        if (fUnit && (fUnit.sup !== undefined || fUnit.stress !== undefined)) {
          supAtFire.push(fUnit.sup ?? fUnit.stress ?? 0);
        }
      });
      if (supAtFire.length) {
        const avg = (supAtFire.reduce((a,b)=>a+b,0)/supAtFire.length).toFixed(3);
        const max = Math.max(...supAtFire).toFixed(3);
        console.log(`    ${uid.padEnd(12)} avg sup at fire: ${avg}  max: ${max}  samples: ${supAtFire.length}`);
      }
    }
  } else {
    console.log('  Suppression not recorded in frame data. Checking stability as proxy...');
    // Stability < 1.0 often correlates with suppression/movement
    for (const uid of sorted) {
      const fList = unitFires[uid] || [];
      if (fList.length === 0) continue;
      const stabs = fList.map(f => parseDetail(f.detail).stability).filter(s => s !== undefined);
      const lowStab = stabs.filter(s => s < 0.8).length;
      const veryLowStab = stabs.filter(s => s < 0.5).length;
      console.log(`    ${uid.padEnd(12)} fires:${fList.length}  stab<0.8:${lowStab}  stab<0.5:${veryLowStab}  minStab:${stabs.length ? Math.min(...stabs).toFixed(3) : 'N/A'}`);
    }
  }
}

// ======= 4. ACCURACY DISTRIBUTION =======
console.log('\n=== 4. FIRE ACCURACY DISTRIBUTION (HISTOGRAM) ===\n');

const buckets = ['0.0-0.2', '0.2-0.4', '0.4-0.6', '0.6-0.8', '0.8-1.0'];
for (const team of ['blue', 'red']) {
  const teamFires = fires.filter(f => f.team === team);
  const hist = [0,0,0,0,0];
  teamFires.forEach(f => {
    const acc = parseFloat(f.acc);
    if (isNaN(acc)) return;
    const idx = Math.min(Math.floor(acc * 5), 4);
    hist[idx]++;
  });
  console.log(`  ${team.toUpperCase()} (${teamFires.length} shots):`);
  for (let i = 0; i < 5; i++) {
    const bar = '#'.repeat(hist[i]);
    console.log(`    ${buckets[i]}: ${String(hist[i]).padStart(3)} ${bar}`);
  }
  const accs = teamFires.map(f => parseFloat(f.acc)).filter(a => !isNaN(a)).sort((a,b) => a-b);
  if (accs.length) {
    console.log(`    median: ${accs[Math.floor(accs.length/2)].toFixed(3)}  min: ${accs[0].toFixed(3)}  max: ${accs[accs.length-1].toFixed(3)}`);
  }
}

// ======= 5. TIME OF FIRST FIRE PER UNIT =======
console.log('\n=== 5. TIME OF FIRST FIRE PER UNIT ===\n');

for (const uid of sorted) {
  const fList = unitFires[uid] || [];
  if (fList.length === 0) continue;
  const first = fList[0];
  const last = fList[fList.length - 1];
  const team = first.team;
  const type = defMap[uid] || '?';
  const tSec = (first.t / 1000).toFixed(1);
  const span = ((last.t - first.t) / 1000).toFixed(1);
  console.log(`  ${uid.padEnd(12)} [${type.padEnd(10)}] ${team.padEnd(5)} first: ${tSec.padStart(6)}s  last: ${(last.t/1000).toFixed(1).padStart(6)}s  span: ${span}s  target: ${first.target}`);
}

// Spotted events for context
console.log('\n  First spotted per unit:');
const spotted = r.events.filter(e => e.action === 'spotted');
const spottedByUnit = {};
spotted.forEach(e => {
  if (!spottedByUnit[e.who]) spottedByUnit[e.who] = e;
});
for (const uid of Object.keys(spottedByUnit).sort()) {
  const e = spottedByUnit[uid];
  console.log(`    ${uid.padEnd(12)} spotted at ${(e.t/1000).toFixed(1)}s`);
}

// ======= SUMMARY =======
console.log('\n=== SUMMARY ===');
console.log(`  Duration: ${(r.duration/1000).toFixed(1)}s  Result: ${r.result}`);
console.log(`  Total fires: ${fires.length}  Hits: ${hits.length}  Overall: ${(hits.length/fires.length*100).toFixed(1)}%`);
console.log(`  Kills: ${r.events.filter(e => e.action === 'kill').length}`);

// Compare target switching to previous battle
console.log('\n  TARGET SWITCH COMPARISON (vs previous battle with 11-12 switches/sherman):');
for (const uid of [...allTargetUnits].sort()) {
  if (!uid.includes('shm')) continue;
  const sw = (switchByUnit[uid]||0);
  const ch = (choseByUnit[uid]||0);
  console.log(`    ${uid}: ${sw} switches, ${ch} choices (prev battle: ~11-12 switches)`);
}
