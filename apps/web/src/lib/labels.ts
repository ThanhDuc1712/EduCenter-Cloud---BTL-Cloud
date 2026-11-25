export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'muted' | 'violet'

interface Label {
  label: string
  tone: Tone
}

const L = (label: string, tone: Tone): Label => ({ label, tone })

export const STATUS: Record<string, Record<string, Label>> = {
  student: { ACTIVE: L('Đang học', 'success'), INACTIVE: L('Tạm nghỉ', 'warning'), ARCHIVED: L('Lưu trữ', 'muted') },
  teacher: { ACTIVE: L('Đang dạy', 'success'), ON_LEAVE: L('Nghỉ phép', 'warning'), INACTIVE: L('Ngừng', 'muted'), TEACHING: L('Đang giảng dạy', 'success'), AVAILABLE: L('Chưa có lớp', 'info') },
  course: { DRAFT: L('Nháp', 'muted'), ACTIVE: L('Đang mở', 'success'), ARCHIVED: L('Lưu trữ', 'muted') },
  classroom: { PLANNED: L('Sắp khai giảng', 'info'), ACTIVE: L('Đang học', 'success'), COMPLETED: L('Đã kết thúc', 'muted'), CANCELLED: L('Đã hủy', 'danger') },
  session: { SCHEDULED: L('Đã lên lịch', 'info'), COMPLETED: L('Đã học', 'success'), CANCELLED: L('Đã hủy', 'danger') },
  enrollment: { ACTIVE: L('Đang học', 'success'), COMPLETED: L('Hoàn thành', 'info'), DROPPED: L('Bỏ học', 'warning'), CANCELLED: L('Đã hủy', 'muted') },
  attendance: { PRESENT: L('Có mặt', 'success'), LATE: L('Đi muộn', 'warning'), ABSENT: L('Vắng', 'danger'), EXCUSED: L('Có phép', 'info') },
  invoice: { UNPAID: L('Chưa thanh toán', 'danger'), PARTIAL: L('Thanh toán một phần', 'warning'), PAID: L('Đã thanh toán', 'success'), CANCELLED: L('Đã hủy', 'muted') },
  material: { UPLOADING: L('Đang tải lên', 'info'), PROCESSING: L('Đang xử lý', 'violet'), READY: L('Sẵn sàng', 'success'), REJECTED: L('Bị từ chối', 'danger'), FAILED: L('Lỗi xử lý', 'danger'), DELETED: L('Đã xóa', 'muted') },
  job: { QUEUED: L('Chờ tệp', 'muted'), RUNNING: L('Đang chạy', 'violet'), SUCCEEDED: L('Thành công', 'success'), REJECTED: L('Từ chối', 'warning'), FAILED: L('Lỗi', 'danger'), TIMED_OUT: L('Quá hạn', 'danger') },
  service: { UP: L('Hoạt động', 'success'), DEGRADED: L('Suy giảm', 'warning'), DOWN: L('Lỗi', 'danger'), NOT_CONFIGURED: L('NOT CONFIGURED', 'muted'), MOCK: L('MOCK (local)', 'violet'), LOCAL: L('LOCAL', 'info') },
  level: { DEBUG: L('DEBUG', 'muted'), INFO: L('INFO', 'info'), WARN: L('WARN', 'warning'), ERROR: L('ERROR', 'danger') },
}

export const CATEGORY: Record<string, string> = { LECTURE: 'Bài giảng', SYLLABUS: 'Đề cương', EXERCISE: 'Bài tập', EXAM: 'Đề kiểm tra', REFERENCE: 'Tài liệu tham khảo', OTHER: 'Khác' }
export const VISIBILITY: Record<string, string> = { COURSE: 'Tài liệu khóa học', CLASS: 'Tài liệu lớp học', PERSONAL: 'Tài liệu cá nhân' }
export const ASSESSMENT_TYPE: Record<string, string> = { QUIZ: 'Kiểm tra ngắn', ASSIGNMENT: 'Bài tập', MIDTERM: 'Giữa kỳ', FINAL: 'Cuối kỳ', OTHER: 'Khác' }
export const PAYMENT_METHOD: Record<string, string> = { CASH: 'Tiền mặt', BANK_TRANSFER: 'Chuyển khoản', CARD: 'Thẻ', OTHER: 'Khác' }
export const NOTIFICATION_TYPE: Record<string, string> = { SCHEDULE: 'Lịch học', CLASS: 'Lớp học', TUITION: 'Học phí', MATERIAL: 'Tài liệu', GRADE: 'Kết quả học tập', SYSTEM: 'Hệ thống' }
export const ROLE: Record<string, string> = { ADMIN: 'Quản trị viên', TEACHER: 'Giáo viên', STUDENT: 'Học viên' }

export function statusLabel(kind: keyof typeof STATUS, value: string | null | undefined): Label {
  return (value && STATUS[kind]?.[value]) || L(value ?? '—', 'neutral')
}
