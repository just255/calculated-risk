# Glossary

Domain terms used across the project. Cross-link from system docs with `[term](glossary.md#term)`.

Alphabetical. One paragraph per term, with code refs where applicable.

---

## battle phases (deploying / countdown / active)

The three primary states of a live battle. **Deploying** — deploy panel open, no AI/projectile updates, user picks squad composition and leader assignments. **Countdown** — 3-2-1-GO timer, no enemy actions yet. **Active** — full game loop running (AI, projectiles, waves, hero control). Defined in the `State` enum (`js/constants.js`) alongside terminal states (`wave_complete`, `victory`, `defeat`, `paused`). See [battle-phases](systems/battle-phases.md).

## commendation floor (mmrFloor)

A ratchet on a soldier's MMR — once awarded a commendation, the soldier's effective MMR can never drop below the floor. `soldier.mmrFloor` is set by `recordBattleScore` (`js/roster.js`); `getMMR(soldier)` returns `max(mmr, mmrFloor)`. Preserves recognition across losing streaks.

## effectiveMorale

The single number that gates band-based AI behavior (rout, survival, competition, obey). Computed by `computeEffectiveMorale` at `js/ai.js:758` as `morale + discipline×0.3 + sgtLeadership×0.2 + veterancy×0.1`. Can exceed 1.0 with high modifiers. Drives transitions in unit decision making — see [follower brain](../memory/project_follower_brain.md) memory for context.

## hero / hero unit

The player-controlled unit (`Game.hero`) — a soldier the user directly drives via on-screen joystick + fire button (mobile) or keyboard (desktop). Distinct from squad members controlled by the AI pipeline. Has its own HUD, magazine state, and stat application path.

## insignia

Visual squad markings (chevrons, stripes, emblems) painted on vehicles and uniforms. Data lives in `data/insignia/`. Authored via the Insignia Editor (HQ → Barracks → Insignia sub-tab). Modules: `js/insignia-editor.js`, `js/insignia-renderer.js`, `js/insignia-pixel.js`. Tied to a soldier or squad via `soldier.insigniaSetId`.

## kit

A *saved* loadout for a specific MOS, persisted on the soldier as `soldier.kits[mos][slot] = itemId`. Lets a soldier quickly swap to a different role's standard loadout without re-picking each item. Distinct from `loadout`, which is what's *currently equipped*.

## lineage

The influence of memorialized soldiers on future recruit generation. `getMemorialLineageInfluence` (`js/roster.js`) returns the memorial wall; recruit personality fields are seeded from those entries, so the player's storied dead leave a mark on the next generation. See [memorial system](../memory/project_squad_identity.md) memory.

## loadout

The soldier's *currently-equipped* items, as `soldier.loadout[slot] = itemId`. Slots: `primary`, `sidearm`, `optic`, `attachment`, `armor`, `utility`. Distinct from `kits` (saved per-MOS templates).

## memorial

The user-curated wall of fallen soldiers (5 fixed slots, score-based tiers bronze/silver/gold). A KIA qualifies via legacy score (`mmrFloor + 3×battlesServed`, threshold 150). Stored at `Game.memorial`; persisted under `cr_s<slot>_cr_memorial`. See `js/roster.js:556` (`MEMORIAL_MAX_SLOTS`) and `js/roster.js:627` (`addToMemorial`).

## MMR

Skill rating — a Glicko/Elo-style number representing the soldier's combat skill. Read via `getMMR(soldier)` at `js/roster.js:348`. Mutated by `recordBattleScore` post-battle. Drives promotion eligibility (`checkPromotion`, `RANK_TABLE` thresholds). Floored by commendation ratchet — see [commendation floor](#commendation-floor-mmrfloor).

## MOS

Military Occupational Specialty (e.g., `rifleman`, `medic`, `tc`, `gunner`, `driver`). Stored on `soldier.mos`. Defined in `js/constants.js` (`MOS_DEFINITIONS` at line 2066, `INFANTRY_MOS`, `CAMPAIGN_MOS`). Gates weapon access (`MOS_WEAPON_ACCESS` at `js/gear-templates.js:32`) and contributes to training proficiency growth multipliers (`MOS_GROWTH_MULTIPLIER`).

## physicals

Per-soldier physical attributes on `soldier.physicals`: `vision`, `strength`, `reflexes`, `endurance` (0–100 each). Drive combat performance — `vision` affects detection range, `strength` reduces incoming damage, `reflexes` improves accuracy, `endurance` reduces miss chance. Grown via training and combat experience. See `docs/physical-stats-crosstraining.md` for the planned cross-training system.

## PPB

Points Per Battle — the contribution score awarded to a soldier per engagement, blended from role-specific metrics (TC, gunner, driver scored differently). Drives MMR change post-battle. All current PPB weights are placeholder pending playtesting — see [feedback_ppb_tuning](../memory/feedback_ppb_tuning.md) memory.

## reinforcement

A mid-mission soldier spawn. `generateMissionReinforcements` (`js/mission.js:190`) creates 5 reinforcement soldiers per `launchMission` call, each fully equipped via `equipSoldierStandardIssue`. Note: this is per-launch — orphaned items from prior launches are cleaned by `dedupeArmoryByOwnerSlot` on load.

## S5 (proficiency tier)

A 5-star tier mapping over the 0–1 proficiency range, 1 star per 20%: TRAINEE (0–19%), RECRUIT (20–39%), REGULAR (40–59%), VETERAN (60–79%), MASTER (80–100%). Used in the dossier proficiency pill + expanded panel. See [ADR-0001-s5-star-thresholds](decisions/ADR-0001-s5-star-thresholds.md).

## save slot

The game supports 10 independent save slots, selected from the title screen. Every localStorage key is prefixed `cr_s<slot>_` (e.g., `cr_s0_cr_roster`). Active slot metadata lives at the unprefixed key `cr_slots`. See `js/storage.js:12` (`SLOT_META_KEY`).

## standard issue

The default gear loadout for a given MOS, produced by `createStandardIssue(mos, soldierId)` (`js/armory.js`) and bound by `equipSoldierStandardIssue` (`js/roster.js:1658`). Items are created fresh per soldier (not pooled). Sets `item.equipped = true` and immediately saves the armory.

## training

Per-role proficiency on `soldier.training[role]` (0.0–1.0). Grows during battles based on the role the soldier filled. Capped at `TRAINING_CAP = 1.0`. Affects role-specific multipliers in combat (e.g., a gunner with higher training stabilizes faster). Distinct from [physicals](#physicals) (raw attributes) and [MMR](#mmr) (overall skill rating).

## veterancy

Battles-served bonus contributing to `effectiveMorale` (×0.1 weight). Higher veterancy = steadier under fire. Stored implicitly via `battlesServed` and `streak` on the soldier; capped at 0.4 in migration backfills.

---

*Add new terms in alphabetical order. Cross-link from system docs to keep usage discoverable.*
