# HTML Screenshot Tool using Chrome
# This script takes screenshots of all HTML files using Chrome headless mode

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$htmlDir = $scriptDir
$imgDir = Join-Path (Split-Path -Parent $scriptDir) "img"

# Find Chrome executable
$chromePaths = @(
    "${env:ProgramFiles}\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "${env:LOCALAPPDATA}\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles}\Microsoft\Edge\Application\msedge.exe",
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
)

$chromePath = $null
foreach ($path in $chromePaths) {
    if (Test-Path $path) {
        $chromePath = $path
        break
    }
}

if (-not $chromePath) {
    Write-Host "Chrome or Edge not found. Please install Google Chrome or Microsoft Edge." -ForegroundColor Red
    exit 1
}

Write-Host "Using browser: $chromePath"
Write-Host ""

# Create img directory if it doesn't exist
if (-not (Test-Path $imgDir)) {
    New-Item -ItemType Directory -Path $imgDir | Out-Null
    Write-Host "Created img directory: $imgDir"
}

# Get all HTML files
$htmlFiles = Get-ChildItem -Path $htmlDir -Filter "*.html"

if ($htmlFiles.Count -eq 0) {
    Write-Host "No HTML files found."
    exit
}

Write-Host "Taking screenshots of HTML files..."
Write-Host ""

foreach ($htmlFile in $htmlFiles) {
    $htmlPath = $htmlFile.FullName
    $baseName = $htmlFile.BaseName
    $pngPath = Join-Path $imgDir "$baseName.png"
    
    Write-Host "Processing: $($htmlFile.Name) -> $baseName.png"
    
    try {
        # Convert path to file URL
        $fileUrl = "file:///$($htmlPath.Replace('\', '/'))"
        
        # BK02 は縦長のため高さを拡張
        $windowSize = if ($baseName -eq "BK02") { "1920,1600" } else { "1920,1080" }

        # Run Chrome in headless mode to take screenshot
        $arguments = @(
            "--headless",
            "--disable-gpu",
            "--window-size=$windowSize",
            "--screenshot=$pngPath",
            $fileUrl
        )
        
        $process = Start-Process -FilePath $chromePath -ArgumentList $arguments -Wait -PassThru -NoNewWindow
        
        if ($process.ExitCode -eq 0 -and (Test-Path $pngPath)) {
            Write-Host "  Done: $pngPath" -ForegroundColor Green
        } else {
            Write-Host "  Failed to capture screenshot" -ForegroundColor Red
        }
    }
    catch {
        Write-Host "  Error: $($_.Exception.Message)" -ForegroundColor Red
    }
    
    Start-Sleep -Milliseconds 500
}

Write-Host ""
Write-Host "Screenshot capture completed."
Write-Host "Saved to: $imgDir"
