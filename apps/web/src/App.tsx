import { createBrowserRouter, Link, Navigate, RouterProvider } from 'react-router'
import { Button } from '@/components/ui/button'
import { AppLayout } from '@/components/layout/AppLayout'
import { usePrincipal, type Role } from '@/lib/context'
import { DashboardPage } from '@/pages/DashboardPage'
import { StudentsPage } from '@/pages/students/StudentsPage'
import { StudentDetailPage } from '@/pages/students/StudentDetailPage'
import { TeacherDetailPage, TeachersPage } from '@/pages/teachers/TeachersPage'
import { CourseDetailPage, CoursesPage } from '@/pages/courses/CoursesPage'
import { ClassDetailPage, ClassesPage } from '@/pages/classes/ClassesPages'
import { SchedulePage } from '@/pages/schedule/SchedulePage'
import { EnrollmentsPage } from '@/pages/enrollments/EnrollmentsPage'
import { AttendancePage, AttendanceSessionPage } from '@/pages/attendance/AttendancePages'
import { GradesPage } from '@/pages/grades/GradesPage'
import { TuitionPage } from '@/pages/tuition/TuitionPage'
import { NotificationsPage, ReportsPage } from '@/pages/NotificationsReportsPages'
import { LibraryPage, MaterialDetailPage, MaterialsPage, ProcessingCenterPage, UploadPage } from '@/pages/materials/MaterialsPages'
import { LoginPage, RegisterPage } from '@/pages/auth/AuthPages'
import { CloudArchitecturePage, CloudOverviewPage, FunctionComputePage, JobsPage, LogsPage, MonitoringPage, ResourcesPage, StoragePage } from '@/pages/cloud/CloudPages'

/** UI-only guard: hides pages the role cannot use. The API enforces every rule independently. */
function RoleGate({ roles, children }: { roles: Role[]; children: React.ReactNode }) {
  const p = usePrincipal()
  if (p && !roles.includes(p.role)) return <Navigate to="/" replace />
  return <>{children}</>
}

function NotFound() {
  return (
    <div className="py-20 text-center">
      <p className="text-4xl font-semibold">404</p>
      <p className="mt-2 text-muted-foreground">Không tìm thấy trang</p>
      <Button asChild className="mt-4">
        <Link to="/">Về trang tổng quan</Link>
      </Button>
    </div>
  )
}

const STAFF: Role[] = ['ADMIN', 'TEACHER']
const ADMIN: Role[] = ['ADMIN']
const gate = (roles: Role[], el: React.ReactNode) => <RoleGate roles={roles}>{el}</RoleGate>

const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  { path: '/register', element: <RegisterPage /> },
  {
    element: <AppLayout />,
    children: [
      { path: '/', element: <DashboardPage /> },
      { path: '/students', element: gate(STAFF, <StudentsPage />) },
      { path: '/students/:id', element: <StudentDetailPage /> },
      { path: '/teachers', element: <TeachersPage /> },
      { path: '/teachers/:id', element: <TeacherDetailPage /> },
      { path: '/courses', element: <CoursesPage /> },
      { path: '/courses/:id', element: <CourseDetailPage /> },
      { path: '/classes', element: <ClassesPage /> },
      { path: '/classes/:id', element: <ClassDetailPage /> },
      { path: '/schedule', element: <SchedulePage /> },
      { path: '/enrollments', element: <EnrollmentsPage /> },
      { path: '/attendance', element: <AttendancePage /> },
      { path: '/attendance/:sessionId', element: <AttendanceSessionPage /> },
      { path: '/grades', element: <GradesPage /> },
      { path: '/tuition', element: gate(['ADMIN', 'STUDENT'], <TuitionPage />) },
      { path: '/notifications', element: <NotificationsPage /> },
      { path: '/reports', element: gate(ADMIN, <ReportsPage />) },
      { path: '/materials', element: <MaterialsPage /> },
      { path: '/materials/upload', element: gate(STAFF, <UploadPage />) },
      { path: '/materials/:id', element: <MaterialDetailPage /> },
      { path: '/library', element: <LibraryPage /> },
      { path: '/processing', element: gate(STAFF, <ProcessingCenterPage />) },
      { path: '/cloud', element: gate(ADMIN, <CloudOverviewPage />) },
      { path: '/cloud/architecture', element: gate(ADMIN, <CloudArchitecturePage />) },
      { path: '/cloud/storage', element: gate(ADMIN, <StoragePage />) },
      { path: '/cloud/function', element: gate(ADMIN, <FunctionComputePage />) },
      { path: '/cloud/jobs', element: gate(ADMIN, <JobsPage />) },
      { path: '/cloud/monitoring', element: gate(ADMIN, <MonitoringPage />) },
      { path: '/cloud/logs', element: gate(ADMIN, <LogsPage />) },
      { path: '/cloud/resources', element: gate(ADMIN, <ResourcesPage />) },
      { path: '*', element: <NotFound /> },
    ],
  },
])

export default function App() {
  return <RouterProvider router={router} />
}
