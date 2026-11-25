import {
  Activity,
  BarChart3,
  Bell,
  BookOpen,
  Boxes,
  CalendarDays,
  ClipboardCheck,
  Cloud,
  Cpu,
  FileStack,
  FileText,
  GraduationCap,
  HardDrive,
  LayoutDashboard,
  Library,
  ListChecks,
  Network,
  ScrollText,
  School,
  Server,
  Upload,
  UserRoundPlus,
  Users,
  Wallet,
} from 'lucide-react'
import type { Role } from '@/lib/context'

export interface NavItem {
  to: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  roles: Role[]
}

export interface NavGroup {
  label: string
  items: NavItem[]
}

const ALL: Role[] = ['ADMIN', 'TEACHER', 'STUDENT']
const STAFF: Role[] = ['ADMIN', 'TEACHER']
const ADMIN: Role[] = ['ADMIN']

export const NAV: NavGroup[] = [
  {
    label: 'Quản lý giáo dục',
    items: [
      { to: '/', label: 'Tổng quan', icon: LayoutDashboard, roles: ALL },
      { to: '/students', label: 'Học viên', icon: Users, roles: STAFF },
      { to: '/teachers', label: 'Giáo viên', icon: GraduationCap, roles: ALL },
      { to: '/courses', label: 'Khóa học', icon: BookOpen, roles: ALL },
      { to: '/classes', label: 'Lớp học', icon: School, roles: ALL },
      { to: '/schedule', label: 'Lịch học', icon: CalendarDays, roles: ALL },
      { to: '/enrollments', label: 'Đăng ký học', icon: UserRoundPlus, roles: ALL },
      { to: '/attendance', label: 'Điểm danh', icon: ClipboardCheck, roles: ALL },
      { to: '/grades', label: 'Điểm số', icon: ListChecks, roles: ALL },
      { to: '/tuition', label: 'Học phí', icon: Wallet, roles: ['ADMIN', 'STUDENT'] },
      { to: '/notifications', label: 'Thông báo', icon: Bell, roles: ALL },
      { to: '/reports', label: 'Báo cáo', icon: BarChart3, roles: ADMIN },
    ],
  },
  {
    label: 'Học liệu',
    items: [
      { to: '/materials', label: 'Tài liệu', icon: FileText, roles: ALL },
      { to: '/library', label: 'Kho học liệu', icon: Library, roles: ALL },
      { to: '/materials/upload', label: 'Upload tài liệu', icon: Upload, roles: STAFF },
      { to: '/processing', label: 'Processing Center', icon: Cpu, roles: STAFF },
    ],
  },
  {
    label: 'Cloud Management',
    items: [
      { to: '/cloud', label: 'Cloud Overview', icon: Cloud, roles: ADMIN },
      { to: '/cloud/architecture', label: 'Cloud Architecture', icon: Network, roles: ADMIN },
      { to: '/cloud/storage', label: 'Storage Management', icon: HardDrive, roles: ADMIN },
      { to: '/cloud/function', label: 'Function Compute', icon: Server, roles: ADMIN },
      { to: '/cloud/jobs', label: 'Processing Jobs', icon: FileStack, roles: ADMIN },
      { to: '/cloud/monitoring', label: 'Cloud Monitoring', icon: Activity, roles: ADMIN },
      { to: '/cloud/logs', label: 'Cloud Logs', icon: ScrollText, roles: ADMIN },
      { to: '/cloud/resources', label: 'Cloud Resources', icon: Boxes, roles: ADMIN },
    ],
  },
]


/** Breadcrumb title for a path (longest matching nav prefix). */
export function titleFor(pathname: string): { group?: string; label: string } {
  let best: { group?: string; label: string; len: number } = { label: 'EduCenter', len: -1 }
  for (const g of NAV)
    for (const i of g.items) {
      const match = i.to === '/' ? pathname === '/' : pathname === i.to || pathname.startsWith(`${i.to}/`)
      if (match && i.to.length > best.len) best = { group: g.label, label: i.label, len: i.to.length }
    }
  return best
}
