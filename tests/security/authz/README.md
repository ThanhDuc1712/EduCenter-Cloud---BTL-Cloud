# Ma trận phân quyền (authz-matrix)

`authz-matrix.mjs` gọi API EduCenter qua HTTP bằng nhiều vai trò (actor) và so kết quả với **quy tắc nghiệp vụ** ở cuối file này. Expected được lấy từ quy tắc nghiệp vụ, không suy ra từ decorator `@Roles`, vì mục đích là tìm chỗ code và quy tắc lệch nhau.

- Script chạy trên Node 24, chỉ dùng `fetch` có sẵn, không cần cài thêm gì.
- Script không sửa mã nguồn. Nó chỉ đọc `apps/api/src/**/*.controller.ts` và `*.module.ts` để kiểm độ phủ route.
- Script không in và không ghi cookie, token, mật khẩu hay nội dung body.

## Cách chạy (PowerShell)

Yêu cầu: API đang chạy và đã seed (`pnpm --filter api db:seed`). Seed tạo hai tenant `hanoi-center` và `saigon-center`. Nên seed lại trước khi chạy, vì các bộ test khác có thể đã thay đổi dữ liệu.

```powershell
# Nhập mật khẩu mà không lưu vào lịch sử lệnh
$sec = Read-Host 'TEST_PASSWORD' -AsSecureString
$env:TEST_PASSWORD = [System.Net.NetworkCredential]::new('', $sec).Password

# Chỉ đọc (GET), chạy được với cả môi trường không phải localhost
node tests/security/authz/authz-matrix.mjs

# Thêm các request ghi phải bị từ chối (chỉ cho phép khi BASE_URL là localhost/127.0.0.1)
node tests/security/authz/authz-matrix.mjs --include-writes

# Tuỳ chọn
$env:BASE_URL   = 'http://localhost:3000'   # mặc định
$env:APP_ORIGIN = 'http://localhost:5173'   # phải khớp APP_ORIGIN của API
$env:OUT_DIR    = 'D:\EduCenter-test-results'  # mặc định: ..\EduCenter-test-results, nằm cạnh repo

Remove-Item Env:TEST_PASSWORD
```

Exit code:

| Exit code | Ý nghĩa |
|---|---|
| `0` | Không có FAIL |
| `1` | Có ít nhất một FAIL |
| `2` | Lỗi cấu hình hoặc chuẩn bị dữ liệu: thiếu `TEST_PASSWORD`, API không chạy, đăng nhập thất bại, không tìm được fixture, hoặc dùng `--include-writes` với host không phải localhost |

Một lần chạy đăng nhập khoảng 8 tài khoản và đăng xuất ở cuối. Bộ giới hạn đăng nhập (5 lần sai cho mỗi tài khoản trong 15 phút) chỉ bị ảnh hưởng nếu mật khẩu sai.

## Script làm gì

1. Đăng nhập `adminA` (hanoi-center) và `adminB` (saigon-center). Dùng API của admin để lấy toàn bộ ID tham chiếu: học viên, giáo viên, khóa, lớp, danh sách lớp, buổi học, bài kiểm tra, hóa đơn, thanh toán, học liệu, job.
2. Tự chọn fixture trong tenant A:
   - **X**: lớp có giáo viên ACTIVE, có buổi học và bài kiểm tra. **Y**: lớp do giáo viên khác dạy.
   - `teacherAssigned`: giáo viên dạy X. `teacherOther`: giáo viên dạy Y, không dạy X.
   - `studentIn`: học viên ACTIVE, đang ghi danh ACTIVE ở X và không ở Y.
   - `studentOut`: học viên ACTIVE không ở X. Ưu tiên người ở Y và không học lớp nào của `teacherAssigned`.
   - `studentInactive`: học viên có status INACTIVE. Chỉ kiểm xem có đăng nhập được không, expected `?`.
   - `anonymous`: không có cookie.
3. Thử mọi route GET với từng actor.
   - Route có `:id` được thử với ID trong phạm vi của actor (`own`), ID cùng tenant nhưng ngoài phạm vi (`sameTenant`) và ID của tenant kia (`otherTenant`).
   - Admin được thử với một ID của tenant mình và một ID của tenant kia.
   - Anonymous được thử với một ID.
4. Kiểm rò rỉ ID trên mọi response, không chỉ response 2xx. Script tìm mọi UUID trong body rồi đối chiếu với các tập ID bị cấm:

   | Actor | Tập ID bị cấm | Kết quả khi thấy |
   |---|---|---|
   | Mọi actor | ID tenant kia | FAIL |
   | TEACHER | học viên không thuộc lớp mình dạy | FAIL |
   | TEACHER | hóa đơn/thanh toán | FAIL |
   | TEACHER | lớp/buổi/bài kiểm tra của lớp không dạy | `?` |
   | STUDENT | học viên khác | FAIL |
   | STUDENT | bạn cùng lớp (kể cả trong `GET /classrooms/:id/students`) | FAIL |
   | STUDENT | hóa đơn/thanh toán của người khác | FAIL |
   | STUDENT | lớp/buổi/bài kiểm tra của lớp không ghi danh | FAIL |

5. Khi có `--include-writes`, script gửi các request ghi **chỉ với actor phải bị từ chối**. Danh sách nằm trong `runWrites()`:
   - STUDENT: `POST /students`, `POST /invoices/:id/payments`, `PUT /grade-bands`, `POST /cloud/reconciler/run`.
   - TEACHER: `POST /enrollments`, `PATCH /invoices/:id`, `PUT /assessments/:id/grades` của lớp không dạy.
   - `teacherOther`: `PUT /sessions/:id/attendance` của lớp X.
   - `adminB`: `PATCH` học viên, lớp và hóa đơn của tenant A.
   - `adminA`: `PATCH` kèm `Origin: https://evil.example`, phải nhận đúng 403.
   - `adminA`: `PATCH` không có Origin, expected `?`.
   - anonymous: `POST /students`.

   Body đều hợp lệ (API dùng `forbidNonWhitelisted`, nên body sai sẽ bị 400 trước khi kiểm phạm vi). Ở những chỗ có thể, script ghi lại đúng giá trị đang có, để request là no-op nếu lỡ được chấp nhận.
6. So route GET tìm thấy trong mã nguồn với danh mục của script. Route chưa có quy tắc được ghi thành dòng `?`.
7. In bảng ra console và ghi `authz-matrix-<thời gian>.csv` vào `OUT_DIR`.

## Ý nghĩa các cột

| Cột | Ý nghĩa |
|---|---|
| `route` | Mẫu route, ví dụ `/students/:id`, không có tiền tố `/api/v1` |
| `method` | GET/POST/PUT/PATCH |
| `actor` | `anonymous`, `adminA`, `adminB`, `teacherAssigned`, `teacherOther`, `studentIn`, `studentOut`, `studentInactive`. Email chỉ in ra console |
| `idKind` | `own`: trong phạm vi của actor (chính mình, lớp mình dạy, lớp đã ghi danh, hóa đơn của mình). `sameTenant`: cùng tenant nhưng ngoài phạm vi; với admin là mọi ID trong tenant mình. `otherTenant`: tenant kia. `kind=...`: loại báo cáo. `n/a`: anonymous. `-`: route không có id |
| `expected` | `ALLOW`, `DENY` hoặc `?` (quy tắc chưa rõ) |
| `status` | HTTP status. `0` là lỗi mạng hoặc timeout. `-` là không gửi request |
| `bodyHasData` | Với 2xx: body không rỗng (mảng hoặc `items` có phần tử, object có key). Với các status khác: body có chứa ID của tài nguyên được hỏi |
| `result` | Xem bảng dưới |
| `note` | Lý do, ví dụ `leak:otherTenant=2` (chỉ ghi **số lượng** ID rò rỉ), `target=X`, `inconclusive status`, `WRITE ACCEPTED — data may have changed` |

Giá trị của cột `result`:

| Giá trị | Khi nào |
|---|---|
| `PASS` | `DENY` và nhận 401/403/404 mà body không có dữ liệu; hoặc `ALLOW` và nhận 2xx; đồng thời không rò rỉ ID |
| `FAIL` | `DENY` mà nhận 2xx; hoặc `ALLOW` mà nhận 401/403/404; hoặc rò rỉ ID bị cấm (rò rỉ làm dòng FAIL kể cả khi expected là `?`) |
| `?` | expected là `?`; hoặc status không kết luận được (400/409/422/5xx); hoặc rò rỉ thuộc nhóm chưa rõ |
| `SKIP` | Thiếu dữ liệu để thử, ví dụ tenant không có học liệu hoặc job xử lý |

## Quy tắc nghiệp vụ (nguồn của expected)

- Tenant khác: luôn bị từ chối.
- ADMIN: được làm mọi thứ trong tenant mình. `/cloud/*` chỉ dành cho ADMIN.
- TEACHER được xem:
  - lớp mình dạy và học viên của các lớp đó;
  - điểm danh, điểm và học liệu của các lớp đó;
  - hồ sơ của mình.

  TEACHER không được: xem hóa đơn/thanh toán, `/reports`, `/activity`, `/cloud/*`; quản lý học viên/khóa/lớp.
- STUDENT chỉ được xem:
  - dữ liệu của mình: hồ sơ, điểm, điểm danh, hóa đơn, thanh toán;
  - lớp, khóa và học liệu của lớp đã ghi danh.

  STUDENT không được xem học viên khác hay lớp khác. Danh sách học viên cùng lớp là `?`.
- Chưa đăng nhập: chỉ được gọi `/health`, `/health/live`, `/auth/options`, `/auth/login`, `/auth/register`.

### Quyết định của dev (bổ sung cho quy tắc trên)

Các quyết định này lấy hành vi đã quan sát làm expected. Route danh sách vẫn được kiểm rò rỉ ID như bình thường.

| Câu | Route | TEACHER | STUDENT |
|---|---|---|---|
| Q3 | `/dashboard`, `/notifications`, `/notifications/unread-count` | ALLOW | ALLOW |
| Q4 | `/courses`, `/rooms`, `/grade-bands`, `/teachers` | ALLOW | ALLOW |
| Q5 | `/teachers/:id`, `/teachers/:id/overview` | chỉ chính mình, người khác DENY | chỉ giáo viên của lớp đã ghi danh, người khác DENY |
| Q6 | `/courses/:id` | chỉ khóa của lớp mình dạy | chỉ khóa của lớp đã ghi danh |
| Q7 | `/enrollments` | ALLOW (giới hạn phạm vi) | ALLOW (giới hạn phạm vi) |
| Q8 | `/schedule/conflicts` | DENY | DENY |
| Q8 | `/attendance/pending` | ALLOW | DENY |
| Q9 | `/context/personas` | 200 và `items` phải rỗng, nếu không thì FAIL | 200 và `items` phải rỗng, nếu không thì FAIL |
| Q10 | `/classrooms/:id/students` | ALLOW nếu là lớp mình dạy | lớp đã ghi danh: ALLOW, chỉ thấy chính mình (lộ ID bạn cùng lớp là FAIL) |
| Q11 | `/classrooms/:id/attendance-summary` | ALLOW nếu là lớp mình dạy | ALLOW nếu là lớp đã ghi danh |
| Q12 | `/students` (danh sách) | ALLOW | ALLOW, chỉ thấy chính mình |

### Còn chờ dev — giữ `?`, cột `note` có nhãn `CHỜ DEV (Qn: …)`

| Câu | Nội dung |
|---|---|
| Q1 | Học viên INACTIVE có được đăng nhập không? (dòng `POST /auth/login` của `studentInactive`) |
| Q2 | Request ghi không có header Origin có được chấp nhận không? (dòng `PATCH` của adminA không có Origin, chỉ chạy khi có `--include-writes`) |
| Q13 | Học liệu không gắn lớp (visibility COURSE/PERSONAL) thì ai được xem; STUDENT có được xem `/materials/:id/history` không? |
| Q14 | Ghi danh DROPPED/CANCELLED có còn cho xem lớp, học viên, khóa hay giáo viên liên quan không? |

### Lỗi đã biết — vẫn là FAIL, cột `note` ghi mã lỗi

| Mã | Nội dung |
|---|---|
| BUG-02 | `GET /cloud/logs` (nguồn `app`) trả cả các dòng log có `tenantId = null`. Callback ghi `callback.duplicate`/`callback.ignored` kèm `materialId` nhưng không có `tenantId`, nên admin tenant khác thấy được ID học liệu. |

Cần sửa expected thì sửa `LIST_ROUTES` và `ID_ROUTES` trong script; nhãn nằm trong `PENDING` và `KNOWN_BUGS`.

## Giới hạn

- **Rò rỉ chỉ được phát hiện qua UUID.** Script không nhận ra tên, email, số tiền hay số liệu tổng hợp lộ ra mà không kèm ID. Ví dụ: điểm của lớp khác trong `/students/:id/grades` khi gọi bằng TEACHER, nếu không có ID lớp hay bài kiểm tra đi kèm.
- Mỗi loại tài nguyên chỉ được thử với một vài ID đại diện (X/Y/B), không phải toàn bộ dữ liệu.
- Expected phụ thuộc vào quan hệ dữ liệu đọc được qua API của admin. Nếu chính API admin sai, expected cũng sai theo.
- Khi API chạy với `AUTH_MODE=demo`, request không có cookie vẫn nhận principal demo. Các dòng anonymous sẽ FAIL, kèm ghi chú.
- Trên production, `/cloud/*` còn bị giới hạn theo IP (`OPS_ALLOWED_CIDRS`). Gọi từ ngoài dải IP đó, dòng ADMIN sẽ FAIL vì lý do mạng, không phải vì phân quyền.
- `/storage/local/object` được ủy quyền bằng token ký, không bằng phiên đăng nhập, nên chỉ được thử với anonymous.
- `--include-writes` có thể làm thay đổi dữ liệu **nếu phân quyền thực sự hỏng**: tạo học viên "Authz Probe", ghi thanh toán 1.000đ, thêm ghi danh. Những dòng như vậy có ghi chú `WRITE ACCEPTED`. Vì thế cờ này chỉ cho phép với localhost; sau khi chạy nên seed lại.
- Script không thử các request ghi với actor *được phép* (không kiểm hướng ALLOW của request ghi).
