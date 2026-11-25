# Giám sát cloud

## Nguồn số liệu
| Nguồn | Luôn có | Nội dung |
|---|---|---|
| In-process (`MetricsService`) | ✓ | API latency (avg/p50/p95/max), error rate 5xx, dependency `oss.*`, `callback.*`, `fc.duration`, `local.processor*`, `storage.*` — cửa sổ 2 giờ, theo phút, **mỗi instance** |
| Bảng `material_processing_jobs` | ✓ | số job, thành công/từ chối/lỗi, p50/p95 thời gian xử lý, độ trễ callback, tài liệu treo |
| `pg_stat_database` | ✓ | kết nối, commit/rollback, cache hit, deadlock, dung lượng, ping |
| `ops_log_entries` | ✓ | log vận hành có provider/service/level/correlationId |
| Application Insights | khi cấu hình | requests, dependencies, exceptions, custom metric/event |
| Azure Monitor REST | khi cấu hình | App Service: Requests, Http5xx, HttpResponseTime, CpuTime, MemoryWorkingSet; PostgreSQL: cpu/memory/storage %, active_connections; Resource Health |
| Log Analytics (KQL) | khi cấu hình | `AppTraces` của `educenter-api` |
| SLS GetLogs | khi cấu hình | log Function Compute |
| CloudMonitor | khi cấu hình | lượt gọi/lỗi/độ trễ FC, alarm rules |
| Cost Management / BSS | khi có quyền billing | chi phí tháng theo dịch vụ; không có quyền → `NOT CONFIGURED` |

## Trang
| Trang | API | Nội dung |
|---|---|---|
| Cloud Overview | `GET /cloud/overview` | trạng thái từng dịch vụ (UP/DEGRADED/DOWN/MOCK/LOCAL/NOT_CONFIGURED), đo trực tiếp |
| Cloud Architecture | (overview) | sơ đồ data flow/event flow tô màu theo trạng thái |
| Storage Management | `GET /cloud/storage` | object, metadata, version, dung lượng, lifecycle, lịch sử upload |
| Function Compute / Processing Jobs | `GET /cloud/jobs`, `GET /cloud/jobs/:id`, `POST /cloud/materials/:id/retry`, `POST /cloud/reconciler/run`, `GET /cloud/reconciler` | job, thời gian, lỗi, retry, lịch sử, reconciler |
| Cloud Monitoring | `GET /cloud/metrics?window=` | biểu đồ latency/requests, bảng dependency, DB, storage, Azure Monitor, CloudMonitor |
| Cloud Logs | `GET /cloud/logs?source=app|sls|azure&provider&service&level&from&q&correlationId` | tìm kiếm + lọc; bấm correlation ID để lọc theo luồng |
| Cloud Resources | `GET /cloud/resources`, `GET /cloud/cost` | tài nguyên, metadata secret, bảo mật, chi phí |

Từ khóa tìm kiếm log bị giới hạn ký tự (chữ, số, khoảng trắng, `._:-/@`) để không thể chèn vào KQL/SLS query.

## Correlation ID
Sinh khi tạo tài liệu (`mat-<id8>-a<attempt>-<rand>`), gắn vào metadata object OSS, job, log API, log FC, result JSON.
Một lần upload có thể truy vết qua LOCAL_STORAGE/OSS → processor/FC → CALLBACK trên trang Cloud Logs (E2E kiểm chứng ≥ 3 dịch vụ).

## Cảnh báo
Azure Monitor (Bicep): Http5xx, HealthCheckStatus, PostgreSQL CPU, availability test. CloudMonitor: tạo trong console
(FC lỗi > 0 trong 5 phút, độ trễ trung bình > 30 s). Dashboard tự cảnh báo khi tỷ lệ lỗi job > 20% hoặc có tài liệu treo.
