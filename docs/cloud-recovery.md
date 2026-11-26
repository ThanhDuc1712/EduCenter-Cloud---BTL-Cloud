# Sao lưu và khôi phục

Trạng thái: quy trình đã viết; **chưa diễn tập trên Azure/Alibaba thật**. Bản local (pg_dump/restore) có thể chạy ngay.

## Phạm vi dữ liệu
| Dữ liệu | Nơi lưu | Sao lưu |
|---|---|---|
| Nghiệp vụ + metadata tài liệu | Azure PostgreSQL | backup tự động 7 ngày, PITR (Bicep `backupRetentionDays: 7`) |
| Tệp tài liệu đã xử lý | OSS published | versioning + giữ phiên bản cũ 30 ngày |
| Tệp upload gốc | OSS quarantine | versioning; xóa sau 7 ngày (có thể xử lý lại trong thời gian này) |
| Secret | Key Vault | soft delete 7 ngày + purge protection, lịch sử version |
| Mã / hạ tầng | Git (`infra/`, `functions/`) | — |

## Khôi phục PostgreSQL (PITR)
```powershell
az postgres flexible-server restore -g rg-educenter-demo --name educenter-pg-restore `
  --source-server <pgName> --restore-time "2026-11-24T08:00:00Z"
```
1. Khôi phục sang **server mới** (không ghi đè server đang chạy).
2. Kiểm tra: `SELECT count(*) FROM students; SELECT max(created_at) FROM activity_logs;` và chạy `infra/azure/scripts/bootstrap_db.py` nếu cần.
3. Cập nhật secret `db-runtime-url` trỏ server mới → restart App Service → kiểm tra `/api/v1/health`.
4. Chạy "Chạy đối soát ngay": tài liệu PROCESSING sau thời điểm khôi phục sẽ được đồng bộ lại từ `results/*.json`.
RTO mục tiêu ~30 phút, RPO ≤ 5 phút (PITR) — **chưa đo**.

## Sao lưu logic (local và bổ sung trên cloud)
```powershell
docker exec educenter-postgres-1 pg_dump -U postgres -d educenter -Fc -f /tmp/educenter.dump
docker cp educenter-postgres-1:/tmp/educenter.dump .\backup\educenter.dump
# khôi phục vào DB mới để kiểm tra
docker exec educenter-postgres-1 createdb -U postgres educenter_restore
docker exec educenter-postgres-1 pg_restore -U postgres -d educenter_restore --no-owner /tmp/educenter.dump
```

## Khôi phục tệp OSS
Object bị xóa nhầm: liệt kê version (`aliyun oss ls oss://<bucket>/published/… --all-versions`) và copy version cũ thành
bản hiện hành. Nếu bản published mất nhưng nguồn còn trong quarantine: nút "Xử lý lại" (retry) tạo lại document + preview (trong 1 ngày, trước khi lifecycle xóa quarantine).

## Sự cố thường gặp
| Sự cố | Khôi phục |
|---|---|
| FC lỗi / callback không tới | Tài liệu tự FAILED hoặc được reconciler áp dụng kết quả; sửa lỗi rồi retry |
| Lộ HMAC secret | xoay vòng theo [cloud-security.md](cloud-security.md#xoay-vòng-khóa-hmac-d-29) |
| Deploy lỗi | `deploy-azure.ps1` với commit trước (gói build lại từ mã) |
| Mất cả region | ngoài phạm vi BTL (không geo-redundant backup) |
