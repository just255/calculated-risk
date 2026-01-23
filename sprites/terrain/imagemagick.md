# ImageMagick Setup for Sprite Processing

ImageMagick is used for resizing sprites with pixel-perfect nearest-neighbor interpolation.

## Installation

1. Download from https://imagemagick.org/script/download.php
2. Choose the Windows installer (e.g., `ImageMagick-7.x.x-Q16-HDRI-x64-dll.exe`)
3. Run the installer - default location is `C:\Program Files\ImageMagick-7.x.x-Q16-HDRI\`

## PATH Issue

ImageMagick is **not** added to the system PATH by default. If `magick` is not recognized in PowerShell/CMD:

### Option A: Use full path in scripts (recommended)

```powershell
$magick = "C:\Program Files\ImageMagick-7.1.2-Q16-HDRI\magick.exe"
& $magick input.png -filter point -resize 256x256 output.png
```

### Option B: Add to PATH manually

1. Open System Properties → Environment Variables
2. Edit the `Path` variable (User or System)
3. Add `C:\Program Files\ImageMagick-7.1.2-Q16-HDRI\`
4. Restart terminal/PowerShell

## Verify Installation

```powershell
# Find where ImageMagick is installed
Get-ChildItem -Path 'C:\Program Files\*' -Include 'magick.exe' -Recurse -ErrorAction SilentlyContinue

# Test it works (use full path if not in PATH)
& "C:\Program Files\ImageMagick-7.1.2-Q16-HDRI\magick.exe" -version
```

---

## Common Commands

### Resize with nearest-neighbor (pixel art)

```powershell
$magick = "C:\Program Files\ImageMagick-7.1.2-Q16-HDRI\magick.exe"

# Single file
& $magick input.png -filter point -resize 256x256 output.png

# Batch process folder
Get-ChildItem "originals\*.png" | ForEach-Object {
    $out = "resized\$($_.Name)"
    Write-Host "Processing $($_.Name)..."
    & $magick $_.FullName -filter point -resize 256x256 $out
}
```

### Key flags

| Flag | Purpose |
|------|---------|
| `-filter point` | Nearest-neighbor interpolation (preserves hard pixel edges) |
| `-resize 256x256` | Target dimensions |
| `-resize 256x256!` | Force exact size (ignore aspect ratio) |
| `-resize 50%` | Scale by percentage |

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| `'magick' is not recognized` | Use full path or add to PATH |
| Blurry/soft result | Ensure `-filter point` is used |
| Jagged edges | Expected for pixel art - do NOT use anti-aliasing |
| Colors shifted | Ensure PNG color profile is sRGB |
| Semi-transparent artifacts | Check alpha channel in original |

---

## Example: Process Brush Sprites

```powershell
$magick = "C:\Program Files\ImageMagick-7.1.2-Q16-HDRI\magick.exe"
$src = "originals\brush"
$dest = "brush\resized"

# Create destination folder
New-Item -ItemType Directory -Force -Path $dest

# Process all PNGs
Get-ChildItem "$src\*.png" | ForEach-Object {
    $out = "$dest\$($_.Name)"
    Write-Host "Processing $($_.Name)..."
    & $magick $_.FullName -filter point -resize 256x256 $out
}
```
