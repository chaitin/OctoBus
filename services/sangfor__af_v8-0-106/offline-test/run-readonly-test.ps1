param(
  [string]$ConfigPath = (Join-Path $PSScriptRoot "config.local.json")
)

$ErrorActionPreference = "Stop"

function Fail($Message) {
  Write-Host "[FAILED] $Message" -ForegroundColor Red
  exit 1
}

function Mask-Url($Value) {
  if ([string]::IsNullOrWhiteSpace($Value)) { return "" }
  try { $u = [Uri]$Value; return "$($u.Scheme)://***" } catch { return "***" }
}

function Mask-Text($Value) {
  if ($null -eq $Value) { return "" }
  $s = [string]$Value
  if ($s.Length -le 6) { return "***" }
  return "$($s.Substring(0, 2))***$($s.Substring($s.Length - 2))"
}

function ConvertTo-JsonText($Value) {
  return ($Value | ConvertTo-Json -Depth 20 -Compress)
}

function Invoke-JsonRequest($Method, $Url, $Headers, $Body, $TimeoutSeconds, $SkipTls) {
  $params = @{
    Method = $Method
    Uri = $Url
    Headers = $Headers
    TimeoutSec = $TimeoutSeconds
    UseBasicParsing = $true
  }
  if ($null -ne $Body) {
    $params.Body = ConvertTo-JsonText $Body
    $params.ContentType = "application/json"
  }
  if ($SkipTls -and $PSVersionTable.PSVersion.Major -ge 7) { $params.SkipCertificateCheck = $true }
  $response = Invoke-WebRequest @params
  $text = [string]$response.Content
  $json = $null
  if (-not [string]::IsNullOrWhiteSpace($text)) {
    try { $json = $text | ConvertFrom-Json } catch {}
  }
  return @{ StatusCode = [int]$response.StatusCode; Body = $text; Json = $json; Headers = $response.Headers }
}

function Get-Token($Response) {
  foreach ($name in @("token", "data", "access_token", "accessToken")) {
    if ($Response.Json.$name) { return [string]$Response.Json.$name }
  }
  $setCookie = [string]$Response.Headers["Set-Cookie"]
  if ($setCookie -match "token=([^;]+)") { return $Matches[1] }
  return ""
}

if (-not (Test-Path -LiteralPath $ConfigPath)) {
  Fail "Missing config.local.json. Copy config.example.json to config.local.json and fill device address, username, and password."
}

$cfg = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
foreach ($name in @("baseUrl", "username", "password")) {
  if ([string]::IsNullOrWhiteSpace([string]$cfg.$name)) { Fail "Missing required config field: $name" }
}

$baseUrl = ([string]$cfg.baseUrl).TrimEnd("/")
$namespace = if ($cfg.namespace) { [string]$cfg.namespace } else { "public" }
$readOnlyPath = if ($cfg.readOnlyPath) { [string]$cfg.readOnlyPath } else { "/api/v1/namespaces/$namespace/password_policy" }
$timeout = if ($cfg.timeoutSeconds) { [int]$cfg.timeoutSeconds } else { 15 }
$skipTls = [bool]$cfg.allowInsecureTls

Write-Host "Sangfor AF read-only on-site test"
Write-Host "Device: $(Mask-Url $baseUrl)"
Write-Host "Mode: read-only, no write or cleanup operation"

$loginPath = "/api/v1/namespaces/$namespace/login"
$login = Invoke-JsonRequest "POST" "$baseUrl$loginPath" @{} @{
  username = [string]$cfg.username
  password = [string]$cfg.password
} $timeout $skipTls

$token = Get-Token $login
if ([string]::IsNullOrWhiteSpace($token)) { Fail "Login succeeded but token was not found in response or cookie." }

$query = Invoke-JsonRequest "GET" "$baseUrl$readOnlyPath" @{
  Cookie = "token=$token"
} $null $timeout $skipTls

$reportDir = Join-Path $PSScriptRoot "report"
New-Item -ItemType Directory -Force -Path $reportDir | Out-Null
$reportPath = Join-Path $reportDir ("sangfor-af-readonly-{0}.md" -f (Get-Date -Format "yyyyMMdd-HHmmss"))
$bodyPreview = if ($query.Body.Length -gt 600) { $query.Body.Substring(0, 600) + "...(truncated)" } else { $query.Body }

@"
# Sangfor AF Read-Only On-Site Test Report

- Result: PASS
- Device type: Sangfor AF
- Device version: $($cfg.deviceVersion)
- Device address: $(Mask-Url $baseUrl)
- Authentication: username/password token cookie
- Test command: powershell -ExecutionPolicy Bypass -File .\run-readonly-test.ps1
- Read-only method: GET $readOnlyPath
- Write operation executed: No
- Cleanup operation executed: No
- Token: $(Mask-Text $token)
- Query HTTP status: $($query.StatusCode)
- Query response preview: ``$bodyPreview``

## Screenshot Checklist

- Device version page, with sensitive data masked.
- This PowerShell result screen.
- Queried device page or API access log page, with sensitive data masked.

## Known Limits

- This script verifies read-only API access only.
- It does not create, delete, block, unblock, clear, or modify any object.
"@ | Set-Content -LiteralPath $reportPath -Encoding UTF8

Write-Host "[PASS] Login and read-only query succeeded." -ForegroundColor Green
Write-Host "Report: $reportPath"
