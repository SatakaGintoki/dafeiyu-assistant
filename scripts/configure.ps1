param(
  [ValidateSet('harness','deepseek','demo')][string]$Runtime = 'deepseek',
  [string]$Model = 'deepseek-flash',
  [string]$BaseUrl = 'https://api.deepseek.com',
  [string]$Workspace = '',
  [string]$ServiceUrl = 'http://127.0.0.1:4318'
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$tokenPath = Join-Path $projectRoot '.data\api-token'
if (-not (Test-Path -LiteralPath $tokenPath)) { throw '请先启动后端；自定义数据目录时请使用设置 API。' }
$token = (Get-Content -Raw -LiteralPath $tokenPath).Trim()
$headers = @{ Authorization = "Bearer $token" }
$payload = @{ runtime = $Runtime; model = $Model; baseUrl = $BaseUrl }
if ($Workspace) { $payload.workspace = $Workspace }
if ($Runtime -ne 'demo') {
  $secureKey = Read-Host 'DeepSeek API Key（输入隐藏）' -AsSecureString
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)
  try { $payload.apiKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
}
try {
  $body = [Text.Encoding]::UTF8.GetBytes(($payload | ConvertTo-Json))
  $result = Invoke-RestMethod -Uri "$ServiceUrl/api/v1/settings" -Method Patch -Headers $headers -Body $body -ContentType 'application/json; charset=utf-8'
  Write-Output "已保存配置：runtime=$($result.runtime), model=$($result.model), hasApiKey=$($result.hasApiKey)"
} finally { $payload.Remove('apiKey'); $body = $null; $secureKey = $null }
