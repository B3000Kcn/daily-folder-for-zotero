# build.ps1 - Zotero Daily Folder Addon Builder

# --- Configuration ---
# This script is designed to be run from within the 'scripts' directory.
# It automatically determines the addon root directory (one level up).
$PSScriptRoot = Split-Path -Parent -Path $MyInvocation.MyCommand.Definition
$SourceDir = Resolve-Path -Path (Join-Path $PSScriptRoot "..")
$DistDir = Join-Path $SourceDir "dist" # Output directory for the .xpi file

# --- Process ---
Write-Host "Addon source directory: $SourceDir"

# 1. Read manifest.json to get the version
$ManifestPath = Join-Path $SourceDir "manifest.json"
if (-not (Test-Path $ManifestPath)) {
    Write-Host -ForegroundColor Red "Error: manifest.json not found at $ManifestPath"
    exit 1
}
$ManifestContent = Get-Content -Raw -Path $ManifestPath | ConvertFrom-Json
$Version = $ManifestContent.version

if (-not $Version) {
    Write-Host -ForegroundColor Red "Error: 'version' key not found in manifest.json"
    exit 1
}
Write-Host "Found addon version: $Version"

# 2. Define output filename and path
$OutputName = "daily-folder-for-zotero-$($Version).xpi"
if (-not (Test-Path $DistDir)) {
    New-Item -ItemType Directory -Path $DistDir | Out-Null
    Write-Host "Created distribution directory: $DistDir"
}
$OutputPath = Join-Path $DistDir $OutputName

# 3. List of files and directories to be included in the package
# These paths are relative to the $SourceDir
$PackageItems = @(
    "bootstrap.js",
    "manifest.json",
    "README.md",
    "content",
    "defaults"
)

# 4. Create a temporary directory for clean packaging
$TempDir = Join-Path ([System.IO.Path]::GetTempPath()) ([System.Guid]::NewGuid().ToString())
New-Item -ItemType Directory -Path $TempDir | Out-Null
Write-Host "Created temporary directory for packaging: $TempDir"

# 5. Copy items to the temporary directory
foreach ($item in $PackageItems) {
    $itemPath = Join-Path $SourceDir $item
    if (Test-Path $itemPath) {
        Copy-Item -Path $itemPath -Destination $TempDir -Recurse
        Write-Host "  - Copied '$item' to temp directory."
    }
}

# 6. Create the archive from the temp directory's contents
$ArchiveFilesPath = Join-Path $TempDir "*"
$ZipOutputPath = [System.IO.Path]::ChangeExtension($OutputPath, ".zip")

if (Test-Path $OutputPath) {
    Remove-Item $OutputPath
    Write-Host "Removed existing package at $OutputPath"
}
if (Test-Path $ZipOutputPath) {
    Remove-Item $ZipOutputPath
}

Compress-Archive -Path $ArchiveFilesPath -DestinationPath $ZipOutputPath -Force
Rename-Item -Path $ZipOutputPath -NewName $OutputName
Write-Host -ForegroundColor Green "Success! Created addon package at:"
Write-Host $OutputPath

# 7. Cleanup
Remove-Item -Path $TempDir -Recurse -Force
Write-Host "Cleaned up temporary directory."

Write-Host "Build finished."