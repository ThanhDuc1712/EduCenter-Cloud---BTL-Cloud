# Đóng gói worker cho Function Compute (Linux x86_64, Python 3.10) từ máy Windows.
# Chạy trong PowerShell tại thư mục functions\material-processor:   .\build.ps1
# Kết quả: dist\material-processor.zip (index.py nằm ở gốc zip, đường dẫn dùng '/').
$ErrorActionPreference = "Stop"
$here = $PSScriptRoot
$build = Join-Path $here "build\package"
$dist = Join-Path $here "dist"
Remove-Item -Recurse -Force (Join-Path $here "build"), $dist -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $build, $dist | Out-Null

# Tải wheel Linux đúng ABI, không dùng wheel Windows (pypdfium2 có thư viện native).
python -m pip install --quiet --target $build --only-binary=:all: --implementation cp `
  --python-version 3.10 --platform manylinux_2_28_x86_64 --platform manylinux2014_x86_64 `
  --platform manylinux_2_17_x86_64 -r (Join-Path $here "requirements.txt")
if ($LASTEXITCODE -ne 0) { throw "pip install that bai" }

Copy-Item (Join-Path $here "index.py"), (Join-Path $here "processor.py"), (Join-Path $here "callback.py"), (Join-Path $here "keys.py") $build
$zip = Join-Path $dist "material-processor.zip"
# Không dùng Compress-Archive (PowerShell 5.1 ghi dấu '\' trong zip -> FC không import được)
python (Join-Path $here "zip_package.py") $build $zip
if ($LASTEXITCODE -ne 0) { throw "Nen zip that bai" }
$sizeMb = [math]::Round((Get-Item $zip).Length / 1MB, 2)
Write-Host "OK: $zip ($sizeMb MB)"
Get-ChildItem $build -Directory | Select-Object -ExpandProperty Name
