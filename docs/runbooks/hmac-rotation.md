# Runbook — Khóa HMAC callback FC → Azure (P0-21, D-29)

Chủ sở hữu: Ngô Minh Giang (cloud). Phối hợp: Anh/Hà (API nhận callback).
Không bao giờ ghi giá trị khóa vào repo, chat, ảnh chụp, log hay báo cáo. Chỉ ghi **key ID**.

## Quy ước

| Thành phần | Giá trị |
|---|---|
| Độ dài khóa | 32 byte ngẫu nhiên (256 bit), biểu diễn 64 ký tự hex |
| Key ID | `k<n>-<yyyymmdd>`, ví dụ `k1-20261122` |
| Azure | Key Vault runtime `kv-edu-rt-<suffix>`, secret `callback-hmac-<keyId>` (ví dụ `callback-hmac-k1-20261122`) |
| Aliyun | Biến môi trường mã hóa của function `material-processor`: `CALLBACK_HMAC_KEY_ID`, `CALLBACK_HMAC_KEY` |
| Chữ ký (đề xuất, chờ contract P0-16) | `X-EduCenter-Signature = hex(HMAC_SHA256(key, "<timestamp>." + raw_body))`, header `X-EduCenter-Key-Id`, `X-EduCenter-Timestamp` (epoch giây, lệch tối đa ±300 s) |
| API | Chấp nhận tối đa 2 key ID cùng lúc trong thời gian xoay |

## Sinh khóa mới (PowerShell, máy người vận hành)

```powershell
$keyId = "k2-" + (Get-Date -Format yyyyMMdd)
$bytes = New-Object byte[] 32
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$hmacHex = -join ($bytes | ForEach-Object { $_.ToString("x2") })
az keyvault secret set --vault-name "kv-edu-rt-$env:EDU_SUFFIX" --name "callback-hmac-$keyId" --value $hmacHex --output none
```

## Xoay khóa không gián đoạn

1. Sinh khóa mới như trên (khóa cũ vẫn còn trong Key Vault).
2. Cập nhật app setting của Web App để API nhận **cả hai** key ID (tên setting theo code của Anh/Hà), rồi **Restart** App Service — Key Vault reference có cache.
3. Kiểm trong Portal: Web App → Settings → Environment variables → setting mới có trạng thái Key Vault reference **Resolved**.
4. Function Compute → `material-processor` → Configuration → Environment Variables → sửa `CALLBACK_HMAC_KEY_ID` = key ID mới, `CALLBACK_HMAC_KEY` = dán từ clipboard (`Set-Clipboard $hmacHex`), Deploy. Sau đó `Set-Clipboard " "`.
5. Upload 1 PDF thử. SLS phải có dòng `metric=fc_to_azure httpStatus=202`, Application Insights có cùng correlationId.
6. Đợi hết các material đang PROCESSING (hoặc reconcile xong), bỏ key ID cũ khỏi app setting, Restart, rồi `az keyvault secret delete` khóa cũ.
7. Ghi vào bảng lịch sử: thời điểm, key ID cũ → mới, người thực hiện, bằng chứng.

## Khi nghi lộ khóa

Thực hiện ngay bước 1–5 rồi bỏ khóa cũ ở bước 6 mà không chờ. Ghi sự cố vào incident log.

## Lịch sử

| Thời điểm (UTC+7) | Key ID | Hành động | Người | Bằng chứng |
|---|---|---|---|---|
| | | | | |
