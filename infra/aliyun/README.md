# Alibaba Cloud — cấu hình môi trường demo EduCenter (P0-03, P0-13, P0-14, P0-15, P0-21)

Cấu hình qua console theo hướng dẫn của Giang; file này là bản ghi để dựng lại. Không chứa khóa.

| Mục | Giá trị (điền sau khi tạo) |
|---|---|
| Region | Singapore `ap-southeast-1` |
| Bucket quarantine | `educenter-<suffix>-quarantine` — Standard, LRS, Private, Block Public Access ON, Versioning ON |
| Bucket published | `educenter-<suffix>-published` — Standard, LRS, Private, Block Public Access ON, Versioning ON |
| Endpoint cho trình duyệt | `https://<bucket>.oss-ap-southeast-1.aliyuncs.com` |
| Endpoint nội bộ cho FC | `https://oss-ap-southeast-1-internal.aliyuncs.com` |
| Prefix | quarantine: `quarantine/{tenant}/{material}/{attempt}/{uuid}.pdf`; published: `published/`, `previews/`, `results/` + `{tenant}/{material}/{attempt}/{versionTag}.{pdf\|png\|json}` |
| Lifecycle quarantine | prefix `quarantine/`: current 1 ngày, previous versions 1 ngày, xóa delete marker hết hạn, multipart dở 1 ngày |
| CORS | Origin = `APP_ORIGIN` của web app (+ `http://localhost:5173` khi dev), method POST/GET/HEAD, expose `x-oss-version-id, ETag`, max age 600 (`oss/cors.xml`) |
| SLS | project `educenter-<suffix>-logs`, logstore `fc-material-processor` |
| Function | `material-processor`, Python 3.10, handler `index.handler`, role `educenter-fc-worker` |
| Trigger | OSS native, bucket quarantine, prefix `quarantine/`, suffix `.pdf`, event `oss:ObjectCreated:PostObject` và `oss:ObjectCreated:CopyObject` (retry), role hệ thống `AliyunOSSEventNotificationRole` (policy `AliyunOSSEventNotificationRolePolicy`; giới hạn: rộng hơn mức tối thiểu, ghi trong báo cáo) |

## RAM (policy JSON trong `ram/`, thay `<...>` trước khi dán)

| Danh tính | Loại | Policy |
|---|---|---|
| `educenter-fc-worker` | Role, trusted service Function Compute | `policy-fc-worker.json` |
| `educenter-oss-trigger` (tùy chọn, chưa dùng) | Role, trusted service OSS | `policy-oss-trigger-invoke.json` — phương án quyền tối thiểu nếu còn thời gian |
| `api-storage` | RAM user, chỉ AccessKey, AK lưu ở Key Vault runtime (`oss-api-access-key-id`, `oss-api-access-key-secret`) | `policy-api-storage.json` |
| `giang-poc-uploader` | RAM user TẠM, chỉ để thử OSS→FC trước khi có signer P0-17; xóa sau P0-18 | `policy-poc-uploader-TEMP.json` |
| `giang-ops` | RAM user người vận hành, console + MFA | quyền quản trị dịch vụ OSS/FC/SLS/RAM của dự án |

Quyền của `api-storage` **rộng hơn P0-14** ở hai điểm vì ứng dụng cần, chờ người phụ trách bảo mật duyệt:
`GetObject` trên `quarantine/*` (HeadObject khi xác nhận upload, nguồn copy khi retry) và `ListObjects` +
`GetBucketInfo/Versioning/Lifecycle` trên hai bucket (retry, đối soát, trang Cloud).
