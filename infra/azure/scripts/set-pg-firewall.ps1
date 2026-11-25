# Quản lý firewall PostgreSQL theo IP cụ thể (P0-11, D-25). Không bao giờ tạo rule 0.0.0.0.
#   .\set-pg-firewall.ps1 -Mode AppOutbound   # thêm rule cho mọi outbound IP có thể có của Web App
#   .\set-pg-firewall.ps1 -Mode AdminAdd      # thêm IP máy bạn tạm thời (rule tên admin-temp-*)
#   .\set-pg-firewall.ps1 -Mode AdminRemove   # xóa mọi rule admin-temp-*
#   .\set-pg-firewall.ps1 -Mode List          # chỉ đọc
# Cú pháp Azure CLI mới: --server-name = tên server, --name = tên rule (sửa 24/11/2026).
param(
  [Parameter(Mandatory)] [ValidateSet('AppOutbound', 'AdminAdd', 'AdminRemove', 'List')] [string] $Mode,
  [string] $ResourceGroup = 'rg-educenter-demo',
  [string] $Suffix = $env:EDU_SUFFIX
)
$ErrorActionPreference = 'Stop'
if (-not $Suffix) { throw 'Chua dat $env:EDU_SUFFIX' }
$pg = "pg-educenter-$Suffix"
$app = "app-educenter-$Suffix"

function Add-Rule($ruleName, $ip) {
  az postgres flexible-server firewall-rule create --resource-group $ResourceGroup --server-name $pg `
    --name $ruleName --start-ip-address $ip --end-ip-address $ip --output none
  if ($LASTEXITCODE -ne 0) { throw "Khong tao duoc rule $ruleName" }
  Write-Host "Da them $ruleName ($ip)"
}

switch ($Mode) {
  'AppOutbound' {
    $ips = (az webapp show -g $ResourceGroup -n $app --query possibleOutboundIpAddresses -o tsv) -split ','
    $existing = @(az postgres flexible-server firewall-rule list --resource-group $ResourceGroup --server-name $pg --query "[].name" -o tsv)
    foreach ($ip in ($ips | Where-Object { $_ } | Sort-Object -Unique)) {
      $ruleName = "app-out-" + ($ip -replace '\.', '-')
      if ($existing -contains $ruleName) { Write-Host "Bo qua $ruleName (da co)"; continue }
      Add-Rule $ruleName $ip
    }
  }
  'AdminAdd' {
    $myIp = (curl.exe --silent https://api.ipify.org).Trim()
    if ($myIp -notmatch '^\d{1,3}(\.\d{1,3}){3}$') { throw "Khong lay duoc IP cong khai: $myIp" }
    Add-Rule ("admin-temp-" + (Get-Date -Format 'yyyyMMdd-HHmm')) $myIp
  }
  'AdminRemove' {
    # Lọc bằng PowerShell: JMESPath có dấu ngoặc bị az.cmd trên Windows hiểu sai (sửa 25/11/2026)
    $names = @(az postgres flexible-server firewall-rule list --resource-group $ResourceGroup --server-name $pg --query "[].name" -o tsv)
    if ($LASTEXITCODE -ne 0) { throw "Khong doc duoc danh sach rule" }
    foreach ($r in ($names | ForEach-Object { $_.Trim() } | Where-Object { $_ -like 'admin-temp-*' })) {
      az postgres flexible-server firewall-rule delete --resource-group $ResourceGroup --server-name $pg --name $r --yes --output none
      if ($LASTEXITCODE -eq 0) { Write-Host "Da xoa $r" } else { Write-Host "LOI khi xoa $r" }
    }
  }
}
az postgres flexible-server firewall-rule list --resource-group $ResourceGroup --server-name $pg --query "[].{rule:name, ip:startIpAddress}" -o table
