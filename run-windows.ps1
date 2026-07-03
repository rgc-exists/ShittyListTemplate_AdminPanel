param(
    [int]$Port = 4173,
    [string]$Repo = "",
    [string]$CloneRoot = ""
)

$ErrorActionPreference = "Stop"
$AdminRoot = $PSScriptRoot
Set-Location $AdminRoot

if (-not (Get-Command "node" -ErrorAction SilentlyContinue)) {
    Write-Error "Node.js is required. Run .\install-windows.ps1 first."
}

$ArgsForNode = @("server.js", "--port", "$Port")

if ($Repo.Trim()) {
    $ArgsForNode += @("--repo", $Repo)
}

if ($CloneRoot.Trim()) {
    $ArgsForNode += @("--clone-root", $CloneRoot)
}

node @ArgsForNode
