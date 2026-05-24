---
name: cursors
type: system
status: stable
verified: 2026-05-24
verified_hash: 6c586a5
tags: [cursors, reticle, settings, ui, customization]
files:
  - js/cursor-library.js
  - js/cursor-apply.js
  - js/hero-hud.js
  - js/main.js
  - js/state.js
  - js/storage.js
  - js/ui.js
  - index.html
entry_points:
  - "cursor-library.js BUILT_IN_CURSORS (4 seed entries)"
  - "cursor-library.js buildCursorSvg(entry, colors)"
  - "cursor-library.js sanitizeSvg(text) — paste-upload validator"
  - "cursor-apply.js applyMenuCursor() — writes --cursor-menu to :root"
  - "cursor-apply.js resolveBattleReticle() — called from renderHeroCrosshair"
  - "ui.js settingsCursorsHTML — Settings → Cursors sub-tab"
related:
  - systems/battle-phases.md
  - systems/deploy-panel.md
  - references/battle.md
---

# Cursors

## Purpose

Two kinds of pointer:

1. **Menu cursor** — the OS-rendered cursor on HQ / Settings / deploy / replay surfaces. Defaults to `d3-amber` (amber gradient arrow with shadow). CSS-cursor via `data:image/svg+xml` URI on `:root` custom property `--cursor-menu`.
2. **Battle reticle** — the canvas-rendered crosshair inside `renderHeroCrosshair`. Defaults to `original` (the historical tick crosshair). Spread accuracy circle, reload arc, aim line, and ammo counter stay independent of which reticle is picked.

Both are user-customizable per save slot: pick from the built-in library, edit named color regions, save as a custom variant, or paste an SVG.

## Quick Reference

- "What entries exist?" → `BUILT_IN_CURSORS` in `js/cursor-library.js`.
- "Where does the menu cursor get applied?" → `applyMenuCursor()` in `js/cursor-apply.js` (called from `main.js` `initApp` + `slot-select` action + every cursors-tab edit).
- "Where does the battle reticle get drawn?" → `js/hero-hud.js` at the `!skipCrosshair` block calls `entry.canvasDraw(ctx, aimX, aimY, colors, opts)`.
- "Where is the picker UI?" → `js/ui.js settingsCursorsHTML` (renders inside `settingsHTML` when `Game.hqSettingsView === 'cursors'`).
- "Custom SVG paste validator" → `sanitizeSvg(text)` in `js/cursor-library.js`.

## Entry Shape

```js
{
  id: 'd3-amber',
  name: 'Amber Arrow',
  type: 'menu' | 'battle',
  parts: [
    { token: 'fillTop', label: 'Highlight', default: '#fde68a' },
    { token: 'fillBottom', label: 'Shadow', default: '#d97706' },
    { token: 'outline', label: 'Outline', default: '#1a1f2e' }
  ],
  template: '<svg …{{fillTop}}…/>',  // SVG with {{token}} placeholders
  hotspot: [3, 3],                    // menu only — [x, y] in 0..32
  canvasDraw: (ctx, x, y, colors, opts) => {…}  // battle only
}
```

- `type === 'menu'` → `template` is the cursor itself (applied via `buildCursorSvg`); `hotspot` required.
- `type === 'battle'` → `template` is for picker thumbnails only; `canvasDraw` does the live render.

### The `'auto'` sentinel

The `original` battle reticle exposes `stroke` and `center` parts with default `'auto'`. This is **not a color** — it tells `canvasDraw` to use the dynamic `opts.crossColor` (red/green/gray based on alignment + ready state) at runtime. Custom entries derived from `original` can override `'auto'` with any concrete color.

The picker thumbnails substitute `'auto'` → `#94a3b8` (dim gray) so the swatch renders.

## Built-in Library

| id           | type   | parts                              | notes |
|--------------|--------|------------------------------------|-------|
| d3-amber     | menu   | fillTop, fillBottom, outline       | Default menu cursor. Gradient + soft drop shadow filter. |
| original     | battle | stroke (auto), shadow, center (auto)| Default battle reticle. Ports `js/hero-hud.js:193–212` (shadow + colored ticks + center dot). |
| b1-olive     | battle | stroke, center                     | Circle + 4 ticks + center dot. Olive/amber. |
| b2-diamond   | battle | stroke, inner, center              | Diamond outline + inner cross + center dot. Orange/amber. |

## Custom Variants (per save slot)

`Game.settings.cursors.custom` is `[]` initially. Two shapes:

1. **Library-derived** (from "Save as Custom"): `{ id, baseId, name, type, colors }`. Resolved by `getCursor` merging with `BUILT_IN_CURSORS.find(b => b.id === baseId)` — base supplies `template` / `canvasDraw` / `hotspot`; custom's `colors` becomes the part defaults.
2. **User-uploaded** (from "Add Custom SVG" paste): `{ id, baseId: null, name, type, template, parts, hotspot? }`. Self-contained. The sanitizer extracts parts from elements marked `data-part="<token>"` (with optional `data-part-label="<friendly>"`).

IDs are `custom-${Date.now()}` (sortable, single-user collision-free).

## State Shape

```js
Game.settings.cursors = {
  menu:   { id: 'd3-amber', colors: undefined | {token: '#hex'} },
  battle: { id: 'original',  colors: undefined | {token: '#hex' | 'rgba(…)'} },
  custom: [ {id, baseId, name, type, colors?} | {id, baseId:null, name, type, template, parts, hotspot?} ]
}
```

`colors` on a selection overrides the entry's part defaults at render time via `resolveColors(entry, sel.colors)`. Set to `undefined` by Reset.

`Game.hqSettingsView` — `'general' | 'cursors'` — selects which Settings sub-tab renders.

`Game._cursorAddDrawer` — `{slot, text, parsed?, svg?, parts?, err?}` while the Add Custom SVG drawer is open; `null` otherwise.

## Apply Layer

### Menu cursor

`applyMenuCursor()` writes:
```css
:root { --cursor-menu: url("data:image/svg+xml;utf8,<encoded>") <hotX> <hotY>, auto; }
```
CSS rule in `index.html` (~line 10484) applies `cursor: var(--cursor-menu)` to `body` **and** every interactive element (`button`, `a`, `label`, `select`, `summary`, `[data-action]`, `[data-toggle]`, `[data-set]`, `[data-control]`, `[data-cursor-part]`, `.menu-btn`, `.setting-btn`, `.cursor-swatch`, `.toggle`, color/range/checkbox inputs). The explicit selector list overrides the user-agent default `cursor: pointer` on buttons — without it the chosen cursor only showed in empty space (fixed `6c586a5`). `.endless-battlefield.hero-crosshair { cursor: none; }` still wins during active combat so the canvas crosshair takes over.

Called from:
- `js/main.js initApp()` after preloads — applies in-memory defaults pre-load.
- `js/main.js slot-select` action — re-applies per-slot settings.
- `js/main.js` cursor handlers (`cursor-select`, `cursor-reset`, color input, etc.) — live preview on every edit.

### Battle reticle

`renderHeroCrosshair` in `js/hero-hud.js` (around line 193) dispatches:
```js
const { entry, colors } = resolveBattleReticle();
entry.canvasDraw(ctx, aimX, aimY, colors, { crossColor, ready, skipCrosshair });
```
- Called every frame the function runs (already phase-gated to `phase === 'active'` at the call site in `js/battle-renderer.js`).
- `skipCrosshair` is set when infantry-on-mobile has joystick aim active — `canvasDraw` reduces to just the center dot in that case (matches pre-refactor behavior).
- `canvasDraw` lives inside the entry; the rest of `renderHeroCrosshair` (spread circle, reload arc, ammo text, ready flash) is unchanged.

## Persistence

`Game.settings.cursors` rides the existing `cr_save` slot-prefixed key in `js/storage.js` `save()`/`load()`. Migration:
- On `load()`, if `data.settings.cursors` is missing → default-init to `{ menu: {id:'d3-amber'}, battle: {id:'original'}, custom: [] }`.
- On `load()`, if `data.settings.cursors` is present → shallow-merge; custom array reinitialized to `[]` if not an array.
- On every selection-id resolve (`getCursorSettings` in `cursor-apply.js`), validate id resolves; reset to default if not (handles future renames / removed customs).

No new localStorage key.

## Settings UI

`Game.hqSettingsView === 'cursors'` renders `settingsCursorsHTML()`:

- Two-column grid (`MENU CURSOR`, `BATTLE RETICLE`).
- Each column: thumbnail grid (4 per row) + selected entry name + per-part color rows + actions.
- Color input is `<input type="color" data-cursor-part="<token>" data-cursor-slot="menu|battle">`. Handled by an `input` event listener in `js/main.js` that updates `Game.settings.cursors[slot].colors[token]`, calls `applyMenuCursor()` (menu only), `save()`, `render()`.
- Action buttons:
  - `cursor-select` (`data-id`, `data-slot`) — switch entry, clear colors override.
  - `cursor-reset` — clear `colors` on the selected slot.
  - `cursor-save-custom` — clone selected entry (baked colors) into a new `custom-${Date.now()}` and switch to it.
  - `cursor-delete` — remove a custom entry (only shown on customs); falls back to default if it was selected.
  - `cursor-add-open` — open the paste drawer.
  - `cursor-add-validate` — runs `sanitizeSvg`; success → preview, failure → error message.
  - `cursor-add-save` — adds sanitized SVG as new `custom-${Date.now()}` with `template`, `parts`, `type` set.
  - `cursor-add-close` — close drawer.

## Sanitization

`sanitizeSvg(text)` in `js/cursor-library.js`:
- Rejects: missing viewBox, non-`<svg>` root, >10kb, parser errors.
- Element whitelist: `svg, defs, g, path, line, rect, circle, ellipse, polygon, polyline, linearGradient, radialGradient, stop, filter, feGaussianBlur, feOffset, feMerge, feMergeNode, feComponentTransfer, feFuncA, feFlood, feComposite`. Everything else is removed.
- Attribute whitelist on every kept element. `on*` always stripped. `href`/`xlink:href` only allowed if value starts with `#` (in-document references).
- Extracts editable parts from `data-part="<token>"` (+ optional `data-part-label="<friendly>"`), using `fill` or `stroke` as the default color.

## Gotchas

- **Hotspot is menu-only.** Battle entries have no hotspot; they draw at the aim point. Mixing the concepts in one entry shape would invite bugs — kept separate by convention.
- **`'auto'` is not a color.** The picker thumbnail substitutes `'auto'` → `#94a3b8`, but `cursor-library.js` `buildCursorSvg` itself doesn't know about the sentinel. Only the swatch render fn in `js/ui.js` substitutes. If you build a thumbnail somewhere new, do the same substitution.
- **Battle reticle doesn't render in Proving Ground.** `js/battle-renderer.js:184` gates `renderHeroCrosshair` on `!b.fireRange` so PG hero (if observer) shows nothing — by design. Custom reticle changes still apply in endless/campaign hero-controlled battles.
- **Live preview during settings doesn't show the battle reticle.** The picker thumbnail updates, but the canvas only runs during active combat. Use the swatch grid to compare; full rendering happens once you're in battle.
- **CSS variable + `cursor:` works in modern Chromium.** Verified at `89ac2f8` follow-up. If a future browser regression breaks it, the fallback is rewriting a managed `<style>` tag — see plan risks for the architecture.
- **Custom SVGs without `data-part`** become static-color cursors — only name/delete actions, no color editing. Mark editable regions with `data-part="myToken"` in your paste.

## Cross-references

- [Battle Phases](battle-phases.md) — `phase === 'active'` gate on the canvas crosshair render
- [Deploy Panel](deploy-panel.md) — menu cursor active during the `deploying` phase
- [Battle reference](../references/battle.md) — battle state shape

---

*Update by running `/update-doc cursors` after touching the listed files. Always refresh `verified` + `verified_hash`.*
