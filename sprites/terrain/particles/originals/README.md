# Particle Sprites - Originals

Save AI-generated particle sprites here (typically 256x256 or larger).

## Expected Files

### Seasonal Particles (Primary)
```
leaf-particles-1.png, leaf-particles-2.png, leaf-particles-3.png           # Green summer
leaf-fall-particles-1.png, leaf-fall-particles-2.png, leaf-fall-particles-3.png  # Autumn
leaf-dry-particles-1.png, leaf-dry-particles-2.png, leaf-dry-particles-3.png     # Brown dried
petal-particles-1.png, petal-particles-2.png, petal-particles-3.png        # Spring petals
needle-particles-1.png, needle-particles-2.png, needle-particles-3.png     # Pine needles
twig-particles-1.png, twig-particles-2.png, twig-particles-3.png           # Dead tree debris
```

## Post-Processing

After saving originals, resize to 256x256 for the game:

```bash
cd sprites/terrain/particles
for f in originals/*.png; do magick "$f" -filter point -resize 256x256 "resized/$(basename "$f")"; done
```

Or on Windows PowerShell:
```powershell
Get-ChildItem originals\*.png | ForEach-Object { magick $_.FullName -filter point -resize 256x256 "resized\$($_.Name)" }
```

See `particle-prompts.md` for generation prompts.
