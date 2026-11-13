# DUC.md — TECH LEAD & INTEGRATION HANDOFF

| Mục | Nội dung |
|---|---|
| Dự án | EduCenter Cloud — B2B SaaS quản lý trung tâm giáo dục, Microsoft Azure + Alibaba Cloud (tổ hợp số 9) |
| Vị trí file | `docs/handoff/DUC.md` |
| Phiên bản · Ngày tạo | 1.0 · 14/11/2026 |
| Người nhận | **Đức — TV1 — Tech Lead / Architecture & Integration** |
| Tài liệu nguồn | `ROADMAP.md` v1.2 (§2.3, §3.3, §5, §6, §7, §8, §10, §11, §15) · `EduCenter_Cloud_Ban_Thiet_Ke_2.md` (V2) · `BTL CK 1.pdf` · Quyết định mô hình tài liệu tối giản của trưởng nhóm (14/11) |
| Không có khi soạn | `DOANH.md`, `ANH.md`, `HA.md`, `DUONG.md`, `GIANG.md` không có trong Project → phần phối hợp dựa trên ROADMAP; đối chiếu lại khi các file vào repo |
| Trạng thái | **DRAFT — chờ trưởng nhóm xác nhận.** Chưa có task nào Done; tài liệu không chứa kết quả đo hay evidence |
| Thứ tự ưu tiên khi mâu thuẫn | Quyết định mới của trưởng nhóm (mô hình tài liệu) → ROADMAP §15 (phân công cuối) → ROADMAP §5 (backlog) → V2. Mâu thuẫn còn mở: §7.2 |

**Quy ước đọc**

- TV1 Đức · TV2 Doanh · TV3 Anh · TV4 Hà · TV5 Dương · TV6 Giang (D-01, Accepted).
- ROADMAP dùng tiền tố `R-` cho cả **chương báo cáo** (§11.1) và **rủi ro** (§10.1). DUC.md luôn ghi rõ: "Ch1 (R-01)" là chương, "Risk R-01" là rủi ro.
- `Est` = giờ ước lượng gốc ở ROADMAP §5, không phải giờ đã dùng.
- Trạng thái task theo ROADMAP §7.11: Todo → InProgress → InReview → Merged → Verified → Done. **Done chỉ khi có commit SHA + log test + mục "Kết quả & bàn giao" trong PR.**
- "Đề xuất" trong file này = gợi ý thực thi của DUC.md, chưa phải quyết định; cần ghi vào Decision Log nếu ảnh hưởng nhóm.

---

## 1. AI Execution Protocol & Vai trò

### 1.1. Phạm vi vai trò

| Loại | Đức làm | Đức **không** làm |
|---|---|---|
| Triển khai trực tiếp | Xác nhận đăng ký (P0-01), Repo foundation (P0-04), Workflow tối giản (P0-05), OpenAPI v0/v1 (P0-09, P1-14), Audit service (P1-07), Dashboard API (P2-04), FE Admin Tuition + Dashboard (P2-14), Feature freeze (P3-01), Bench build (P3-10), Tài liệu kỹ thuật release (P5-03), Go/No-Go (P5-04), Nộp link (P6-07) | NestJS skeleton (Anh, P0-07) · React skeleton (Doanh, P0-10) · Prisma schema/migration (Hà) · Auth/AuthZ/TenantTx/RLS (Anh) · Azure IaC, CI/CD, E2E, benchmark (Giang) · OSS/FC/Materials (Dương) · Ghép báo cáo Word (Hà, Giang, Dương) |
| Review / phê duyệt | Contract; **pool B** (tuition, migrations, `infra/azure`); PR FE của Doanh; reviewer dự phòng **pool A** — thực tế là approver bắt buộc cho PR pool A do Anh viết (§5.1); gate G0, G1, G2; hotfix sau freeze cùng Anh | Tự approve PR của mình; dùng quyền admin để bypass branch protection |
| Điều phối | Kick-off & Decision Log; chủ trì IP-3; theo dõi blocker/velocity; release tag; chủ trì Go/No-Go; nộp bài | Dùng AI của mình viết lại phần việc của owner khác khi họ chậm (xem §4.5) |

### 1.2. Quy trình mỗi phiên AI (Claude Code / Codex)

> Repo **không có** `AGENTS.md`/`CLAUDE.md`, nên agent không tự nạp luật dự án. Mỗi phiên **bắt buộc** mở đầu bằng prompt §1.4.

1. Đọc `ROADMAP.md` (§2.3 Decision Log, dòng task ở §5, §7 quy tắc làm việc, §8 gate) và `docs/handoff/DUC.md` (mục của task).
2. Kiểm tra repo: `git status`, `git fetch`, `git switch main && git pull`, đọc code liên quan, xem PR đang mở chạm cùng file.
3. Xác định task TV1 tiếp theo và dependency đã **merge trên `main`** hay chưa. Thiếu → dừng, ghi blocker (§4.5).
4. Đề xuất nhóm task liên quan cho phiên (batch §1.3) — vẫn **mỗi task 1 branch, 1 PR**.
5. Chỉ sửa trong **Allowed files** của task (§3).
6. Viết test trước, chạy lint/typecheck/test, đối chiếu acceptance criteria (AC).
7. Mở PR theo template, ghi kết quả thật + bàn giao trong PR, cập nhật tiến độ (§4.4).
8. Chỉ sang batch tiếp theo khi PR đã merge hoặc phần còn lại không phụ thuộc.

### 1.3. Batch gợi ý

| Batch | Task | Khung thời gian | Điều kiện bắt đầu | Điều kiện kết thúc |
|---|---|---|---|---|
| **B1** Repository Foundation | P0-04 → P0-05 (P0-01 làm thủ công trước) | 14/11 10:00 → 15/11 sáng | Kick-off chốt D-23 và phiên bản Node/pnpm (D-20) | Repo có branch protection + CODEOWNERS + PR template; PR ROADMAP v1.3 đã mở |
| **B2** OpenAPI | P0-09 (14/11) → P1-14 (16–17/11) | 14/11 13:00 → 17/11 | P0-04 merged; D-12, D-24 Accepted | Contract v1 merged trước IP-2 (17/11 tối) |
| **B3** Audit Service | P1-07 (17/11) | 17–18/11 | P1-03 merged; `audit_logs` có trong schema v1 (P1-08) và quyền INSERT/SELECT (P1-23); TenantTx (P1-04) | Interface đã bàn giao cho owner module |
| **B4** Dashboard + Admin Tuition UI | P2-04 (22/11) → P2-14 (23/11) | 22–23/11 | P2-01, P2-02, P2-03 merged; seed 10k (P1-20) | Merged trước G2 (23/11 20:00) |
| **B5** Integration, Freeze, Security review | IP-3, G0–G2, P3-01, P3-06 | 16/11 → 25/11 | Theo từng mốc | Freeze `rc0`; biên bản review chéo |
| **B6** Bench build, Release, Delivery | P3-10, review Phase 4, P5-03, P5-04, P6-* | 25/11 → 30/11 | G3/G4 theo lịch | G6 nộp link |

Batch chỉ là cách gom ngữ cảnh cho AI; **không** đổi Task ID, dependency hay quy tắc PR.

### 1.4. Prompt thực thi chung (dùng lại cho mọi Task ID / Batch ID)

```text
Bạn là AI coding agent hỗ trợ Đức (TV1 — Tech Lead) trong repo EduCenter Cloud.
Phạm vi phiên: <TASK_ID | BATCH_ID>.

0. ĐỌC TRƯỚC: ROADMAP.md (§1.2 baseline, §2.3 Decision Log, dòng <TASK_ID> ở §5,
   §7 quy tắc làm việc, §8 gate) và docs/handoff/DUC.md (mục của <TASK_ID>).
   Đọc packages/api-contract/ và apps/api/prisma/schema.prisma nếu đã tồn tại.
   Không dựa vào lịch sử chat cũ.
1. KIỂM TRA REPO: git status; git fetch; branch hiện tại; PR/commit liên quan.
   Liệt kê dependency của task và trạng thái thực (đã merge trên main hay chưa).
   Dependency chưa sẵn sàng → DỪNG, báo blocker + owner. Không viết thay phần việc của owner khác.
2. KẾ HOẠCH: liệt kê chính xác file sẽ tạo/sửa (chỉ trong "Allowed files" của DUC.md),
   test sẽ viết, quyết định cần con người xác nhận. CHỜ Đức duyệt rồi mới code.
3. Viết test positive + negative từ acceptance criteria trước.
4. Code đúng phạm vi. Branch: <type>/<TASK_ID>-<slug>. Commit: Conventional Commits có [<TASK_ID>].
5. Chạy pnpm lint, pnpm typecheck và test liên quan. Dán lệnh + output THẬT; chưa chạy thì ghi "chưa chạy".
6. Soạn mô tả PR theo .github/pull_request_template.md, gồm mục "Kết quả & bàn giao".
   Không merge, không push thẳng main.

DỪNG VÀ HỎI nếu cần: đổi auth/session/CSRF; tenant scope; schema.prisma/migration; path contract của
module khác; thêm dependency; IAM/RAM/Key Vault; .github/workflows; CODEOWNERS/branch protection;
Decision Log.
CẤM: secret/token thật; dữ liệu học viên thật; cờ bypass auth/rate limit/CSRF; $queryRawUnsafe;
nhận tenant_id/role từ request body; tự tạo field hoặc business rule chưa có trong contract/ROADMAP;
ghi "Pass/Done/Verified" khi chưa có bằng chứng.
```

**Prompt chế độ review** (cho các PR Đức phải duyệt):

```text
Chế độ REVIEW cho PR #<số> (<TASK_ID>, owner <tên>). Đọc ROADMAP §5 dòng <TASK_ID>, ROADMAP §7,
DUC.md §5.2. Đọc diff và kết quả CI. Không sửa code, không approve thay con người.
Xuất: (1) file ngoài phạm vi; (2) vi phạm checklist kèm vị trí; (3) AC chưa có test;
(4) thay đổi contract/schema ngoài quy trình; (5) câu hỏi cho owner.
Phân loại Blocker / Should-fix / Nit.
```

### 1.5. Dừng ngay khi

- Cần sửa file của owner khác (schema, auth, workflow, infra, `apps/web` ngoài thư mục được giao).
- Dependency chưa merge hoặc decision liên quan còn `Proposed`.
- Test negative không fail khi bỏ guard (ROADMAP §7.8).
- Phát hiện secret, dữ liệu thật hoặc URL ký trong diff/log.
- Agent đề xuất thay stack, thêm dịch vụ Cloud, thêm thư viện chart/cache/Redis.

---

## 2. Timeline và Task Inventory

### 2.1. Lịch của Đức

| Ngày | Giờ | Việc | Loại |
|---|---|---|---|
| **14/11** (T7) | 08:30 | P0-01 xác nhận đăng ký | Owner |
| | 09:00–10:00 | Kick-off: chốt D-02, D-03, D-04, D-12, D-14, D-17, D-22, **D-23, D-24, D-25**, phiên bản D-20, mô hình tài liệu mới; mỗi người khai giờ khả dụng | Điều phối |
| | 10:00 | P0-04 (B1) | Owner |
| | 13:00 | P0-09 (B2) — chốt error schema/health với Anh, field students với Hà | Owner |
| | Trong ngày | Review P0-02 (Giang); bật required checks sau khi P0-06 chạy lần đầu | Review |
| | 21:00 | Standup #1 | — |
| **15/11** (CN) | Sáng | P0-05 (ROADMAP v1.3) | Owner |
| | Cả ngày | Review P0-07, P0-10, P0-12, P0-20; xác nhận client contract import được vào `apps/web` | Review |
| | Tối | Review P0-18 (IP-1) | Review |
| **16/11** | 12:00 | **G0** (cùng Anh) | Gate |
| | Ngày | P1-14 phần lớn; review P1-08 (cùng Anh) — kiểm tra cột `audit_logs` **trước freeze 20:00** | Owner/Review |
| **17/11** | | Hoàn tất P1-14; P1-07; review P1-01, P1-03; kiểm tra IP-2 (tối) | Owner/Review |
| **18/11** | | Review P1-04, P1-02 (pool A), P1-05, P1-16; merge P1-07 nếu còn chờ P1-04; theo dõi velocity | Review |
| **19/11** | | **Chủ trì IP-3**; review P1-12, P1-17; quyết định D-05 cùng Anh; xem CP1; nháp Ch1 (R-01); **G1 20:00** | Điều phối/Gate |
| **20–21/11** | | Nháp Ch2 (R-02) 20/11; hoàn thiện path contract còn thiếu (C-17); review P2-03 (pool B), P2-07, P2-10 | Review |
| **22/11** | | P2-04; IP-4; nháp Ch6 (R-07); review P2-09, P2-11 | Owner/Review |
| **23/11** | | P2-14; review P2-12, P2-17, P2-19; IP-5; **G2 20:00** | Owner/Gate |
| **24/11** | 00:00 | P3-01 feature freeze, tag `rc0`; P3-06 cùng Anh; review P3-08 | Owner |
| **25/11** | Trước 12:00 | Review fix pool B (P3-07); review P3-09 | Review |
| | 12:00 | **P3-10 tag `rc0.1`** | Owner |
| | 13:30–18:00 | Review P4-01; theo dõi W1 (P4-03); tối review P4-04; **G3 20:00** (xác nhận) | Review |
| **26/11** | 08:30 | Xác nhận nội dung `rc0.2` | Review |
| | 09:00–13:00 | Theo dõi W2; review P4-11; G4 20:00; tối review P5-01; bắt đầu P5-03 | Review/Owner |
| **27/11** | 12:00 | **P5-04 Go/No-Go**; P5-05 duyệt hotfix (cùng Anh); bản cuối Ch1, Ch6; nháp Ch10; review P6-03; P6-05 slide | Owner |
| **28/11** | | Review/duyệt P6-04 video; bản cuối Ch2, Ch10; P6-05; hạn hotfix NO-GO 12:00 (nếu có) | Review |
| **29/11** | Sáng | P6-06 kiểm tra chéo | Co-owner |
| | ≤ 22:00 | **P6-07 nộp link (G6)** | Owner |
| **30/11** | | P6-08 cùng Giang; review P6-09 | Co-owner |

### 2.2. Task Inventory

**A. Owner — trực tiếp thực hiện**

| Task | Nội dung | Reviewer | Ngày · Est | Batch | Ghi chú |
|---|---|---|---|---|---|
| P0-01 | Xác nhận nhóm 6 người + tổ hợp 9 | Cả nhóm | 14/11 · 0,5h | — | Chặn task tiêu tiền Cloud |
| P0-04 | Monorepo, CODEOWNERS, PR template, branch protection (D-23) | Giang | 14/11 · 3h | B1 | Critical path |
| P0-05 | Workflow tối giản trong ROADMAP | Anh | 15/11 sáng · 2h | B1 | **Deliverable đổi** (§3.3, C-01) |
| P0-09 | OpenAPI v0 | Doanh | 14/11 · 4h | B2 | |
| P1-14 | OpenAPI v1 + codegen + response validation | Doanh | 16–17/11 · 6h | B2 | Critical path |
| P1-07 | Audit log service append-only | Anh | 17/11 · 3h | B3 | Chặn P1-06, P2-03 |
| P2-04 | Dashboard summary theo vai trò | Hà | 22/11 · 3h | B4 | |
| P2-14 | FE Admin Tuition + Dashboard | Doanh | 23/11 · 3h | B4 | |
| P3-01 | Feature freeze, tag `rc0`, changelog | Cả nhóm | 24/11 00:00 · 1h | B5 | |
| P3-10 | Bench build `rc0.1` | Giang | 25/11 12:00 · 0,5h | B6 | |
| P5-03 | Gói tài liệu kỹ thuật | Owners | 26–27/11 · 4h | B6 | |
| P5-04 | Go/No-Go | Cả nhóm | 27/11 12:00 · 1h | B6 | → G5 |
| P6-07 | Upload + link public + dán Excel | Giang | 29/11 · 1h | B6 | → G6 |

**B. Co-owner**

| Task | Cùng với | Ngày · Est | Ghi chú |
|---|---|---|---|
| P3-06 Review chéo code AI module nhạy cảm | Anh (chéo) | 24–25/11 · 4h (chia) | Đức review module Anh viết; Anh review module Đức/người khác viết |
| P6-05 Slide | Anh, Doanh | 27–28/11 · 5h (chia 3) | Theo §15; backlog §5 ghi TV4 (C-05) |
| P6-06 Kiểm tra chéo + định dạng | Cả 6 (§15); owner checklist Anh | 29/11 sáng · 2h | Đức xác nhận cuối (C-06) |
| P6-08 Kiểm tra link + demo env | Giang | 30/11 · 1h | Không deploy |
| Ch1 (R-01), Ch2 (R-02), Ch6 (R-07), Ch10 (R-11) | — | 19/11 → 28/11 · 10h | Viết nội dung chương (§6) |

**C. Reviewer (task có TV1 ở cột Reviewer trong ROADMAP §5)**

| Phase | Task (owner) |
|---|---|
| P0 | P0-02 (Giang) · P0-07 (Anh) · P0-10 (Doanh) · P0-12 (Giang) · P0-18 (Dương + Giang) · P0-20 (Doanh) |
| P1 | P1-01 (Anh) · P1-03 (Anh) · P1-05 (Anh + Hà) · P1-08 (Hà, cùng Anh) · P1-12 (Hà) · P1-16 (Doanh) · P1-17 (Doanh) |
| P2 | P2-03 (Hà, cùng Anh — pool B) · P2-09 (Dương) · P2-11 (Doanh) · P2-12 (Doanh) · P2-17 (Giang + Doanh) · P2-19 (Anh) |
| P3 | P3-07 (fix pool B) · P3-08 (Doanh) · P3-09 (Doanh) |
| P4 | P4-01 (Giang) · P4-03 (Giang + Hà) · P4-04 (Hà + Anh) · P4-11 (Giang) |
| P5 | P5-01 (Giang) |
| P6 | P6-02 (Giang + Hà) · P6-03 (Doanh) · P6-04 (Doanh + Dương — **duyệt cuối** theo §15) · P6-09 (Giang) |

**D. Reviewer theo đường dẫn (CODEOWNERS)**

| Pool | Đường dẫn | Vai trò Đức | Task chạm tới |
|---|---|---|---|
| B (chính) | `apps/api/src/tuition/` · `apps/api/prisma/migrations/` · `infra/azure/` | Reviewer chính; dự phòng là Anh | P0-08, P1-05 (migration), P1-08, P2-03, P2-10, P2-20 · P0-11, P2-15 (phần infra), P4-01 |
| A (dự phòng) | `auth/` · `common/authz/` · `common/prisma/` · `materials/internal/` · `materials/storage/` · `infra/aliyun/ram/` | Khi tác giả là Anh, Đức là người duyệt hợp lệ còn lại | P0-16, P0-17, P1-01, P1-02, P1-03, P1-04, P2-07 · P0-14 (Dương → Anh duyệt) |
| Contract | `packages/api-contract/` | Phê duyệt mọi thay đổi | Mọi PR có path contract |
| File dùng chung | `apps/api/src/app.module.ts`, `ROADMAP.md`, `docs/handoff/` | Owner | Mọi PR đăng ký module |

**E. Phê duyệt & điều phối**

| Hạng mục | Vai trò Đức | Nguồn |
|---|---|---|
| G0 · G1 · G2 | Approver (G0 cùng Anh; G1 cùng Anh + Giang; G2 một mình) | §8.1 |
| G3 · G4 | G3: xác nhận sau Anh + Giang · G4: reviewer task, approver là Giang + Hà | §8.1 |
| G5 · G6 | Chủ trì P5-04 (cả nhóm quyết) · G6 cùng Giang | §8.1 |
| Hotfix sau freeze | 1 trong 2 approval bắt buộc (cùng Anh) | P5-05 |
| Decision | Người quyết/đồng quyết: D-02, D-03, D-04, D-05, D-12, D-14, D-20, D-22, D-24, D-27, D-30, D-32; cả nhóm: D-01, D-08, D-23 | §2.3 |
| Integration Point | Chủ trì IP-3; theo dõi IP-1, IP-2, IP-4, IP-5 | §3.3 |
| Risk owner | Risk R-01, R-07, R-12, R-17, R-18 | §10.1 |
| Dependency bên ngoài | Xác nhận đăng ký; GitHub org/repo + branch protection; link Drive/OneDrive | §2.1.4 |
| Contingency | Theo dõi velocity; kích hoạt scope-cut khi < 80% tại G1 | §6.2, §10.2 |

---

## 3. Detailed Implementation Guide

**Definition of Done chung cho task của Đức:** PR merged qua review (không tự approve) · CI xanh · test chạy thật có log · AC tick đủ trong PR · mục "Kết quả & bàn giao" đầy đủ · không file ngoài Allowed files · tiến độ đã cập nhật.

### 3.1. P0-01 — Xác nhận đăng ký nhóm

| Mục | Nội dung |
|---|---|
| Dependency | Không |
| Allowed files | Không sửa repo |
| Chặn | P0-11, P0-13 và mọi task tiêu tiền Cloud (không chặn P0-04 — RV-15) |

**Các bước**

1. 08:30 14/11: mở sheet đăng ký (đăng nhập email `vnu.edu.vn` theo đề BTL), kiểm tra tên nhóm, đủ 6 thành viên, tổ hợp **9. Azure + Aliyun**.
2. Chụp màn hình. Lưu bản gốc trong Drive nhóm (không public). Nếu cần đưa vào repo public (D-23) thì che email/MSSV của người khác (RV-34).
3. Báo kết quả ở kick-off 09:00.
4. Nếu không thấy hoặc không hợp lệ: email thầy ngay trong sáng 14/11; dừng chi tiêu Cloud; việc local tiếp tục (Risk R-01, §13.3).

**AC:** ảnh có tên nhóm + tổ hợp 9; trạng thái được thông báo trước khi Giang/Dương tạo resource.
**Evidence:** ROADMAP ghi `docs/evidence/P0-01/`; theo mô hình mới chỉ tạo thư mục khi cần cho G0 (C-03, C-24).

### 3.2. P0-04 — Repository và Monorepo

| Mục | Nội dung |
|---|---|
| Dependency | Kick-off chốt **D-23** (repo public trong org, hay phương án B) và phiên bản Node LTS + pnpm (D-20). ROADMAP §13.3 yêu cầu D-23, D-24, D-25 Accepted trước P0-04 (C-20) |
| Reviewer | Giang |
| Allowed files | `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `.nvmrc`, `.gitignore`, `.env.example`, `README.md`, `.github/CODEOWNERS`, `.github/pull_request_template.md`, `.gitkeep` trong thư mục trống, `docs/handoff/*.md`, `ROADMAP.md` (copy nguyên v1.2) |
| Không sửa | `.github/workflows/` (P0-06 Anh), `apps/api/src`, `apps/web/src`, `apps/api/prisma`, script trong `infra/` |

**Cấu trúc bàn giao**

```text
educenter-cloud/
├── apps/
│   ├── api/                 # .gitkeep — Anh tạo NestJS skeleton (P0-07)
│   └── web/                 # .gitkeep — Doanh tạo React skeleton (P0-10)
├── packages/
│   └── api-contract/        # .gitkeep — Đức điền ở P0-09
├── functions/
│   └── material-processor/  # .gitkeep — Dương (P0-15), Python, ngoài pnpm workspace
├── infra/
│   ├── azure/               # .gitkeep — Giang (P0-02, P0-11)
│   └── aliyun/              # .gitkeep — Dương (P0-03, P0-13, P0-14)
├── tests/                   # .gitkeep — Giang/Doanh
├── docs/
│   └── handoff/             # DUC.md, DOANH.md, ANH.md, HA.md, DUONG.md, GIANG.md
├── .github/
│   ├── CODEOWNERS
│   └── pull_request_template.md
├── ROADMAP.md
├── README.md
├── package.json · pnpm-workspace.yaml · pnpm-lock.yaml
└── .nvmrc · .gitignore · .env.example
```

Không tạo `AGENTS.md`, `CLAUDE.md`, `docs/adr/`, `docs/tasks/`, `docs/handoffs/`, `docs/architecture/`, `docs/evidence/`, `docs/runbooks/`. Các thư mục docs khác chỉ được tạo bởi task thực sự cần (C-03).

**Các bước**

1. **Tạo repo theo D-23.** Phương án A: public trong org nhóm. Phương án B: private dưới tài khoản có GitHub Pro (SAST = Semgrep, không có environment approval → `workflow_dispatch` chỉ cho admin + biên bản). Trước khi public: rà để không có email/số điện thoại/dữ liệu thật (RV-34).
2. **File gốc:**

| File | Nội dung tối thiểu |
|---|---|
| `package.json` | `"private": true`; `packageManager` khóa đúng phiên bản pnpm (D-20); `engines.node`; script `lint`, `typecheck`, `test`, `build` dạng `pnpm -r --if-present run <script>` để CI của P0-06 xanh khi workspace chưa có package. Không thêm dependency ứng dụng |
| `pnpm-workspace.yaml` | `apps/*`, `packages/*` |
| `.nvmrc` | Node LTS đã chốt tại kick-off (ghi vào D-20) |
| `pnpm-lock.yaml` | Sinh bởi `pnpm install`, commit |
| `.gitignore` | `node_modules`, output build, coverage, `.env` và `.env.*` (trừ `.env.example`), báo cáo Playwright/k6, môi trường Python, **file token session benchmark (D-16)** — đường dẫn chốt với Giang |
| `.env.example` | Chỉ placeholder, không giá trị thật; owner module tự thêm key khi cần (P0-07, P0-11) |
| `README.md` | Mục đích repo, cấu trúc thư mục, link `ROADMAP.md` và `docs/handoff/`. Hướng dẫn chạy local do P0-19/P5-03 bổ sung |

3. **CODEOWNERS** (`.github/CODEOWNERS`). Dùng **GitHub username thật** — chưa có trong tài liệu, điền khi kick-off (C-22). Bản nháp:

| Đường dẫn | Owners (≥ 2 với path nhạy cảm) | Cơ sở |
|---|---|---|
| `/apps/web/` | Doanh, Đức | §6.1 |
| `/apps/api/src/students/`, `classrooms/`, `enrollments/`, `attendance/`, `grades/` | Hà, Anh | Reviewer §5 |
| `/apps/api/src/teachers/`, `courses/`, `users/`, `materials/` | Dương, Anh | Reviewer §5 |
| `/apps/api/src/common/audit/` | Đức, Anh | P1-07 |
| `/apps/api/src/dashboard/` | Đức, Hà | P2-04 |
| `/apps/api/src/app.module.ts` | Đức, Anh | §7.1 |
| `/apps/api/prisma/schema.prisma` | Hà, Đức | D-27 |
| `/apps/api/prisma/migrations/` | Hà, Đức, Anh | Pool B + label `migration` |
| `/apps/api/src/tuition/`, `/infra/azure/` | Đức, Anh | Pool B |
| `/apps/api/src/auth/`, `/apps/api/src/common/authz/`, `/apps/api/src/common/prisma/`, `/apps/api/src/materials/internal/`, `/apps/api/src/materials/storage/`, `/infra/aliyun/ram/` | Anh, Đức | Pool A |
| `/.github/workflows/` | Giang, Anh | Pool C |
| `/packages/api-contract/` | Đức, Doanh | Contract |
| `/functions/`, `/infra/aliyun/` | Dương, Anh | §6.1 |
| `/tests/`, `/scripts/seed/` | Giang, Hà | §6.1 |
| `/ROADMAP.md`, `/docs/handoff/` | Đức, Anh | Tài liệu điều phối |
| `/.github/CODEOWNERS` | Đức, Giang | §7.10 |

   Lưu ý kỹ thuật: dòng khớp **sau cùng** thắng → đặt path tổng quát trước, path nhạy cảm sau. Chỉ cần **một** owner trong danh sách approve; tác giả không tự approve được → PR pool A của Anh cần Đức (§5.1, C-26).

4. **PR template** (`.github/pull_request_template.md`) — thay cho task card và handoff file:

```markdown
## Task
Task ID: [Px-yy] · Owner: · Reviewer: · Batch:
## Phạm vi
Allowed files (ROADMAP §5 / docs/handoff): · File đã sửa:
## Contract / Schema
- [ ] Không đổi   - [ ] Có — PR contract/schema: #
## Test đã chạy (lệnh + kết quả thật)
## Acceptance criteria (copy từ ROADMAP §5)
- [ ] ...
## Rủi ro bảo mật & giảm thiểu
## Kết quả & bàn giao
Trạng thái: Done / Partial / Blocked
Đã làm: · Quyết định/giả định mới (→ Decision Log): · Còn tồn tại:
Out-of-scope requests: · Ghi chú cho người/agent tiếp theo:
Evidence (CI run, ảnh, log — kèm SHA):
```

5. **Labels:** `migration`, `fix`, `test`, `docs`, `security` (dùng cho freeze P3-01 và quy tắc migration §7.4). Đề xuất thêm `contract` để theo dõi PR contract-first.
6. **Branch protection `main`:** require PR; 1 approval; require review from Code Owners; dismiss stale approvals; chặn force push và xóa nhánh; squash merge; tự xóa nhánh sau merge; **không cho phép bypass, kể cả admin**. Required status checks: bật **sau** khi CI P0-06 chạy lần đầu (tên check mới xuất hiện), cùng Giang cập nhật khi P1-18 thêm job.
7. **Xác minh theo D-23 và chụp evidence:** push thẳng `main` bị chặn; PR thiếu approval không merge được; PR chạm path pool A tự gợi ý đúng owner; trang Settings cho thấy protected branch, CODEOWNERS bắt buộc, khả năng environment required reviewers (phương án A), code scanning hoặc phương án SAST thay thế.
8. Đưa các file `docs/handoff/` đang có vào repo (file thiếu thì owner tự thêm qua PR).

**Test:** `pnpm install --frozen-lockfile` chạy được; PR mẫu chạy CI (sau khi P0-06 merge); thử push thẳng `main`.

**AC (ROADMAP + mô hình mới):** install frozen lockfile OK · push thẳng `main` bị chặn · PR cần 1 approval + CODEOWNERS · ảnh Settings xác nhận từng tính năng thật · không có `AGENTS.md`/`CLAUDE.md`/thư mục docs cũ.

**Điều kiện bàn giao cho nhóm (khung được nghiệm thu)**

| # | Điều kiện | Người nhận |
|---|---|---|
| 1 | Mọi thành viên clone được, có quyền tạo branch/PR | Cả nhóm |
| 2 | `pnpm install --frozen-lockfile` chạy với Node/pnpm đã chốt | Cả nhóm |
| 3 | Thư mục đích tồn tại đúng cấu trúc | Anh (`apps/api`), Doanh (`apps/web`), Hà (`apps/api/prisma` qua P0-08), Dương (`functions`, `infra/aliyun`), Giang (`infra/azure`, `tests`) |
| 4 | CODEOWNERS dùng username thật, review request đúng người | Cả nhóm |
| 5 | Branch protection hoạt động, có ảnh evidence | Giang (reviewer) |
| 6 | Thông báo nhóm: link repo + "đọc ROADMAP.md và file handoff của mình" | Cả nhóm |

### 3.3. P0-05 — Chuẩn hóa workflow tối giản

**Thay đổi deliverable so với ROADMAP v1.2**

| v1.2 (cũ) | Theo quyết định mới |
|---|---|
| Viết `AGENTS.md`, `CLAUDE.md` | Không tạo. Quy tắc §7.2 được giữ nguyên nội dung, chuyển thành "Quy tắc làm việc chung" trong `ROADMAP.md` §7 |
| `docs/adr/ADR-LOG.md` + ADR-015…027 đầy đủ | Không tạo file ADR. Decision Log trong `ROADMAP.md` §2.3 là nơi ghi duy nhất; mã ADR-0xx giữ làm nhãn tham chiếu trong dòng D-xx |
| Task card `docs/tasks/<TaskID>.md` | Tra trực tiếp dòng task ở ROADMAP §5 + file `docs/handoff/<TÊN>.md` |
| Handoff `docs/handoffs/<TaskID>.md` | Mục "Kết quả & bàn giao" trong PR (§3.2 bước 4) |

| Mục | Nội dung |
|---|---|
| Dependency | P0-04 merged; kết quả kick-off |
| Reviewer | Anh |
| Allowed files | `ROADMAP.md` |
| Est | 2h (giữ nguyên; có thể ít hơn do không viết ADR) |

**Các bước (1 PR: `docs(roadmap): v1.3 workflow tối giản [P0-05]`)**

1. Header: phiên bản 1.3 + ghi chú thay đổi mô hình tài liệu.
2. §2.3 Decision Log: cập nhật trạng thái **chỉ** những decision đã thực sự Accept ở kick-off; thêm một dòng ghi quyết định mô hình tài liệu (đề xuất mã **D-34**, trưởng nhóm xác nhận).
3. §4 Phase 0: "Repo monorepo + AGENTS.md" → "Repo monorepo + docs/handoff/".
4. §5: sửa cột Module/File của P0-04 (`docs/` → `docs/handoff/`), viết lại dòng P0-05; P1-05 `docs/adr/ADR-020.md` → "Decision Log D-05 + PR"; P5-03 "ADR cập nhật" → "Decision Log cập nhật".
5. §6.1 và header: bỏ các câu "chưa gán người"/"bỏ gán tên" đã lỗi thời sau §15 (C-10).
6. §7: viết lại 7.1 (file context = `ROADMAP.md`, `docs/handoff/`, contract, schema, `app.module.ts`, PR); 7.2 → "Quy tắc làm việc chung" giữ nguyên danh sách Cấm/Bắt buộc/Pool; 7.6 → tra §5; 7.7 → PR template; 7.9 → trỏ tới prompt chung trong file handoff; 7.11 → nơi ghi kết quả gate (C-21).
7. §15.1: ghi chú "AGENTS.md/CODEOWNERS" → chỉ CODEOWNERS.
8. Không đổi kiến trúc, Task ID, deadline, estimate, AC ngoài các điểm tài liệu trên.

**AC:** tìm `AGENTS.md|CLAUDE.md|docs/adr|docs/tasks|docs/handoffs` trong ROADMAP chỉ còn ở ghi chú lịch sử thay đổi · toàn bộ nội dung quy tắc §7.2 cũ vẫn còn ở vị trí mới · không file mới · Anh approve.

> Trạng thái tại thời điểm soạn DUC.md: **chưa thực hiện**. DUC.md không chỉnh ROADMAP.

### 3.4. P0-09 — OpenAPI v0

| Mục | Nội dung |
|---|---|
| Dependency | P0-04 merged · D-12 (tiền = string), D-24 (login có `tenantSlug`) Accepted |
| Phối hợp cùng ngày | Anh (P0-07: error filter, request-id, `/health`) · Hà (P0-08: field `students` theo schema v0) |
| Reviewer | Doanh |
| Allowed files | `packages/api-contract/**` (root `package.json` chỉ nếu cần script) |

**Cấu trúc đề xuất**

```text
packages/api-contract/
├── package.json        # scripts: lint, bundle, generate, check
├── openapi.yaml        # info, servers (/api/v1), securitySchemes, tags, paths → $ref
├── components/
│   ├── schemas/        # Error, FieldError, PageMeta, Money (VND string), DateTime
│   ├── parameters/     # page, pageSize, Idempotency-Key, header CSRF (chốt với Anh)
│   └── responses/      # 400, 401, 403, 404, 409, 429 dùng chung
├── paths/
│   ├── health.yaml
│   ├── auth.yaml
│   ├── me.yaml
│   └── students.yaml
└── generated/          # client/type sinh tự động — không sửa tay
```

Công cụ lint/bundle/codegen chưa được ROADMAP chốt. Đề xuất: một công cụ lint + bundle OpenAPI (ví dụ Redocly CLI) và một công cụ sinh type/client TypeScript (ví dụ openapi-typescript). Ghi lý do + phiên bản khóa trong PR và Decision Log. Đề xuất commit thư mục `generated/` để CI phát hiện drift bằng cách sinh lại và so `git diff`.

**Conventions**

| Hạng mục | Quy ước | Nguồn | Chốt với |
|---|---|---|---|
| Prefix | `/api/v1` | V2 §14 | — |
| Error | `{ code, message, requestId, fieldErrors? }`; không stack trace/lỗi DB | V2 §14, P0-07 | Anh — shape của `fieldErrors` |
| Pagination | `?page&pageSize`; mặc định 25–50; tối đa 100; định nghĩa envelope (items + meta) trong P0-09 | V2 §8.4 | Doanh, Hà |
| Tiền VND | `string` chỉ gồm chữ số; DB `BIGINT` | D-12 | Hà |
| Thời gian | ISO-8601 UTC (`format: date-time`); hiển thị Asia/Ho_Chi_Minh ở FE | V2 §9.1 | Doanh |
| Idempotency-Key | Component header dùng lại; áp dụng **chỉ** `POST /invoices/:id/payments` (bắt buộc) và `POST /classrooms/:id/enrollments` | D-13 | Hà |
| Session | Cookie `__Host-educenter_session` (securityScheme cookie) | V2 §11.3 | Anh |
| CSRF | Header cho POST/PUT/PATCH/DELETE; tên header + cách FE lấy token | P1-02 | Anh — **chưa có trong tài liệu, không tự đặt** |

**Endpoint v0**

| Endpoint | Ghi chú | Điểm cần chốt |
|---|---|---|
| `GET /health` | Liveness + DB readiness | Shape response — Anh |
| `POST /auth/login` | Body `tenantSlug`, `email`, `password`; set cookie; lỗi 401 **không phân biệt** sai tenant/email/mật khẩu; 429 + `Retry-After` (P1-06) | Body response — Anh |
| `POST /auth/logout` | Thu hồi phiên; cần CSRF | CSRF — Anh |
| `GET /me` | Tài khoản hiện tại | Field (id, role, tenant…) — Anh |
| `GET /students`, `POST /students` | List có pagination + tìm theo mã/tên; create | Field theo schema v0 — Hà |
| `GET /students/{id}`, `PATCH /students/{id}` | P1-09 có "get"; V2 §14 chỉ liệt kê PATCH | Hà |

**Test:** lint spec · bundle · sinh client thành công · import được vào `apps/web` (thư mục web chỉ có từ 15/11 qua P0-10 → xác nhận cùng Doanh ngày 15/11, C-18).
**AC:** spec lint + bundle pass; client sinh được và import vào web. Script `lint` của package được root `pnpm lint` gọi → job lint của P0-06 tự chạy, không cần sửa workflow.

**Bàn giao v0**

| Người nhận | Nhận gì | Dùng cho |
|---|---|---|
| Doanh | Generated client/types; error schema; pagination; quy tắc tiền/thời gian; luồng cookie + CSRF | P0-10, P1-15 |
| Anh | Contract health/auth/me; error schema phải khớp error filter; securitySchemes; quy ước 401/403/429 | P0-07, P1-01, P1-02 |
| Hà | Path students; conventions pagination/tiền/UTC | P0-08, P1-09 |
| Giang | Script `lint`/`bundle` để đưa vào CI security gates | P1-18 |

### 3.5. P1-14 — OpenAPI v1

| Mục | Nội dung |
|---|---|
| Dependency | P0-09 · schema v1 đóng băng 16/11 20:00 (P1-08) để chốt tên field |
| Hạn thực tế | Path auth phải merge trước P1-15 (17/11) và IP-2 (17/11 tối) |
| Reviewer | Doanh (đề xuất mời thêm owner backend của path liên quan) |
| Allowed files | `packages/api-contract/**` |

**Phạm vi v1 theo module**

| Path file | Endpoint V2 §14 | Bổ sung từ Decision/Task | Owner đề xuất chi tiết | Contract cần merge trước |
|---|---|---|---|---|
| `auth.yaml`, `me.yaml` | login, logout, me | `POST /auth/change-password` (D-28, P1-25 — Dương sửa `auth.yaml`); 429 login (P1-06) | Anh (+ Dương) | P1-15 — 17/11 |
| `students.yaml` | GET/POST, PATCH /:id | GET /:id (P1-09) | Hà | P1-09 — 18/11 |
| `teachers.yaml`, `courses.yaml` | GET/POST | "CRUD" (P1-10, P1-11) | Dương | 17/11 |
| `users.yaml` | — | Admin tạo tài khoản teacher/student (D-28) | Dương | P1-25 — 19/11 |
| `classrooms.yaml` | GET/POST classrooms; POST `/classrooms/:id/sessions`; POST `/classrooms/:id/enrollments` (Idempotency-Key) | 409 sức chứa | Hà | P1-12 — 18/11 |
| `attendance.yaml` | PUT `/sessions/:id/attendance` (batch ≤ 200) | Endpoint đọc cho P2-11/P2-12 | Hà | P2-01 — 20/11 |
| `grades.yaml` | POST `/classrooms/:id/assessments`; PUT `/assessments/:id/grades` (version → 409) | Endpoint đọc | Hà | P2-02 — 20/11 |
| `tuition.yaml` | GET `/invoices`; POST `/invoices/:id/payments` (Idempotency-Key bắt buộc) | — | Hà | P2-03 — 21/11 |
| `materials.yaml` | POST/GET `/classrooms/:id/materials`; GET `/materials/:id`; GET `/materials/:id/download-url`; POST `/materials/:id/retry` | `?variant=preview`; xóa học liệu (P2-06) | Dương | P2-05 — 20/11 |
| `internal.yaml` | POST `/internal/material-events` | Header `X-Event-ID`, `X-Timestamp`, `X-Key-ID`, `X-Signature`; scheme HMAC, không cookie, không CSRF | Anh + Dương | P2-07 — 21/11 |
| `dashboard.yaml` | GET `/dashboard/summary` | Response theo vai trò (§3.7) | Đức | P2-04 — 22/11 |
| `health.yaml` | — | — | Anh | v0 |

**Khoảng trống:** V2 §14 thiếu một số endpoint mà task P0 cần (đọc điểm/điểm danh/lịch cho Student và Teacher, GET chi tiết, PATCH teacher/course, tạo tài khoản, xóa học liệu). Đức **không tự thiết kế field/rule**: owner module đề xuất path theo quy trình §4.1, Đức duyệt trước ngày task phụ thuộc bắt đầu (C-17).

**HTTP status & error code**

| HTTP | Khi nào | `code` |
|---|---|---|
| 400 | Validation DTO | Kèm `fieldErrors` |
| 401 | Thiếu/hết hạn session; login sai; HMAC sai (route internal) | — |
| 403 | Sai vai trò/tenant/ownership; CSRF sai; chưa đổi mật khẩu tạm (D-28) | — |
| 404 | Không tồn tại hoặc che giấu tài nguyên tenant khác (ST01 chấp nhận 403/404 — thống nhất với Anh) | — |
| 409 | Vượt sức chứa; xung đột version; reuse Idempotency-Key với body khác; `event_id` trùng khác payload | `ENROLLMENT_CAPACITY_EXCEEDED` (có sẵn §7.3) |
| 429 / 503 | Rate limit / quá tải, kèm `Retry-After` | — |
| — | Học liệu chưa READY | `MATERIAL_NOT_READY` (có sẵn §7.3) |

Chỉ hai code trên đã có trong ROADMAP; code khác do owner module đề xuất trong PR path của mình và Đức duyệt để tránh trùng nghĩa.

**Phát hiện contract drift trong CI**

1. Lint + bundle spec (job OpenAPI của P1-18 — Giang).
2. Sinh lại client → `git diff --exit-code` trên `generated/`.
3. Helper validate response theo spec, xuất từ `packages/api-contract`, được integration test của các module gọi (response lệch contract → test fail).
4. Đề xuất (cần Anh đồng ý): so route inventory của P1-03 với danh sách path trong contract.

**Các bước:** (1) 16/11 sáng: path auth/me + components hoàn chỉnh → PR riêng merge sớm cho Doanh; (2) 16/11: khung toàn bộ path theo bảng trên, field lấy từ schema v1 bản nháp; (3) sau freeze 20:00: đối chiếu tên field với `schema.prisma`; (4) 17/11: helper response validation + kiểm tra drift; (5) thông báo nhóm path nào đã ổn định, path nào chờ owner đề xuất.

**AC:** spec lint pass · CI fail khi code lệch contract (mục 2–3) · generated client cập nhật · Doanh approve.

### 3.6. P1-07 — Audit Log Service

| Mục | Nội dung |
|---|---|
| Dependency theo §5 | P1-03 |
| Dependency thực tế (C-13) | Bảng `audit_logs` trong schema v1 (P1-08, freeze 16/11 20:00) · quyền INSERT/SELECT cho `edu_runtime` (P1-23) · `TenantTx` (P1-04, 17–18/11) · TenantContext + request-id (P1-03, P0-07) |
| Bị chờ bởi | P1-06 (Giang, 18/11) · P1-12, P1-13 (Hà) · P2-03 · P2-19 (Anh) |
| Reviewer | Anh |
| Allowed files | `apps/api/src/common/audit/**` (gồm unit test) · 1 file integration test riêng trong `apps/api/test/` (không dùng thư mục `apps/api/test/audit/` của P2-19) · 1 dòng import trong `app.module.ts` |

**Việc phải làm trước freeze 16/11 20:00:** review PR P1-08 cùng Anh, xác nhận `audit_logs` có đủ: `tenant_id`, `actor_id`, `action`, loại + ID tài nguyên, `request_id`, thời điểm. V2 §9.1 chỉ ghi "actor_id, tenant_id, action, resource, timestamp"; `request_id` được yêu cầu ở V2 §11.8 và P1-07 (C-14). Trường hợp login sai khi chưa xác định được tenant/actor: cột nào nullable → chốt với Hà + Anh.

**Interface đề xuất (mô tả, không phải code)**

| Thành phần | Hành vi |
|---|---|
| `record(tx, event)` | Ghi audit **trong cùng TenantTx** với thay đổi nghiệp vụ → commit/rollback cùng nhau. `tenantId`, `actorId`, `requestId` lấy từ context, caller không truyền |
| `recordStandalone(event)` | Cho sự kiện không có transaction nghiệp vụ (truy cập bị từ chối, login thất bại) |
| `event` | `action` (enum) · `resourceType` · `resourceId` · `metadata` chỉ gồm giá trị nguyên thủy trong allowlist |
| Enum action ban đầu | Theo V2 §11.8 + AC các task: đăng nhập thất bại, tạo/đổi quyền tài khoản, đổi lịch (P1-12), ghi danh (P1-13), sửa điểm danh, đổi điểm, ghi nhận khoản thu, xóa học liệu, truy cập bị từ chối. Tên hằng do Đức đề xuất trong PR; thêm action mới = PR nhỏ vào `common/audit`, Đức duyệt |
| Ngoài phạm vi | Xoay secret, đổi cấu hình production (sự kiện vận hành — ghi ở evidence/runbook liên quan) |
| Khi ghi audit lỗi | Đề xuất fail-closed cho sự kiện nghiệp vụ nhạy cảm (rollback); truy cập bị từ chối vẫn trả 403 — chốt với Anh |

**Các bước:** (1) unit test trước: thiếu context → lỗi; metadata chứa khóa kiểu password/token/secret/URL ký → bị từ chối; (2) code service, không có hàm update/delete; (3) integration test chạy bằng `edu_runtime`; (4) đăng ký module; (5) PR có ví dụ sử dụng cho owner module.

**Test bắt buộc**

| Test | Kỳ vọng |
|---|---|
| INSERT bằng `edu_runtime` | Thành công |
| UPDATE / DELETE `audit_logs` bằng `edu_runtime` | DB từ chối (AC gốc) |
| Rollback transaction nghiệp vụ | Không còn bản ghi audit tương ứng |
| Metadata nhạy cảm | Bị chặn, không ghi |
| Lint | Không import `PrismaClient` ngoài `common/prisma` |

**AC:** append-only; đủ actor, tenant, action, resource, timestamp, requestId; không ghi PII đầy đủ, password, token, secret.

**Bàn giao (lời gọi audit thuộc AC của từng module — P2-19 chỉ kiểm tra coverage)**

| Owner | Task | Sự kiện |
|---|---|---|
| Giang | P1-06 | Đăng nhập thất bại |
| Anh | P1-03 (PR bổ sung sau khi P1-07 merge) | Truy cập bị từ chối |
| Hà | P1-12, P1-13, P2-01, P2-02, P2-03 | Đổi lịch, ghi danh, sửa điểm danh, đổi điểm, khoản thu |
| Dương | P1-25, P2-06 | Tạo/đổi quyền tài khoản, xóa học liệu |
| Anh | P2-19 | Coverage test; thiếu → issue cho owner |

Nếu P1-04 chưa merge ngày 17/11: mở PR P1-07 theo interface TenantTx đã công bố, merge ngay sau P1-04 (sáng 18/11) và báo Giang để P1-06 không bị chặn.

### 3.7. P2-04 — Backend Dashboard Summary

| Mục | Nội dung |
|---|---|
| Dependency | P2-01, P2-02, P2-03 · dataset 10k từ P1-20 (không có trong cột Dep, cần để đo — C-15) · path `dashboard.yaml` (P1-14) |
| Reviewer | Hà |
| Allowed files | `apps/api/src/dashboard/**` · integration test trong `apps/api/test/` · 1 dòng `app.module.ts` · `packages/api-contract/paths/dashboard.yaml` |
| Không sửa | Migration/index → change request cho Hà (label `migration`) |

**Phạm vi theo ma trận quyền V2 §6.2**

| Vai trò | Thẻ số liệu (đề xuất, chốt trong contract) | Phạm vi | Không được trả |
|---|---|---|---|
| Admin | Học viên, lớp, tỷ lệ điểm danh, công nợ | Toàn tenant | Số liệu tenant khác |
| Teacher | Học viên và lớp được giao, tỷ lệ điểm danh các lớp đó | Lớp được phân công | **Công nợ/học phí** (Teacher không có quyền học phí) |
| Student | Lớp đã ghi danh, tỷ lệ điểm danh, công nợ của bản thân | Cá nhân | Số liệu người khác |

Định nghĩa "tỷ lệ điểm danh" (khoảng thời gian, trạng thái nào tính có mặt) và "công nợ" (công thức từ `amount_vnd`, `paid_vnd`, `status`) **chưa có trong tài liệu** → chốt với Hà, ghi vào description của contract (C-25).

**Các bước**

1. Contract: một endpoint `GET /dashboard/summary`, response phân biệt theo vai trò.
2. Policy: khai báo `@Policy` cho cả 3 vai trò; phạm vi lấy từ session (route inventory P1-03).
3. Service: một TenantTx mỗi request; chỉ dùng truy vấn aggregate (count/sum/groupBy), không lặp từng dòng; nếu cần raw SQL chỉ dùng dạng tham số hóa; tổng tiền trả về string.
4. EXPLAIN ANALYZE từng truy vấn trên dataset 10k; seq scan trên bảng lớn → gửi change request index cho Hà (liên quan P2-20).
5. Đo p95 trên môi trường ghi rõ (local hoặc demo, kèm SHA và cấu hình); mục tiêu < 500 ms. Chưa đo → không ghi đạt. Không thêm cache trước khi xác định nút thắt (V2 §8.6, §15.6).

**Test:** authz theo vai trò bằng harness P1-19 (admin, teacher được giao/không được giao, student A/B, 2 tenant) · số liệu đúng với seed cố định · dữ liệu tenant B không làm đổi kết quả tenant A · response Teacher không có trường học phí · response khớp contract.

**AC:** p95 < 500 ms trên dataset 10k (có số đo) · authz theo vai trò · EXPLAIN evidence · không lộ số liệu tenant khác.

**Bàn giao:** endpoint cho P2-14 · ghi chú cho Giang (k6: 10% workload là dashboard/kết quả) · danh sách index đã yêu cầu Hà.

### 3.8. P2-14 — Frontend Admin Tuition + Dashboard

| Mục | Nội dung |
|---|---|
| Dependency | P2-03 (Tuition API của Hà) · P2-04 |
| Reviewer | Doanh |
| Allowed files | `apps/web/src/features/tuition/**`, `apps/web/src/features/dashboard/**` (gồm Vitest) |
| Cần thỏa thuận (C-16) | Đăng ký route/menu nằm ngoài thư mục feature → Doanh thêm hoặc cho phép 1 dòng · Playwright spec đặt ở `tests/e2e/` → thống nhất với Giang/Doanh (P2-17) |

**Các bước**

1. Dùng layout, component, query key factory (tenant + user scope) và generated client từ skeleton của Doanh; không tạo pattern riêng.
2. Danh sách invoice: phân trang, trạng thái loading/empty/error/success.
3. Form ghi nhận thanh toán (RHF + schema): số tiền là chuỗi chữ số; kiểm tra phía client chỉ để hỗ trợ UX, server là nguồn quyết định.
4. **Idempotency-Key:** sinh một lần cho mỗi lần người dùng gửi, dùng lại khi retry cùng lần gửi đó; khóa nút trong lúc chờ.
5. **Không optimistic update** với tiền: chỉ hiển thị "đã ghi nhận" sau khi API trả thành công; sau đó invalidate query invoice + dashboard.
6. Hiển thị lỗi theo `code` (409, 403, 429…) bằng tiếng Việt.
7. Dashboard: thẻ số liệu đơn giản, **không thêm thư viện chart**.
8. Định dạng VND từ string mà không đổi sang `Number` (ví dụ `BigInt` + `Intl.NumberFormat('vi-VN')`).

**Test:** Vitest (format tiền, trạng thái form, không optimistic, hiển thị lỗi) · Playwright admin tuition: đăng nhập admin → mở invoice → ghi nhận thanh toán → trạng thái/`paid` cập nhật; bấm hai lần chỉ tạo một payment.

**AC:** không optimistic với tiền · đủ 4 trạng thái UI · tiền đúng contract · Vitest + Playwright có log thật.

---

## 4. Integration, Contract & Team Handoff

### 4.1. Quy trình contract-first

| Bước | Ai | Việc | Đầu ra |
|---|---|---|---|
| 1 | Owner module | Mở PR chỉ sửa `paths/<module>.yaml` (label `contract`) | PR contract |
| 2 | Đức | Kiểm tra quy ước, trùng lặp, nhất quán với schema + Decision Log; không tự thêm field/rule | Approve / yêu cầu sửa |
| 3 | Đức + owner | PR contract merge **trước** PR backend/frontend phụ thuộc (ROADMAP §7.4) | Contract trên `main` |
| 4 | FE + BE | Rebase lên `main` | Code theo contract mới |
| 5 | Script | Sinh lại generated client trong cùng PR contract | Client cập nhật |
| 6 | CI | Lint/bundle + drift check + response validation | Hai phía tương thích |

**Ownership**

| Thành phần | Owner | Ai được sửa | Ai duyệt |
|---|---|---|---|
| `openapi.yaml` gốc + `components/` | Đức | Đức | Doanh |
| `paths/<module>.yaml` | Owner module | Owner module, Đức | Đức |
| `generated/` | Script | Chỉ qua script | Theo PR contract |
| `schema.prisma`, migrations | Hà | Hà; người khác gửi change request | Pool B (Đức) / Anh nếu liên quan authz |
| Auth, AuthZ, TenantTx | Anh | Anh | Pool A (Đức) |
| `app.module.ts` | Đức | Mỗi PR module thêm đúng 1 dòng import của mình | Đức |
| `ROADMAP.md` | Đức | Đức (người khác đề xuất qua PR/standup) | Theo PR |
| `docs/handoff/<TÊN>.md` | Từng thành viên | Chủ file | Đức xem khi có thay đổi phạm vi |

### 4.2. Integration & Handoff Matrix

| Thành viên | Đức giao | Đức nhận | Đức review | Người đó review Đức | Đồng bộ chính |
|---|---|---|---|---|---|
| **Doanh** (TV2) | Contract v0 (14/11), v1 (17/11), generated client; API P2-04 | Layout, component, query key factory (P0-10, 15/11); page object E2E (P2-17); số liệu CP1 (P1-21, 19/11) | P0-10, P0-20, P1-16, P1-17, P2-11, P2-12, P2-17, P3-08, P3-09, P6-03, P6-04 | P0-09, P1-14, P2-14 | IP-2, IP-3, IP-4; slide P6-05 |
| **Anh** (TV3) | Contract auth/me/internal; interface audit (P1-07) | Error filter + request-id (P0-07); TenantContext/TenantTx (P1-03/P1-04); đặc tả CSRF (P1-02) | P0-07, P1-01, P1-03, P1-05, P2-19; pool A: P0-16, P0-17, P1-02, P1-04, P2-07 | P0-05, P1-07 | G0, G1; D-03, D-05, D-24; P3-06; hotfix P5-05; slide P6-05 |
| **Hà** (TV4) | Conventions contract; yêu cầu index cho dashboard; review pool B | Schema v0/v1 (P0-08, P1-08); Tuition API (P2-03); định nghĩa số liệu dashboard; EXPLAIN baseline (P2-20) | P1-08, P1-12, P2-03, migrations (pool B), P4-03, P4-04 | P2-04 | D-04, D-12, D-27; IP-3; ghép Word cần chương của Đức |
| **Dương** (TV5) | Duyệt path materials/internal/users | Kết quả P0-18, P2-09; script reset demo (P5-06) | P0-18, P2-09 | — | IP-1 (theo dõi), IP-4; D-32; video P6-04; ghép Word |
| **Giang** (TV6) | Repo + branch protection; script lint contract; tag `rc0`, `rc0.1` | CI (P0-06, P1-18), deploy demo (P0-12), seed bench (P1-20), E2E/k6 (P2-17/18), kết quả W1/W2, chi phí thực tế (P4-11) | P0-02, P0-12, P0-11 & P2-15 phần `infra/azure` (pool B), P2-17, P4-01, P4-03, P4-11, P5-01, P6-09 | P0-04, P3-10, P6-07 | IP-1, IP-5; D-02, D-30; G6; P6-08; ghép Word |

### 4.3. Integration Points

| IP | Deadline | Thực hiện | Dependency | Đầu ra cần nhận | Cách kiểm thử | Bằng chứng | Blocker cần xử lý | Vai trò Đức |
|---|---|---|---|---|---|---|---|---|
| **IP-1** Azure `/health` + OSS + FC + callback | 15/11 tối | Dương + Giang | P0-12, P0-15, P0-16, P0-17, P0-21 → P0-18 | ≥ 5 lần liên tiếp thành công; bảng latency p50/p95 3 chặng | Script lặp 5 lần, log có correlation ID | Evidence P0-18 + SHA | Tài khoản Aliyun (Risk R-02); OIDC (Risk R-04); firewall migration (Risk R-19) | Review P0-18; duyệt G0 cùng Anh. Multi-Cloud trễ không chặn Phase 1 Azure |
| **IP-2** FE login ↔ Auth/CSRF ↔ Tenant guard | 17/11 tối | Doanh + Anh | P1-01, P1-02, P1-14 (auth), P1-15, P1-23 | Login có `tenantSlug` → cookie → `/me`; logout có CSRF; xử lý 401/403 | Playwright login; integration ST05, ST06, ST07 | CI run + Playwright report | Tên header CSRF; contract auth chưa merge | Merge contract auth trước 17/11; review P1-01, P1-03 |
| **IP-3** Students → Classes → Enrollment | 19/11 | **Đức chủ trì** | P1-09, P1-12, P1-13 (Hà); P1-10, P1-11 (Dương); P1-15–P1-17 (Doanh); P1-01–P1-04 (Anh); P0-12 (Giang) | Trên demo: tạo học viên → lớp + buổi học → ghi danh → invoice tự tạo; vượt sức chứa → 409; tenant khác bị từ chối | Chạy luồng Admin trên demo; Playwright admin flow (P1-17); concurrency test P1-13 trong CI | Playwright report/ảnh + SHA, ghi vào kết quả G1 | P1-12 chưa merge 19/11 12:00 → kích hoạt §10.3 (Dương nhận phần class_sessions) | Chủ trì, tổng hợp blocker cho G1 |
| **IP-4** Teacher upload → FC → READY → Student download | 22/11 | Dương + Doanh | P2-05, P2-06, P2-07 (Anh), P2-08, P2-13 | Upload → READY → student tải được; student khác lớp bị từ chối | E2E + ST17, ST18 | Trace correlation ID 1 material | Callback/reconciliation; CSP OSS (P1-24) | Review P2-09; duyệt contract materials/internal |
| **IP-5** Toàn bộ P0 E2E + k6 smoke | 23/11 | Giang | P2-17, P2-18, P1-20, mọi task P2 | E2E P0 xanh 3 lần trên demo; k6 smoke trên dataset 10k | Playwright + k6 | Report + SHA | Task P2 trễ; seed | Approver **G2** (20:00) |

### 4.4. Kiểm soát đồng bộ

| Quy tắc | Cách áp dụng |
|---|---|
| Một repository, `main` là nhánh tích hợp | Trunk-based; `main` luôn deploy được |
| Feature branch ngắn | `<type>/<TaskID>-<slug>`; 1 task = 1 PR; ~400 dòng logic khi có thể |
| Cập nhật trước khi làm | `git fetch && git rebase origin/main` trước khi bắt đầu và trước khi mở PR |
| Contract & schema thống nhất | Contract-first (§4.1); schema đóng băng 16/11 20:00; chỉ 1 PR migration mở tại một thời điểm |
| CI + human review trước merge | Required checks + CODEOWNERS; không bypass |
| Tích hợp sớm | IP-1…IP-5 theo lịch; deploy demo sau mỗi merge quan trọng |
| AI không tự tạo kiến trúc riêng | Prompt §1.4 bắt buộc đọc ROADMAP + handoff; review §5.2 bắt file lạ, dependency mới, pattern trùng |
| Cập nhật tiến độ | Đề xuất (C-21): trạng thái chi tiết nằm trên PR; Đức cập nhật tiến độ tổng trong ROADMAP sau standup 21:00 và tại mỗi gate (một người ghi để tránh xung đột file) |

### 4.5. Xử lý blocker

1. Ghi blocker trong PR/standup: task bị chặn, task chặn, owner, thời điểm cần.
2. Đức liên hệ owner trực tiếp, giúp gỡ (làm rõ contract, ưu tiên review, đổi thứ tự task).
3. Trễ quá ngưỡng ở ROADMAP §10.3 → chuyển việc theo bảng đó, ghi vào tiến độ.
4. Chỉ áp dụng scope-cut theo §10.2 khi đạt điều kiện kích hoạt; báo cả nhóm.
5. **Không** để AI của Đức viết lại module của người khác. Đức chỉ nhận thêm việc khi bảng §10.3 chỉ định.

---

## 5. Technical Review, Quality Gates & Release

### 5.1. Phạm vi review và SLA

- SLA review **4 giờ** trong khung 08:00–22:00. Quá SLA → báo standup, chuyển reviewer dự phòng trong pool.
- Pool B: Đức chính, Anh dự phòng. Pool A: Anh chính, Đức dự phòng; khi tác giả là Anh, Đức là approver hợp lệ còn lại theo CODEOWNERS. Để giảm nghẽn, có thể thêm Giang vào CODEOWNERS pool A (phù hợp §6.1 "TV3 được review bởi TV1 + TV6") — cần trưởng nhóm xác nhận (C-26).
- PR của Đức cần reviewer độc lập: P0-04 Giang · P0-05 Anh · P0-09/P1-14/P2-14 Doanh · P1-07 Anh · P2-04 Hà · P3-10 Giang · P6-07 Giang.
- Đức không approve thay người khác, không dùng quyền admin để merge.

### 5.2. Checklist review

| # | Kiểm tra | Blocker nếu |
|---|---|---|
| 1 | Đúng Task ID, chỉ sửa Allowed files | Có file ngoài phạm vi, dependency mới không lý do |
| 2 | API/schema không đổi ngoài quy trình | Field mới không có PR contract; migration không qua Hà |
| 3 | Authorization & tenant isolation | Route thiếu `@Policy`; tenant/role lấy từ body; query ngoài TenantTx |
| 4 | Transaction & concurrency | Thiếu lock/version/unique; gọi mạng/Aliyun trong transaction |
| 5 | Không bypass security | Cờ bypass auth/rate limit/CSRF; tắt TLS; bucket public |
| 6 | Không credential/PII | Secret trong code/log; log token, URL ký, password, PII |
| 7 | Test chạy thật, đủ AC | Không có test negative; test negative không fail khi bỏ guard; kết quả trong PR không khớp CI |
| 8 | Không làm hỏng phần đã tích hợp | CI đỏ; E2E đã xanh nay đỏ |
| 9 | Tiền & thời gian | Tiền dạng number; optimistic với thanh toán; thời gian không UTC |
| 10 | Bàn giao | Thiếu mục "Kết quả & bàn giao" |

Bổ sung theo pool B: **Tuition** — Idempotency-Key bắt buộc, khóa invoice, không âm/không vượt số phải thu, audit (P2-03, ST23). **Migration** — backward-compatible, không mất dữ liệu, quyền `edu_runtime` cho bảng mới (D-25), 1 PR migration tại một thời điểm. **`infra/azure`** — không mở firewall "all Azure services", secret qua Key Vault reference, pool ≤ 80% `max_connections`.

### 5.3. Quản lý quyết định kỹ thuật

- Trạng thái: Proposed → Accepted (nhóm đồng ý) → Verified (có bằng chứng). **Accepted ≠ Verified**; Proposed không tự chuyển thành Accepted.
- Thay đổi kiến trúc, bảo mật, IAM, chi phí, phạm vi: theo RACI ROADMAP §6.3; ghi Decision Log trong `ROADMAP.md`; không tạo file ADR riêng.

| Decision | Nội dung (tóm tắt) | Đức | Hạn | Việc cụ thể của Đức |
|---|---|---|---|---|
| D-02 | 1 môi trường demo | Đồng quyết (Giang) | 14/11 | Chốt ở kick-off |
| D-03 | SPA cùng origin | Đồng quyết (Anh) | 14/11 | Contract cookie/CSRF theo same-origin |
| D-04 | `class_sessions` | Đồng quyết (Hà) | 14/11 | Contract giữ path `/sessions/:id/attendance` |
| D-05 | Phạm vi RLS | Đồng quyết (Anh) | 19/11 | Xem báo cáo P1-05, quyết trước G1 |
| D-12 | Tiền BIGINT/string | Đồng quyết (Hà) | 14/11 | Áp vào contract v0 |
| D-14 | Ngưỡng ≥ 93 | Quyết | 14/11 | Chốt ở kick-off |
| D-20 | pnpm workspace, phiên bản | Quyết | 15/11 | Ghi phiên bản thực tế sau P0-04 |
| D-22 | P1 ngoài phạm vi | Quyết | 14/11 | Từ chối PR tính năng P1 |
| D-23 | Repo public / phương án B | Cả nhóm | 14/11 09:00 | Điều kiện của P0-04 |
| D-24 | Login có `tenantSlug` | Đồng quyết (Anh) | 14/11 | Contract v0 |
| D-27 | Schema freeze 16/11 20:00 | Đồng quyết (Hà) | 16/11 | Review P1-08, chặn sửa schema ngoài quy trình |
| D-30 | Bench build `rc0.1`/`rc0.2` | Đồng quyết (Giang) | 22/11 | P3-10, kiểm soát `rc0.2` |
| D-32 | Advisory lock reconciliation | Đồng quyết (Dương) | 20/11 | Review P2-09 |
| D-34 (đề xuất) | Mô hình tài liệu tối giản | Ghi theo trưởng nhóm | 15/11 | P0-05 |

### 5.4. Quality Gates

| Gate | Thời điểm | Vai trò Đức | Đức tự kiểm tra trước khi ký |
|---|---|---|---|
| **G0** | 16/11 12:00 | Approver cùng Anh | Đăng ký (P0-01) · `/health` + DB TLS bằng `edu_runtime` · migration job xóa firewall tạm · OSS private + versioning · FC xử lý PDF thật + REJECT file giả · callback HMAC đúng/sai · CI có gitleaks · tính năng GitHub theo D-23 (P0-04) · latency 3 chặng |
| **G1** | 19/11 20:00 | Approver cùng Anh + Giang | Schema v1 đã đóng băng · Auth/CSRF/guard chain + TenantTx merged · integration test chạy bằng `edu_runtime` · route inventory pass · ST01–ST07, ST10 pass cho module hiện có · 2 tenant không truy cập chéo · concurrency enrollment pass · CI security gates bắt buộc · **D-05 đã quyết** · **CP1 có số** · velocity đo được (< 80% → scope-cut cấp 2 ngay) |
| **G2** | 23/11 20:00 | **Approver duy nhất** | Mọi luồng P0 E2E xanh 3 lần trên demo · callback idempotent (kể cả nhiều version cùng attempt) + reconciliation · audit coverage (P2-19) pass · ST08–ST19, ST22–ST25 có script · k6 smoke OK · EXPLAIN baseline · **CP2 có số + danh sách nút thắt** · không đạt → scope-cut cấp 2–3 |
| **G3** | 25/11 20:00 | Xác nhận sau Anh + Giang | ST01–ST20, ST22–ST25 Pass; ST21 = production-only · không Critical/High exploitable · IDOR sweep 100% route · ZAP triaged · biên bản P3-06 |
| **G4** | 26/11 20:00 | Reviewer task (approver: Giang + Hà) | LT01–LT12 Pass/Fail/Not run có lý do, gắn SHA · không vi phạm bất biến · RPO/RTO đo được · rollback drill xong · session/tenant `bench-*` = 0 · đã scale-down |
| **G5** | 27/11 12:00 | Chủ trì P5-04 | §5.8 |
| **G6** | 29/11 22:00 | Approver cùng Giang | §6.4 |

Kết quả gate: ghi vào tiến độ trong ROADMAP kèm link evidence (C-21). Không ghi Pass cho mục chưa có bằng chứng.

### 5.5. P3-01 — Feature Freeze (24/11 00:00)

| Mục | Nội dung |
|---|---|
| Dependency | G2 |
| Allowed files | `CHANGELOG.md` (tạo lúc này), tag `rc0` |
| Reviewer | Cả nhóm |

1. Trước 23/11: cùng Giang chuẩn bị cơ chế chặn PR không có label cho phép. GitHub branch protection **không lọc theo label** → đề xuất một required status check kiểm tra label (file workflow thuộc pool C, Giang thực hiện) — C-08.
2. 24/11 00:00: tag `rc0` trên commit `main` đã qua G2; ghi SHA.
3. Sinh `CHANGELOG.md` từ tiêu đề PR (Conventional Commits có Task ID).
4. Thông báo: từ thời điểm này chỉ nhận `fix`, `test`, `docs`, `security` (§7.4; P3-01 chỉ ghi 3 label đầu — C-08). Tính năng P1 chưa bắt đầu bị khóa (D-22).

**AC:** tag `rc0` tồn tại · changelog · PR không đúng label bị chặn.

### 5.6. P3-10 — Bench Build `rc0.1` và Phase 4 Review

**P3-10 (25/11 12:00, reviewer Giang)**

1. Xác nhận mọi issue Critical/High từ P3-02…P3-06 đã đóng có test hồi quy (P3-07).
2. Tag `rc0.1`; Giang deploy **đúng artifact** đã build cho SHA đó (build-once); smoke sau deploy.
3. Ghi SHA, artifact, thời điểm deploy, cấu hình vào `docs/evidence/perf/build.md` (tạo lúc này).
4. Sau mốc: chỉ nhận fix hiệu năng vào `rc0.2` hoặc fix Critical.

**AC:** mọi số liệu W1 gắn SHA `rc0.1`.

**Review Phase 4**

| Task | Đức kiểm tra | Không được |
|---|---|---|
| P4-01 (13:30) | SKU, số instance, `connection_limit`, tổng pool ≤ 80% `max_connections`, chi phí ước tính, dataset `bench-*` | Duyệt khi chưa có cấu hình ghi lại |
| P4-03 (W1) | Pass/Fail theo V2 §15.5; 429/5xx **không** bị loại khỏi thống kê; SQL bất biến sau mỗi run; nguồn tải + `dropped_iterations` | Đổi SLO thành "kết quả"; tự chạy thay Giang |
| P4-04 | Số đo trước/sau mỗi fix; `rc0.2` chỉ chứa fix hiệu năng; không có cờ bypass/tắt kiểm tra bảo mật | Bỏ qua security gate để đạt số |
| `rc0.2` (trước 26/11 08:30) | Xác nhận nội dung; người tag chưa được chỉ định trong ROADMAP (C-19) | — |
| P4-11 | Rollback < 15 phút; session/tenant `bench-*` = 0; đã scale-down; chi phí thực tế | — |

### 5.7. P5-03 — Technical Delivery Package (26–27/11)

| Mục | Nội dung |
|---|---|
| Dependency | P5-01 |
| Reviewer | Owner các phần liên quan |
| Allowed files | `README.md`, file trong `docs/` thực sự cần cho release |

| Hạng mục | Đức làm | Nguồn từ owner |
|---|---|---|
| README | Dựng local từ đầu, cấu trúc repo, link tài liệu | P0-19 (Hà) |
| Deployment runbook | Viết ngắn, dựa trên pipeline thật | P0-12 (Giang) |
| Incident runbook | Lộ credential, callback lỗi | P0-21 (Dương), P3-05 (Anh) |
| OpenAPI export | Bundle từ `packages/api-contract` tại SHA RC1 | — |
| ERD | Sinh từ schema v1 | Hà |
| Decision Log | Cập nhật Accepted/Verified đúng bằng chứng | Cả nhóm |

Runbook do owner khác viết trong task của họ (hmac-rotation, restore, rollback, demo-reset, teardown) chỉ được liên kết, không viết lại.
**AC:** một thành viên khác dựng được local theo README (ghi tên người thử + kết quả).

### 5.8. P5-04 — Go/No-Go (27/11 12:00)

| Hard gate | Kiểm chứng | Vi phạm → |
|---|---|---|
| HG1 Không rò tenant | ST02, ST20, ST24, IDOR sweep P3-03 | **NO-GO** |
| HG2 Không lỗi authorization nghiêm trọng | ST01, ST03, ST04, ST17, route inventory | **NO-GO** |
| HG3 Không lộ secret | ST22, gitleaks full history, ST25 | **NO-GO** |
| HG4 Không Critical/High exploitable | P3-04, P3-05 | **NO-GO** |
| HG5 Không sai/mất giao dịch | ST23, LT08, LT10, SQL bất biến | **NO-GO** |
| HG6 Không giả mạo kết quả | Evidence có SHA + ngày + môi trường | **NO-GO** |

- **Được công bố như hạn chế (không chặn release):** LT Fail hoặc Not run vì ngân sách, CWV chỉ đo lab (D-33), RLS phạm vi hẹp theo D-05, không malware scan (D-11), ST21 production-only — với điều kiện báo cáo trung thực (G4).
- **Luôn chặn:** vi phạm HG1–HG6, kể cả khi số liệu hiệu năng đạt.
- Các bước: tổng hợp evidence G3/G4 + regression P5-02 → họp cả nhóm → biên bản `docs/release/RC1-decision.md` (tạo lúc này) có tên 6 người. Đức không tự quyết GO khi còn vi phạm.
- NO-GO: hotfix + regression, hạn 28/11 12:00; video chỉ quay trên bản đã GO.

### 5.9. Phase 5–6 — Kiểm soát release

| Việc | Đức làm |
|---|---|
| RC1 (P5-01, P5-02) | Review deploy RC1 + dữ liệu demo giả; xem kết quả regression |
| Đóng băng demo (P5-05) | Mọi hotfix cần 2 approval: Đức + Anh, cơ chế theo D-23 |
| Luồng hotfix | Issue → `fix/<TaskID>-…` → PR label `fix`/`security` → CI → 2 approval → deploy qua workflow → smoke + E2E → ghi vào PR |
| 28–30/11 | Không deploy ngoài hotfix; P6-08 chỉ kiểm tra + reset demo (script P5-06 của Dương) |

---

## 6. BTL Deliverables & Final Checklist

### 6.1. Chương báo cáo Đức viết (ROADMAP §11.1)

| Chương | Nội dung | Nguồn dữ liệu | Nháp | Bản cuối | Trang |
|---|---|---|---|---|---|
| **Ch1 (R-01)** | Bối cảnh, khách hàng, mô hình kinh doanh, lý do chọn ứng dụng và tổ hợp 9 | V2 §1–§2 (giá gói là **giả thuyết**, ghi rõ); đề BTL (tổ hợp tô vàng +1 điểm) | 19/11 | 27/11 | 4 |
| **Ch2 (R-02)** | Vai trò 6 thành viên, owner/reviewer, đóng góp thực tế | ROADMAP §15; lịch sử PR/review trên GitHub — **chỉ ghi đóng góp có bằng chứng** | 20/11 | 28/11 | 2 |
| **Ch6 (R-07)** | Kiến trúc, dữ liệu, luồng cross-cloud | ERD (P5-03), trace thật IP-1/IP-4; Hình 1–4: kiến trúc, sequence, ERD rút gọn, state machine (mỗi hình ≤ nửa trang) | 22/11 | 27/11 | 5 |
| **Ch10 (R-11)** | Hạn chế, chi phí, hướng phát triển, kết luận | Chi phí thực tế (P4-11); hạn chế D-02, D-05, D-11, D-22, D-33, ST21, LT Fail/Not run | 27/11 | 28/11 | 2 |

Hà, Giang, Dương ghép bản Word (§15) → chương của Đức phải đúng hạn bản cuối. Không đưa số liệu benchmark hoặc đóng góp chưa có evidence vào báo cáo.

### 6.2. Slide, video, báo cáo — phân công áp dụng (§15)

| Sản phẩm | Người chủ trì | Vai trò Đức | Task |
|---|---|---|---|
| Slide 15–18 trang (≤ 20) | Anh, Doanh, Đức | Đồng tác giả; chia phần trong 3 người cần chốt (đề xuất theo chương mỗi người viết) | P6-05 |
| Báo cáo Word ghép cuối | Hà, Giang, Dương | Cung cấp chương; nghiệm thu bản ghép; **không** ghép thay | P6-01 |
| Kiểm tra chéo báo cáo | Cả 6 | Đọc toàn bộ; xác nhận cuối | P6-06 |
| Video ≤ 5:00 | Doanh + Dương quay/dựng | **Review/duyệt cuối** | P6-03, P6-04 |

**Checklist duyệt video (P6-04):** ≤ 5:00 · đúng storyboard ROADMAP §11.3 · quay trên RC1 đã GO · không lộ secret, URL ký, PII, mật khẩu admin demo · số liệu khớp evidence · kết quả Fail/Not run được nói rõ.

### 6.3. P6-06, P6-07, P6-08

| Task | Thời điểm | Các bước | AC |
|---|---|---|---|
| **P6-06** | 29/11 sáng | Đối chiếu định dạng: Word 20–50 trang (mục tiêu 35–40), Times New Roman 12, ≤ 15 hình, mỗi hình ≤ nửa trang; video ≤ 5:00; slide ≤ 20. Đối chiếu nội dung bắt buộc mục II đề BTL: vai trò SV, dịch vụ Cloud, mô hình hoạt động, ưu/khuyết điểm, bối cảnh và lý do, xây dựng demo | Checklist ROADMAP §11.5 tick đủ |
| **P6-07** | 29/11, trước 22:00 | Upload Word + video + slide lên Drive/OneDrive · tạo link public · thử cửa sổ ẩn danh và máy khác · dán link vào file Excel của thầy · chụp ảnh | Link mở không cần đăng nhập; ảnh đã dán (reviewer Giang) → **G6** |
| **P6-08** | 30/11 | Cùng Giang: kiểm tra link, demo env còn chạy, chạy reset demo nếu dữ liệu bị đổi; **không deploy** | Ảnh xác nhận |

Deadline nội bộ: **29/11/2026 22:00**. Hạn nộp: **30/11/2026** (chỉ dùng làm buffer).

### 6.4. Final checklist của Đức

- [ ] P0-01 đã xác nhận đăng ký tổ hợp 9.
- [ ] Contract OpenAPI export tại SHA RC1 khớp code (CI drift xanh).
- [ ] Decision Log cập nhật Accepted/Verified đúng bằng chứng.
- [ ] Biên bản Go/No-Go có tên 6 người; không vi phạm HG1–HG6.
- [ ] Demo env đóng băng; hotfix (nếu có) đủ 2 approval.
- [ ] Ch1, Ch2, Ch6, Ch10 đã bàn giao đúng hạn; Hình 1–4 ≤ nửa trang.
- [ ] Slide khớp số liệu báo cáo; video đã duyệt theo checklist §6.2.
- [ ] P6-06 tick đủ; P6-07 link public thử ẩn danh, đã dán Excel trước 29/11 22:00.
- [ ] P6-08 kiểm tra 30/11 có ảnh xác nhận.

---

## 7. Traceability, Blockers & Self-Audit

### 7.1. Traceability Matrix

| Nguồn ROADMAP | Trách nhiệm TV1 | Loại | Mục DUC.md | Trạng thái |
|---|---|---|---|---|
| §2.1.4 | Đăng ký, GitHub org/repo, link Drive | Owner | 3.1, 3.2, 6.3 | Chưa bắt đầu |
| §2.3 | D-02…D-32 liên quan TV1 | Quyết định | 5.3 | Chờ kick-off |
| §3.3 | IP-3 chủ trì; IP-1, IP-2, IP-4, IP-5 theo dõi | Điều phối | 4.3 | Chưa bắt đầu |
| §5.1 | P0-01, P0-04, P0-05, P0-09 (owner); P0-02, P0-07, P0-10, P0-12, P0-18, P0-20 (review) | Owner/Review | 3.1–3.4, 2.2 | Chưa bắt đầu |
| §5.2 | P1-07, P1-14 (owner); P1-01, P1-03, P1-05, P1-08, P1-12, P1-16, P1-17 (review) | Owner/Review | 3.5, 3.6, 2.2 | Chưa bắt đầu |
| §5.3 | P2-04, P2-14 (owner); P2-03, P2-09, P2-11, P2-12, P2-17, P2-19 (review) | Owner/Review | 3.7, 3.8, 2.2 | Chưa bắt đầu |
| §5.4 | P3-01, P3-10 (owner); P3-06 (co-owner); P3-07 pool B, P3-08, P3-09 (review) | Owner/Review | 5.5, 5.6 | Chưa bắt đầu |
| §5.5 | P4-01, P4-03, P4-04, P4-11 (review) | Review | 5.6 | Chưa bắt đầu |
| §5.6 | P5-03, P5-04 (owner); P5-01 (review); P5-05 (approval hotfix) | Owner/Review | 5.7–5.9 | Chưa bắt đầu |
| §5.7 | P6-07 (owner); P6-08 (co-owner); P6-02, P6-03, P6-04, P6-09 (review); P6-01, P6-05, P6-06 (điều chỉnh theo §15) | Owner/Review | 6.2, 6.3 | Chưa bắt đầu |
| §6.1 / §7.2 | Pool B chính; pool A dự phòng; contract; `app.module.ts` | Review | 2.2-D, 5.1 | — |
| §6.3 | RACI kiến trúc (R+A), Go/No-Go (R) | Quyết định | 5.3, 5.8 | — |
| §7.1, §7.2, §7.6, §7.7 | AGENTS/CLAUDE/ADR/task card/handoff | Thay bằng mô hình mới | 3.3, 1.4 | Chờ P0-05 |
| §8.1 | G0, G1, G2 approver; G3 xác nhận; G5 chủ trì; G6 approver | Gate | 5.4 | — |
| §10.1 | Risk R-01, R-07, R-12, R-17, R-18 | Risk owner | 3.1, 4.5, 6.1, 3.2, 5.1 | — |
| §10.2, §10.3 | Velocity, scope-cut, chuyển việc | Điều phối | 4.5, 5.4 | — |
| §11.1 | Ch1 (R-01), Ch2 (R-02), Ch6 (R-07), Ch10 (R-11) | Owner | 6.1 | Chưa bắt đầu |
| §12 | Lịch 14–16/11 của TV1 | Owner | 2.1 | — |
| §15 | Slide (Anh, Doanh, Đức); duyệt video; ghép Word bởi Hà/Giang/Dương | Owner/Review | 6.2 | — |

### 7.2. Mâu thuẫn và nội dung cần xác nhận

| ID | Vấn đề | Nguồn | Tác động | Xử lý trong DUC.md / cần xác nhận |
|---|---|---|---|---|
| C-01 | P0-05 yêu cầu `AGENTS.md`, `CLAUDE.md`, ADR | §5 P0-05, §4 Phase 0, §7.1–7.2, §15.1 | Trái mô hình mới; agent không tự nạp luật | Deliverable mới §3.3; prompt §1.4 bắt buộc. Trưởng nhóm xác nhận + ghi D-34 |
| C-02 | Task card `docs/tasks/`, handoff `docs/handoffs/` | §7.6, §7.7, §7.9 | Trái mô hình mới | Thay bằng ROADMAP §5 + PR template |
| C-03 | Nhiều đường dẫn `docs/evidence`, `docs/release`, `docs/runbooks`, `docs/report`, `docs/video`, `docs/slides`, `docs/adr` | §5 nhiều task | P0-04 không tạo sẵn | Tạo khi task thực sự cần. P1-05 `ADR-020.md` → Decision Log (báo Anh, Hà) |
| C-04 | P6-01 owner TV1 (§5) vs Hà, Giang, Dương (§15) | §5.7, §15.2 | Trùng phân công | Áp §15; Đức nghiệm thu |
| C-05 | P6-05 owner TV4 → reviewer TV1 (§5) vs Anh, Doanh, Đức (§15) | §5.7, §15.2 | Đức vừa làm vừa duyệt | Áp §15. **Cần chỉ định reviewer độc lập** (đề xuất Hà hoặc vòng P6-06) |
| C-06 | P6-06 owner TV3 → TV1 vs "cả 6 kiểm tra chéo" | §5.7, §15.2 | Không rõ người ký | Anh giữ checklist, cả 6 đọc, Đức xác nhận cuối — cần xác nhận |
| C-07 | §6.1: TV1 "biên tập", TV4 "slide lead", TV2 "video lead" | §6.1 | Lệch §15 | §15 được ưu tiên |
| C-08 | P3-01 chỉ ghi label `fix`/`test`/`docs`; §7.4 thêm `security`; branch protection không lọc label | §5.4, §7.4 | Freeze không thực thi được bằng Settings | Đề xuất 4 label + required check (Giang, pool C) — cần xác nhận |
| C-09 | §10.3 ghi "TV1 nhận P2-04", "TV1 nhận P2-14" khi TV4/TV2 trễ, nhưng hai task đã thuộc TV1 | §10.3, §5.3 | Phương án dự phòng không có hiệu lực | Cần phương án dự phòng thật cho P2-04/P2-14 và cho trễ của Hà/Doanh |
| C-10 | Header "bỏ gán tên thành viên", §6.1 "chưa gán người" | Header, §6.1 | Lỗi thời sau §15 | Sửa trong P0-05 |
| C-11 | Project có 2 bản ROADMAP (`ROADMAP.md`, `claude/ROADMAP.md`) | Project | Dễ sửa nhầm bản | Repo chỉ giữ một `ROADMAP.md` |
| C-12 | Tiền tố `R-` dùng cho cả chương và rủi ro | §10.1, §11.1 | Dễ nhầm | DUC.md ghi rõ; đề xuất đổi tên trong P0-05 nếu trưởng nhóm đồng ý |
| C-13 | P1-07 chỉ ghi Dep P1-03 | §5.2 | Thực tế cần P1-08, P1-23, P1-04 | Kế hoạch §3.6; P1-07 gần critical vì chặn P1-06, P2-03 |
| C-14 | V2 §9.1 `audit_logs` thiếu `request_id` | V2 §9.1, §11.8 | Không đạt AC P1-07 nếu freeze thiếu cột | Đức kiểm tra P1-08 trước 16/11 20:00 |
| C-15 | P2-04 cần dataset 10k (P1-20) và chưa nói rõ đo ở local hay demo | §5.3 | Số đo không so sánh được | Ghi rõ môi trường + SHA khi đo |
| C-16 | P2-14 cần đăng ký route và Playwright spec ngoài Allowed files | §5.3 | Đụng file của Doanh/Giang | Thỏa thuận trước 23/11 |
| C-17 | V2 §14 thiếu endpoint task P0 cần | V2 §14, P1-09…P2-12 | FE/BE tự đoán API | Owner đề xuất path, Đức duyệt trước ngày task phụ thuộc |
| C-18 | AC P0-09 "import vào web" khi `apps/web` có từ 15/11 | §5.1 | Không kiểm được trong ngày 14/11 | Xác nhận cùng Doanh 15/11 |
| C-19 | Người tag `rc0.2` chưa chỉ định | §5.5 P4-04 | Mơ hồ trách nhiệm | Đề xuất Đức tag sau khi xác nhận nội dung — cần xác nhận |
| C-20 | §13.3 yêu cầu D-23, D-24, D-25 Accepted trước P0-04; hiện chỉ D-01 Accepted | §2.3, §13.3 | **Chặn B1** | Chốt tại kick-off 14/11 09:00 |
| C-21 | Chưa quy định nơi "cập nhật tiến độ" và lưu kết quả gate | Quyết định mới, §7.11 | Mỗi người ghi một nơi | Đề xuất §4.4 — cần xác nhận |
| C-22 | CODEOWNERS cần GitHub username | §15.1 | Không tạo được CODEOWNERS | Thu thập tại kick-off |
| C-23 | Phiên bản Node/pnpm chưa chốt | D-20 | Không tạo được `.nvmrc`/lockfile | Chốt tại kick-off |
| C-24 | Ảnh đăng ký có thể chứa thông tin cá nhân, repo public | P0-01, D-23, RV-34 | Lộ thông tin | Lưu ngoài repo hoặc che |
| C-25 | Định nghĩa "tỷ lệ điểm danh", "công nợ" chưa có | P2-04, V2 | Số dashboard sai nghĩa | Chốt với Hà trong contract |
| C-26 | Pool A chỉ có Anh + Đức → Đức là approver bắt buộc cho mọi PR pool A của Anh | §6.1, §7.2 | Đức có thể thành nút thắt | Đề xuất thêm Giang vào CODEOWNERS pool A — cần xác nhận |

### 7.3. Dependency chưa đủ / blocker hiện tại

| Blocker | Chặn | Hạn gỡ | Người gỡ |
|---|---|---|---|
| D-23, D-24, D-25 chưa Accepted | P0-04, P0-09, P0-11/P0-12 | 14/11 09:00 | Cả nhóm |
| Phiên bản Node/pnpm (D-20), GitHub username | P0-04 | 14/11 09:00 | Đức thu thập |
| Xác nhận đăng ký (P0-01) | Task tiêu tiền Cloud | 14/11 sáng | Đức |
| Error schema + CSRF header | P0-09, P1-14, P1-15 | 14/11 (error), 17/11 (CSRF) | Anh |
| Cột `audit_logs` trong schema v1 | P1-07 | 16/11 20:00 | Hà (Đức review) |
| TenantTx (P1-04) | Merge P1-07, P2-04 | 18/11 | Anh |
| Path contract còn thiếu (C-17) | P2-11, P2-12, P2-04 | 19–20/11 | Hà, Dương, Anh |
| Seed 10k (P1-20) | Đo P2-04 | 19/11 | Giang |
| Các file handoff khác chưa có | Đối chiếu phối hợp | Khi đưa vào repo | Từng thành viên |

### 7.4. Đối chiếu estimate

| Hạng mục | ROADMAP §6.2 | Sau điều chỉnh | Lý do |
|---|---:|---:|---|
| P0 | 9,5 | 9,5 | P0-05 đổi nội dung, giữ 2h (có thể ít hơn) |
| P1 | 9 | 9 | — |
| P2 | 6 | 6 | — |
| P3 | 4,5 | 4,5 | Gồm phần P3-06 chia với Anh |
| P4 | 0 | 0 | Review tính trong cột Review |
| P5 | 5 | 5 | — |
| P6 | 9,5 | ~5,2 | −8h P6-01 (§15 chuyển Hà/Giang/Dương); +~1,7h P6-05 (5h chia 3); +~1h đọc chéo P6-06; +~1h nghiệm thu bản ghép; giữ P6-07 1h, P6-08 0,5h |
| R (4 chương) | 10 | 10 | — |
| Review | 14 | 14 | Có thể tăng nếu pool A không thêm Giang (C-26) |
| **Tổng** | **~68** | **~63** | Ước lượng của DUC.md, cần trưởng nhóm xác nhận |

~5h giảm đi nên dùng làm dư địa cho tích hợp (IP-3, C-17) và review, không nhận thêm module mới.

### 7.5. Self-Audit

| # | Câu hỏi | Kết quả |
|---|---|---|
| 1 | Đã rà toàn bộ trách nhiệm TV1 trong ROADMAP? | Có — §5 (owner/reviewer), §2.1.4, §2.3, §3.3, §6, §8, §10, §11, §12, §15; xem §7.1 |
| 2 | Đã phân biệt Owner, Co-owner, Reviewer, Coordination? | Có — §2.2 A–E |
| 3 | P0-04, P0-05, P0-09 phản ánh bộ khung tối giản? | Có — chỉ `docs/handoff/`; P0-05 chuyển sang ROADMAP; contract không phụ thuộc file AGENTS |
| 4 | Có vô tình yêu cầu `AGENTS.md`/`CLAUDE.md`? | Không — chỉ nhắc để ghi rõ là không tạo và để đánh dấu mâu thuẫn |
| 5 | P1-07, P1-14, P2-04, P2-14 có hướng dẫn cụ thể? | Có — dependency, allowed files, bước, test, AC, bàn giao (§3.5–3.8) |
| 6 | Contract, schema, ownership nhất quán? | Có — §4.1; Hà giữ schema/migration, Anh giữ Auth/TenantTx, Doanh tiêu thụ client |
| 7 | Integration Point và gate đúng deadline? | Có — IP-1 15/11 tối, IP-2 17/11 tối, IP-3 19/11, IP-4 22/11, IP-5 23/11; G0 16/11 12:00 … G6 29/11 22:00 |
| 8 | Pool B, reviewer dự phòng, SLA đúng ROADMAP? | Có — pool B chính (Anh dự phòng), pool A dự phòng, SLA 4h; đề xuất C-26 tách riêng |
| 9 | Phân công báo cáo, slide, video đúng §15? | Có — C-04, C-05, C-06 ghi rõ chỗ lệch §5 |
| 10 | P6-07, P6-08 được bao phủ? | Có — §6.3 |
| 11 | Mâu thuẫn roadmap cũ vs workflow mới đã ghi nhận? | Có — C-01…C-03, C-10, C-21 |
| 12 | Tổng estimate hợp lý so với ~68h? | ~63h sau điều chỉnh §15; lý do ở §7.4 |
| 13 | Đức có thể mở agent, đọc DUC.md và bắt đầu ngay? | Có — prompt §1.4 + batch §1.3. Điều kiện: kick-off gỡ C-20, C-22, C-23 trước B1 |

> **Release status:** PLAN. DUC.md là tài liệu giao việc, không phải bằng chứng. Không task nào được coi là Done, Pass, Verified hoặc GO khi chưa có evidence gắn SHA.
