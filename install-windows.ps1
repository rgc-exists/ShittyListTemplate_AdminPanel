param(
    [switch]$SkipNode,
    [switch]$SkipGit,
    [switch]$SkipGitHubCli
)

$ErrorActionPreference = "Stop"

function Test-Command {
    param([string]$Name)
    return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Install-WithWinget {
    param(
        [string]$Name,
        [string]$Id
    )

    if (-not (Test-Command "winget")) {
        throw "winget is required for automatic installs. Install App Installer from the Microsoft Store, then rerun this script."
    }

    Write-Host "Installing $Name..."
    winget install --id $Id --exact --source winget --accept-package-agreements --accept-source-agreements
}

Write-Host "Checking Shitty List Template Admin Panel dependencies..."

if (-not $SkipNode -and -not (Test-Command "node")) {
    Install-WithWinget -Name "Node.js LTS" -Id "OpenJS.NodeJS.LTS"
}

if (-not $SkipGit -and -not (Test-Command "git")) {
    Install-WithWinget -Name "Git" -Id "Git.Git"
}

if (-not $SkipGitHubCli -and -not (Test-Command "gh")) {
    Install-WithWinget -Name "GitHub CLI" -Id "GitHub.cli"
}

Write-Host ""
Write-Host "Installed versions visible in this shell:"
if (Test-Command "node") { node --version } else { Write-Host "node: not found" }
if (Test-Command "git") { git --version } else { Write-Host "git: not found" }
if (Test-Command "gh") { gh --version | Select-Object -First 1 } else { Write-Host "gh: not found" }

Write-Host ""
Write-Host "If a newly installed command is still not found, close and reopen your terminal."
