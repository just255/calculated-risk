Set-Location "C:\Users\just_\Downloads\calculated-risk\calculated-risk\sprites\terrain"

$originals = "originals\trees"
$dest = "trees"

# Process each tree type
$types = @("oak", "pine", "birch", "willow")

foreach ($type in $types) {
    Write-Host "Processing $type..."

    $files = Get-ChildItem "$originals\$type\*.png"

    foreach ($file in $files) {
        $name = $file.Name -replace "-pixel", ""

        # Determine age folder
        if ($name -match "young") {
            $age = "young"
        } elseif ($name -match "transitional") {
            $age = "transitional"
        } else {
            $age = "old"
        }

        $destPath = "$dest\$age\$name"
        Write-Host "  $($file.Name) -> $age\$name"

        & magick $file.FullName -filter point -resize 256x256 $destPath
    }
}

Write-Host "`nDone! All trees resized to 256x256"
