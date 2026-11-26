# Runbook — Khóa HMAC callback FC → Azure (P0-21, D-29)

Chủ sở hữu: Ngô Minh Giang (cloud). Phối hợp: Anh/Hà (API nhận callback).
Không bao giờ ghi giá trị khóa vào repo, chat, ảnh chụp, log hay báo cáo. Chỉ ghi **key ID**.

## Quy ước

| Thành phần | Giá trị |
|---|---|
| Độ dài khóa | 32 byte ngẫu nhiên (256 bit), biểu diễn 64 ký tự hex |
| Key ID | ví dụ `k1`, `k2-20261201` (chữ, số, `_`, `-`; ≤ 32 ký tự) |
| Azure | Key Vault runtime `kv-edu-rt-<suffix>`, một secret `callback-hmac-keys` = `<keyId>:<secret>[,<keyId>:<secret>]`; app setting `CALLBACK_HMAC_KEYS` tham chiếu secret này |
| Aliyun | Biến môi trường mã hóa của function `material-processor`: `CALLBACK_HMAC_KEY_ID`, `CALLBACK_HMAC_SECRET` |
| Chữ ký | `X-Edu-Signature: v1=hex(HMAC_SHA256(secret, "<timestamp>." + raw_body))`, header `X-Edu-Key-Id`, `X-Edu-Timestamp` (epoch giây, lệch tối đa ±300 s). `secret` là **chuỗi** 64 ký tự (dùng nguyên văn, không giải mã hex) |
| API | Chấp nhận tối đa 2 key ID cùng lúc trong thời gian xoay |

## Thêm khóa mới (PowerShell, máy người vận hành)

```powershell
$keyId = "k2-" + (Get-Date -Format yyyyMMdd)
$bytes = New-Object byte[] 32
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$hmacHex = -join ($bytes | ForEach-Object { $_.ToString("x2") })
$kv = "kv-edu-rt-$env:EDU_SUFFIX"
$old = az keyvault secret show --vault-name $kv --name callback-hmac-keys --query value -o tsv
az keyvault secret set --vault-name $kv --name callback-hmac-keys --value "$old,${keyId}:$hmacHex" --output none
Remove-Variable old
```

## Xoay khóa không gián đoạn

1. Thêm khóa mới như trên (secret chứa cả khóa cũ và mới).
2. **Restart** App Service (Key Vault reference có cache); API nhận cả hai key ID.
3. Kiểm trong Portal: Web App → Settings → Environment variables → `CALLBACK_HMAC_KEYS` ở trạng thái **Resolved**.
4. Function Compute → `material-processor` → Environment Variables → `CALLBACK_HMAC_KEY_ID` = key ID mới, `CALLBACK_HMAC_SECRET` = dán từ clipboard (`Set-Clipboard $hmacHex`), Deploy. Sau đó `Set-Clipboard " "`.
5. Upload 1 PDF thử. SLS phải có `callback.response` với `status 200`; trang Cloud Logs có cùng correlationId.
6. Đợi hết material đang PROCESSING (hoặc đối soát xong), đặt lại secret chỉ còn khóa mới, đổi `CALLBACK_HMAC_ACTIVE_KEY_ID` (tham số `EDU_CALLBACK_KEY_ID`), restart.
7. Ghi vào bảng lịch sử: thời điểm, key ID cũ → mới, người thực hiện, bằng chứng.

## Khi nghi lộ khóa

Thực hiện ngay bước 1–5 rồi bỏ khóa cũ ở bước 6 mà không chờ. Ghi sự cố vào incident log.

## Lịch sử

| Thời điểm (UTC+7) | Key ID | Hành động | Người | Bằng chứng |
|---|---|---|---|---|
| | | | | |
