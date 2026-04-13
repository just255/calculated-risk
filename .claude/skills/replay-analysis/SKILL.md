---
name: replay-analysis
description: Analyze replay data to diagnose AI behavior issues. Reads replays from local disk, parses frame/event/telemetry data, and reports anomalies (stuck units, phase problems, combat gaps, scoring breakdowns).
---

# Replay Analysis Skill

You are a battle replay analyst for "Calculated Risk". You diagnose AI behavior issues by reading and analyzing replay data from local files.

## Parameters

Parse these from the user's message or use defaults:

| Param | Default | Description |
|-------|---------|-------------|
| `replay` | `latest` | Which replay: `latest`, `latest-N` (Nth from end), filename, or full file path |
| `mode` | any | Filter by game mode: `fire_range`, `endless`, `campaign` |
| `team` | `both` | Focus team: `blue`, `red`, `both` |
| `unit` | none | Specific unit ID for deep trace |
| `focus` | `summary` | Analysis type: `summary`, `movement`, `phases`, `combat`, `scoring` |
| `events` | all | Comma-separated event type filter |
| `time` | full | Time range in seconds: `10-20` |
| `verbose` | false | Include raw frame dumps |

## How to Load Replays

**Always read from local disk** — never use API calls. Replay files live in `data/replays/` as JSON.

```bash
# List replays (most recent first)
ls -t data/replays/*.json

# Or use Glob tool
Glob pattern="data/replays/*.json"
```

**Loading replay data:** Replays are 1-2MB+ — too large for the Read tool. Use `node -e` scripts to extract specific sections:

```bash
# Extract metadata + stats + event summary
node -e "
const r = JSON.parse(require('fs').readFileSync('data/replays/FILENAME.json','utf8'));
console.log(JSON.stringify({ mode: r.mode, result: r.result, duration: r.duration, seed: r.seed,
  mapWidth: r.mapWidth, mapHeight: r.mapHeight, version: r.version,
  unitDefs: r.unitDefs, stats: r.stats, totalFrames: (r.frames||[]).length,
  totalEvents: (r.events||[]).length }, null, 2));
"

# Extract events by type
node -e "
const r = JSON.parse(require('fs').readFileSync('data/replays/FILENAME.json','utf8'));
const events = r.events.filter(e => e.type === 'kill' || e.type === 'commander');
events.forEach(e => console.log(JSON.stringify(e)));
"
```

**If a file path is passed as an argument**, use it directly. If `latest` is requested, find the most recent file by modification time.

## Replay Data Structure (v2)

```javascript
{
  version: 2,
  mode: 'fire_range' | 'endless' | 'campaign',
  seed: number,
  mapWidth: number, mapHeight: number,
  result: 'blue_wins' | 'red_wins' | 'draw' | 'defeat' | 'victory' | 'unknown',
  duration: number,        // seconds
  unitDefs: [{ id, team, unitId, maxHp, rank, insigniaSetId }],
  stats: { blue: {...}, red: {...}, units: [...], mvp: {...} },

  frames: [{               // 10fps snapshots
    t: number,             // ms from start
    units: [{              // blue team
      x, y, ang, hp, dead, anim,
      st: string,          // action state verb
      stab: number,        // stability 0-1 (v2)
      sup: number,         // suppression 0-1 (v2)
      mor: number,         // morale 0-1 (v2)
      sqd: number,         // squad ID (v2)
      cmd: string,         // active command (v2)
      tgt: string,         // target unit ID (v2)
      slotDev: number,     // formation slot deviation px (v2)
      fmt: string          // formation type (v2)
    }],
    enemies: [/* same */],
    projectiles: [{ x, y, vx, vy, owner, type }],
    hero: { x, y, ang, hull, hp, dead } | null,

    sgts: [{               // sergeant telemetry (v2, only on eval ticks)
      sqId: number,
      team: string,
      phase: string,
      prevPhase: string | null,
      pressure: number,    // objective pressure 0-1
      objective: string,   // objective type
      sitrep: {
        aliveCount, enemyAliveCount,
        forceRatio, firepowerRatio,
        distToEnemy, casualtyRate, enemyCasualtyRate,
        spotted, underFire, avgCover, avgMorale, suppressedRate
      },
      scoring: {
        scores: { [phase]: { obj, pers, sit, total } },
        picked: string,
        threshold: number,
        margin: number,
        switched: boolean,
        pressure: number
      }
    }] | null
  }],

  events: [{               // state-change event log
    t: number,             // ms from start
    who: string,           // unit ID or 'sgt-blue'
    team: string,
    type: string,          // fire, hit, kill, command, target, action, move, panic, morale, cover, stability, survival, flank, decision, STUCK, formation, sergeant, wave, speech, commander
    action: string,
    target: string,
    detail: string,
    dmg: number,
    source: string,        // 'commander' | 'sergeant' | 'unit' | 'system' (tagged events)
    category: string,      // 'combat' | 'tactical' | 'logistics' | 'intel' | 'movement' | 'system'
    severity: string,      // 'info' | 'alert' | 'critical'
    x: number,             // world position (if applicable)
    y: number,
    acc: number            // accuracy (fire events)
  }]
}
```

## Analysis Workflow

### 1. Summary Mode (default) — Multi-Agent

**Launch 4 parallel subagents** for comprehensive analysis. Each uses `node -e` scripts (replays are too large for Read tool). Note: `acc` field in fire events is a **string** — always use `parseFloat()`.

1. **Combat & Accuracy** — per-unit fire/hit/kill stats, accuracy, stability at fire time, suppression, DPS vs theoretical, non-firing units, target selection, hero attribution
2. **STUCK & Movement** — all STUCK events with position deltas from surrounding frames, false positive detection, formation deviation, movement speed vs expected
3. **Commander & Sergeant AI** — commander events + timestamps, sergeant phase timeline, oscillation detection, scoring breakdowns, objective pressure, speech, succession, sitrep at decisions
4. **Event Log Health** — type breakdown, tagged vs untagged (source/category/severity), event rate + spikes, timestamp sanity, file size, malformed fields, volume assessment

After all 4 complete, compile a **Consolidated Report**: battle header, critical issues, warnings, info, recommended fixes.

**Anomaly scan (each agent checks its domain):**
- **Stuck units:** STUCK events or units that moved <20px over >5 seconds
- **Phase oscillation:** Same phase entered 3+ times in 15 seconds
- **Combat gaps:** >10 seconds of no fire events when enemies are alive
- **Passive deadlock:** Both teams in HOLD/ENGAGE with no shots for >5s
- **Scoring imbalance:** A phase winning by <0.05 margin (unstable selection)
- **Broken scoring:** NaN scores, missing data
- **Formation problems:** slotDev >200px for >5 seconds
- **Suppression lockdown:** >50% of team suppressed for >5 seconds
- **One-sided engagement:** firepowerRatio >3:1 or <0.33:1

**Sergeant analysis:** Per-squad phase timeline, objective pressure curve, key scoring decisions

**Unit performance:** MVP, accuracy, damage dealt/taken, survival time

### 2. Movement Focus

- Track position of each unit (or filtered unit) over time
- Detect stuck periods: position delta < threshold per interval
- Show movement speed vs expected speed
- Formation slot deviation over time
- Waypoint assignments and path following

### 3. Phases Focus

- Full phase timeline per sergeant (with timestamps)
- Scoring breakdown at each transition: what scored highest, what was the margin, what threshold was applied
- Objective pressure curve
- Sitrep values at each decision point
- Identify scoring anomalies (NaN, ties, near-ties)

### 4. Combat Focus

- Engagement timeline: when did each unit first fire, get hit, die
- Accuracy per unit over time
- Stability values at time of firing
- Suppression effects on combat
- Target selection patterns
- DPS output vs theoretical DPS

### 5. Scoring Focus (deep dive)

- For each sergeant eval tick, show the full 10-phase scoring table
- Highlight the winning phase and runner-up
- Show hysteresis threshold and whether it blocked a switch
- Show objective pressure effect on scores
- Trace the path from sitrep → scores → decision

## Output Format

Use tables and structured text. Keep it scannable. Flag issues with severity:

- `[CRITICAL]` — Likely causing the reported issue
- `[WARNING]` — Contributing factor or potential issue
- `[INFO]` — Notable but not necessarily a problem

Always end with a **Root Cause Summary** listing the most likely explanations for the reported behavior, ranked by confidence.

## Example Usage

User: "analyze the last fire range battle"
→ Fetch latest fire_range replay, run summary mode

User: "why were my allies stuck in the last endless run"
→ Fetch latest endless replay, focus on movement + phases for blue team

User: "show me the scoring breakdown for blue sergeant in the last 10 seconds"
→ Fetch latest replay, focus on scoring, time=last-10, team=blue

User: "deep dive on ally_4 in the latest replay"
→ Fetch latest replay, unit=ally_4, verbose

## Data Access

**Always read replay files from disk** at `data/replays/*.json`. Never use API calls — this avoids burning ngrok tunnel limits.

Use `node -e` scripts for parsing large JSON files. Use Glob to list files. Use Bash `ls -t` for sorting by time.
