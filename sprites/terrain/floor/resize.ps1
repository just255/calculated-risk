$magick = "C:\Program Files\ImageMagick-7.1.2-Q16-HDRI\magick.exe"
$base = "C:\Users\just_\Downloads\calculated-risk\calculated-risk\sprites\terrain\floor"

Get-ChildItem "$base\originals\*.png" | ForEach-Object {
    $out = "$base\resized\$($_.Name)"
    Write-Host "Processing $($_.Name)..."
    & $magick $_.FullName -filter point -resize 256x256 $out
}

Write-Host "Done!"
Get-ChildItem "$base\resized\*.png" | Select-Object Name
