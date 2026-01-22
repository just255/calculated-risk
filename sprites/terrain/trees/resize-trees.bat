@echo off
REM Resize all tree sprites from 128px to 256px using nearest-neighbor
REM This preserves the pixel art look

echo Resizing tree sprites to 256px...

REM Process young folder
for %%f in (young\*.png) do (
    echo Resizing %%f
    magick "%%f" -filter point -resize 256x256 "%%f"
)

REM Process old folder
for %%f in (old\*.png) do (
    echo Resizing %%f
    magick "%%f" -filter point -resize 256x256 "%%f"
)

REM Process transitional folder
for %%f in (transitional\*.png) do (
    echo Resizing %%f
    magick "%%f" -filter point -resize 256x256 "%%f"
)

echo Done! All tree sprites resized to 256x256
pause
