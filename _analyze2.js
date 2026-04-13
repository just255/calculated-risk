const r = require('./data/replays/20260311-231034-641240.json');

const shermans = [
  { name: 'b.shm.0', arr: 'units', idx: 4 },
  { name: 'b.shm.1', arr: 'units', idx: 5 },
  { name: 'r.shm.0', arr: 'enemies', idx: 4 },
  { name: 'r.shm.1', arr: 'enemies', idx: 5 },
];

// 3. TURRET ANGLE STABILITY
console.log('=== 3. TURRET ANGLE STABILITY (every ~0.5s) ===');

for (const sh of shermans) {
  console.log('\n--- ' + sh.name + ' ---');
  let prevAng = null;
  let prevTime = 0;
  const angVels = [];

  for (let f = 0; f < r.frames.length; f += 5) {
    const frame = r.frames[f];
    const u = frame[sh.arr][sh.idx];
    if (!u || u.dead) break;

    const timeSec = frame.t / 1000;
    const ang = u.ang;
    const isEngaged = u.tgt && u.tgt !== '';

    if (prevAng !== null) {
      const dt = timeSec - prevTime;
      if (dt > 0) {
        let diff = ang - prevAng;
        while (diff > Math.PI) diff -= 2 * Math.PI;
        while (diff < -Math.PI) diff += 2 * Math.PI;
        const angVel = Math.abs(diff) / dt;
        angVels.push({ t: timeSec, angVel, engaged: isEngaged });
      }
    }
    prevAng = ang;
    prevTime = timeSec;
  }

  if (angVels.length > 0) {
    const engaged = angVels.filter(v => v.engaged);
    const idle = angVels.filter(v => !v.engaged);

    const avgAll = angVels.reduce((s, v) => s + v.angVel, 0) / angVels.length;
    const avgEngaged = engaged.length > 0 ? engaged.reduce((s, v) => s + v.angVel, 0) / engaged.length : 0;

    const oscillating = engaged.filter(v => v.angVel > 0.5).length;
    const settled = engaged.filter(v => v.angVel < 0.1).length;

    console.log('  Samples: ' + angVels.length + ' total, ' + engaged.length + ' engaged, ' + idle.length + ' idle');
    console.log('  Avg angular velocity: overall=' + avgAll.toFixed(3) + ' rad/s, engaged=' + avgEngaged.toFixed(3));
    console.log('  While engaged: ' + oscillating + '/' + engaged.length + ' oscillating (>0.5 rad/s), ' + settled + '/' + engaged.length + ' settled (<0.1 rad/s)');

    const worst = [...engaged].sort((a, b) => b.angVel - a.angVel).slice(0, 5);
    console.log('  Worst 5: ' + worst.map(v => 't=' + v.t.toFixed(1) + 's vel=' + v.angVel.toFixed(2)).join(', '));
  }
}

// 4. STATE TIMELINE
console.log('\n=== 4. STATE TIMELINE (Shermans) ===');

for (const sh of shermans) {
  console.log('\n--- ' + sh.name + ' ---');
  const stateCounts = {};
  let totalFrames = 0;
  let deathTime = null;

  for (let f = 0; f < r.frames.length; f++) {
    const frame = r.frames[f];
    const u = frame[sh.arr][sh.idx];
    if (!u) break;
    if (u.dead) {
      if (!deathTime) deathTime = frame.t / 1000;
      continue;
    }
    totalFrames++;
    const st = u.st || 'unknown';
    stateCounts[st] = (stateCounts[st] || 0) + 1;
  }

  if (deathTime) console.log('  Died at: ' + deathTime.toFixed(1) + 's');
  console.log('  Alive frames: ' + totalFrames);

  const entries = Object.entries(stateCounts).sort((a, b) => b[1] - a[1]);
  for (const [st, cnt] of entries) {
    const pct = (100 * cnt / totalFrames).toFixed(1);
    console.log('  ' + st + ': ' + pct + '% (' + cnt + ' frames)');
  }
}

// Battle result
console.log('\n=== BATTLE RESULT ===');
console.log('Duration: ' + r.duration.toFixed(1) + 's, Result: ' + r.result);
const lastFrame = r.frames[r.frames.length - 1];
const blueAlive = lastFrame.units.filter(u => !u.dead).length;
const redAlive = lastFrame.enemies.filter(u => !u.dead).length;
console.log('Final: blue alive=' + blueAlive + '/' + lastFrame.units.length + ', red alive=' + redAlive + '/' + lastFrame.enemies.length);
