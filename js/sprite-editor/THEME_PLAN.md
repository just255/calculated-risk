# Sprite Editor Theming Plan

## Phases

### Phase 1: CSS Variables
- Move all colors/sizes to `--var` in CSS
- Single source of truth for UI styling

### Phase 2: Canvas Theme
- Create `theme.js` with canvas overlay styles
- Labels, markers, grid, checkerboard

### Phase 3: Settings Storage
- Save/load theme prefs to localStorage
- Persist user customizations

### Phase 4: UI Panel
- Add theme editor in settings
- Color pickers, sliders, font options

### Phase 5: Presets
- Dark (default)
- Light
- High Contrast

### Phase 6: Import/Export
- JSON theme files for sharing
- Community themes

## Themeable Items

### UI
- Panel backgrounds
- Button styles
- Text colors
- Border colors
- Accent/highlight colors

### Canvas
- Grid colors/size
- Checkerboard colors/size
- Selection outline (marching ants)

### Overlays
- Measurement labels (font, colors, padding)
- Cursor markers
- Click-place crosshair

### Tool Defaults
- Default stroke color
- Default fill color
- Default stroke width
