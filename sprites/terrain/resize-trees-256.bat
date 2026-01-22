@echo off
REM Resize tree originals from 128px to 256px and copy to main folders
REM Uses nearest-neighbor (point) filter to preserve pixel art

setlocal enabledelayedexpansion

set ORIGINALS=originals\trees
set DEST=trees

echo Resizing and copying tree sprites to 256px...
echo.

REM Process each tree type
for %%T in (oak pine birch willow) do (
    echo Processing %%T...

    REM Young trees
    for %%F in ("%ORIGINALS%\%%T\%%T-young-*.png") do (
        set "filename=%%~nxF"
        set "newname=!filename:-pixel=!"
        echo   %%~nxF -^> young\!newname!
        magick "%%F" -filter point -resize 256x256 "%DEST%\young\!newname!"
    )

    REM Old trees
    for %%F in ("%ORIGINALS%\%%T\%%T-old-*.png") do (
        set "filename=%%~nxF"
        set "newname=!filename:-pixel=!"
        echo   %%~nxF -^> old\!newname!
        magick "%%F" -filter point -resize 256x256 "%DEST%\old\!newname!"
    )

    REM Transitional trees
    for %%F in ("%ORIGINALS%\%%T\%%T-transitional-*.png") do (
        set "filename=%%~nxF"
        set "newname=!filename:-pixel=!"
        echo   %%~nxF -^> transitional\!newname!
        magick "%%F" -filter point -resize 256x256 "%DEST%\transitional\!newname!"
    )

    echo.
)

echo Done! All tree sprites resized to 256x256
pause
