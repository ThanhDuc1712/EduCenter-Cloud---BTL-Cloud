/** Response shapes of the EduCenter API (money = decimal string, dates = YYYY-MM-DD, instants = ISO). */
export interface Ref {
  id: string
  code?: string
  name?: string
  fullName?: string
}

export interface Student {
  id: string
  code: string
  fullName: string
  email: string | null
  phone: string | null
  status: 'ACTIVE' | 'INACTIVE' | 'ARCHIVED'
  dateOfBirth?: string | null
  gender?: string | null
  address?: string | null
  guardianName?: string | null
  guardianPhone?: string | null
  note?: string | null
  activeEnrollments?: number
  createdAt: string
}

export interface Teacher {
  id: string
  code: string
  fullName: string
  email: string | null
  phone: string | null
  specialization: string
  qualification: string | null
  bio: string | null
  hiredAt: string | null
  status: 'ACTIVE' | 'ON_LEAVE' | 'INACTIVE'
  activeClasses?: number
}

export interface Course {
  id: string
  code: string
  name: string
  description: string | null
  content: string | null
  level: string | null
  tuitionVnd: string
  durationHours: number
  totalSessions: number
  status: 'DRAFT' | 'ACTIVE' | 'ARCHIVED'
  classCount?: number
  materialCount?: number
  activeStudents?: number
}

export interface Room {
  id: string
  name: string
  capacity: number
  location: string | null
  active: boolean
}

export interface Slot {
  id?: string
  dayOfWeek: number
  startTime: string
  durationMinutes: number
  room?: { id: string; name: string } | null
  roomId?: string
}

export interface Classroom {
  id: string
  code: string
  name: string
  status: 'PLANNED' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED'
  capacity: number
  activeStudents: number
  seatsLeft: number
  sessionCount: number
  startDate: string
  endDate: string
  tuitionVnd: string
  tuitionOverridden: boolean
  note: string | null
  course: { id: string; code: string; name: string }
  teacher: { id: string; code: string; fullName: string } | null
  room: { id: string; name: string; capacity: number } | null
  slots: Slot[]
}

export interface Session {
  id: string
  startsAt: string
  endsAt: string
  topic: string | null
  status: 'SCHEDULED' | 'COMPLETED' | 'CANCELLED'
  note: string | null
  classroom: { id: string; code: string; name: string; status?: string; course?: { id: string; name: string } }
  teacher: { id: string; fullName: string } | null
  room: { id: string; name: string } | null
  attendanceRecorded: number
}

export interface AttendanceCounts {
  total: number
  present: number
  late: number
  absent: number
  excused: number
  rate: number
}

export interface Invoice {
  id: string
  code: string
  description: string
  amountVnd: string
  discountVnd: string
  totalDueVnd: string
  paidVnd: string
  remainingVnd: string
  dueDate: string
  overdue: boolean
  status: 'UNPAID' | 'PARTIAL' | 'PAID' | 'CANCELLED'
  issuedAt: string
  student: { id: string; code: string; fullName: string; phone: string | null }
  classroom: { id: string; code: string; name: string } | null
  course: { id: string; code: string; name: string } | null
}

export interface Material {
  id: string
  title: string
  description: string | null
  category: string
  visibility: 'COURSE' | 'CLASS' | 'PERSONAL'
  status: 'UPLOADING' | 'PROCESSING' | 'READY' | 'REJECTED' | 'FAILED' | 'DELETED'
  course: { id: string; code: string; name: string } | null
  classroom: { id: string; code: string; name: string } | null
  teacher: { id: string; fullName: string } | null
  student: { id: string; code: string; fullName: string } | null
  storageProvider: 'LOCAL' | 'OSS'
  originalFilename: string
  contentType: string
  sizeBytes: number
  checksumSha256: string | null
  sourceVersionId: string | null
  pageCount: number | null
  pdfTitle: string | null
  pdfAuthor: string | null
  hasPreview: boolean
  previewType: string | null
  rejectReason: string | null
  version: number
  uploadedBy: string
  downloadCount: number
  createdAt: string
  updatedAt: string
  processingAt: string | null
  readyAt: string | null
  latestJob: { id: string; attempt: number; processor: 'LOCAL_MOCK' | 'ALIYUN_FC'; status: string; correlationId: string; durationMs: number | null; errorCode: string | null } | null
}

export interface UploadTarget {
  method: 'POST'
  url: string
  fields: Record<string, string>
  fileField: 'file'
  expiresAt: string
  maxBytes: number
  provider: 'LOCAL' | 'OSS'
}
