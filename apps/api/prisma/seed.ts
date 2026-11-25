/**
 * Demo seed (synthetic data only — no real personal data).
 * Idempotent: the two demo tenants are wiped and recreated on every run.
 * Dates are relative to "today" so the dashboard always has today's / upcoming sessions.
 *
 *   pnpm --filter api db:seed
 */
import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import { hashPassword } from '../src/common/auth/password';
import { addDaysYmd, expandWeeklySlots, localYmd, ymdToDate, type SlotPattern } from '../src/common/time';

loadEnv({ path: [path.resolve(__dirname, '../.env'), path.resolve(__dirname, '../../../.env')], quiet: true });

const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error('MIGRATION_DATABASE_URL (or DATABASE_URL) is required');
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

/**
 * Password of every seeded login account (synthetic demo data only). Override with
 * SEED_DEMO_PASSWORD for a shared/graded environment (D-31) — never commit that value.
 */
const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD || 'Demo@12345';

// Deterministic PRNG so every seed run produces the same data set.
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FAMILY = ['Nguyễn', 'Trần', 'Lê', 'Phạm', 'Hoàng', 'Huỳnh', 'Phan', 'Vũ', 'Võ', 'Đặng', 'Bùi', 'Đỗ', 'Hồ', 'Ngô', 'Dương', 'Lý'];
const MIDDLE = ['Văn', 'Thị', 'Minh', 'Ngọc', 'Thanh', 'Quang', 'Thu', 'Hoàng', 'Gia', 'Bảo', 'Đức', 'Khánh'];
const GIVEN = ['An', 'Bình', 'Châu', 'Dũng', 'Giang', 'Hà', 'Hải', 'Hạnh', 'Hiếu', 'Hoa', 'Huy', 'Khánh', 'Lan', 'Linh', 'Long', 'Mai', 'Nam', 'Ngân', 'Phúc', 'Quân', 'Quỳnh', 'Sơn', 'Tâm', 'Thảo', 'Trang', 'Tú', 'Tuấn', 'Uyên', 'Vy', 'Yến'];
const DISTRICTS_HN = ['Cầu Giấy', 'Đống Đa', 'Ba Đình', 'Hai Bà Trưng', 'Thanh Xuân', 'Hoàng Mai', 'Long Biên', 'Tây Hồ'];
const DISTRICTS_SG = ['Quận 1', 'Quận 3', 'Quận 7', 'Bình Thạnh', 'Phú Nhuận', 'Gò Vấp', 'Tân Bình', 'Thủ Đức'];

function slugify(name: string): string {
  return name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().replace(/[^a-z0-9]+/g, '.');
}

interface CourseSeed { code: string; name: string; level: string; tuition: number; hours: number; sessions: number; description: string; content: string }
interface ClassSeed { code: string; name: string; course: string; teacher: number; room: number; capacity: number; startOffsetDays: number; weeks: number; slots: Omit<SlotPattern, 'roomId'>[]; enroll: number }

const COURSES: CourseSeed[] = [
  { code: 'IELTS-F', name: 'IELTS Foundation (4.0 – 5.5)', level: 'Sơ cấp', tuition: 6_500_000, hours: 48, sessions: 24, description: 'Xây nền tảng 4 kỹ năng Nghe – Nói – Đọc – Viết cho người mới bắt đầu IELTS.', content: '1. Ngữ pháp nền tảng\n2. Từ vựng theo chủ đề\n3. Kỹ năng Listening Part 1–2\n4. Reading: Skimming & Scanning\n5. Writing Task 1 cơ bản\n6. Speaking Part 1' },
  { code: 'IELTS-65', name: 'IELTS Intensive 6.5+', level: 'Trung cấp', tuition: 9_800_000, hours: 60, sessions: 30, description: 'Luyện đề chuyên sâu, chiến lược đạt band 6.5 trở lên.', content: '1. Writing Task 2 – lập luận\n2. Speaking Part 2–3\n3. Luyện đề Cambridge 15–19\n4. Chữa bài cá nhân' },
  { code: 'TOEIC-650', name: 'TOEIC 650+', level: 'Trung cấp', tuition: 4_200_000, hours: 40, sessions: 20, description: 'Lộ trình TOEIC Listening & Reading mục tiêu 650+.', content: '1. Part 1–4 Listening\n2. Part 5–7 Reading\n3. Thi thử định kỳ' },
  { code: 'ENG-COM', name: 'Tiếng Anh giao tiếp văn phòng', level: 'Mọi trình độ', tuition: 3_600_000, hours: 32, sessions: 16, description: 'Giao tiếp tự tin trong môi trường công sở: họp, email, thuyết trình.', content: '1. Small talk\n2. Email chuyên nghiệp\n3. Họp và thuyết trình\n4. Đàm phán cơ bản' },
  { code: 'PY-101', name: 'Lập trình Python cơ bản', level: 'Sơ cấp', tuition: 5_000_000, hours: 36, sessions: 18, description: 'Nhập môn lập trình với Python: biến, điều kiện, vòng lặp, hàm, xử lý dữ liệu.', content: '1. Cài đặt môi trường\n2. Kiểu dữ liệu\n3. Cấu trúc điều khiển\n4. Hàm và module\n5. Dự án cuối khóa' },
  { code: 'MATH-6', name: 'Toán tư duy lớp 6', level: 'THCS', tuition: 2_800_000, hours: 30, sessions: 20, description: 'Phát triển tư duy logic và giải toán nâng cao cho học sinh lớp 6.', content: '1. Số học\n2. Hình học trực quan\n3. Toán đố\n4. Ôn thi học sinh giỏi' },
];

const TEACHERS = [
  { spec: 'IELTS, Academic Writing', qual: 'Thạc sĩ TESOL, IELTS 8.0' },
  { spec: 'IELTS Speaking, Phát âm', qual: 'CELTA, IELTS 8.5' },
  { spec: 'TOEIC, Tiếng Anh thương mại', qual: 'Cử nhân Ngôn ngữ Anh, TOEIC 970' },
  { spec: 'Tiếng Anh giao tiếp', qual: 'Cử nhân Sư phạm Anh' },
  { spec: 'Lập trình Python, Khoa học dữ liệu', qual: 'Kỹ sư CNTT' },
  { spec: 'Toán học THCS', qual: 'Thạc sĩ Toán học' },
  { spec: 'IELTS Reading & Listening', qual: 'Thạc sĩ Ngôn ngữ học' },
  { spec: 'Tin học văn phòng', qual: 'Cử nhân CNTT' },
];

const ROOMS = [
  { name: 'P.101', capacity: 20, location: 'Tầng 1' },
  { name: 'P.102', capacity: 20, location: 'Tầng 1' },
  { name: 'P.201', capacity: 30, location: 'Tầng 2' },
  { name: 'P.202', capacity: 25, location: 'Tầng 2' },
  { name: 'Lab Tin học', capacity: 24, location: 'Tầng 3' },
];

// Teacher index / room index refer to the arrays above. Slots never overlap per teacher or room.
const CLASSES: ClassSeed[] = [
  { code: 'IELTSF-K01', name: 'IELTS Foundation K01', course: 'IELTS-F', teacher: 0, room: 0, capacity: 18, startOffsetDays: -42, weeks: 12, slots: [{ dayOfWeek: 1, startMinute: 18 * 60, durationMinutes: 120 }, { dayOfWeek: 3, startMinute: 18 * 60, durationMinutes: 120 }], enroll: 14 },
  { code: 'IELTSF-K02', name: 'IELTS Foundation K02 (cuối tuần)', course: 'IELTS-F', teacher: 6, room: 1, capacity: 18, startOffsetDays: -21, weeks: 12, slots: [{ dayOfWeek: 6, startMinute: 8 * 60, durationMinutes: 120 }, { dayOfWeek: 7, startMinute: 8 * 60, durationMinutes: 120 }], enroll: 10 },
  { code: 'IELTS65-K01', name: 'IELTS 6.5+ K01', course: 'IELTS-65', teacher: 1, room: 2, capacity: 16, startOffsetDays: -35, weeks: 15, slots: [{ dayOfWeek: 2, startMinute: 18 * 60, durationMinutes: 120 }, { dayOfWeek: 4, startMinute: 18 * 60, durationMinutes: 120 }], enroll: 12 },
  { code: 'TOEIC-K05', name: 'TOEIC 650+ K05', course: 'TOEIC-650', teacher: 2, room: 3, capacity: 25, startOffsetDays: -28, weeks: 10, slots: [{ dayOfWeek: 1, startMinute: 19 * 60 + 30, durationMinutes: 120 }, { dayOfWeek: 5, startMinute: 18 * 60, durationMinutes: 120 }], enroll: 15 },
  { code: 'COM-K03', name: 'Giao tiếp văn phòng K03', course: 'ENG-COM', teacher: 3, room: 0, capacity: 20, startOffsetDays: -14, weeks: 8, slots: [{ dayOfWeek: 2, startMinute: 7 * 60 + 30, durationMinutes: 90 }, { dayOfWeek: 4, startMinute: 7 * 60 + 30, durationMinutes: 90 }, { dayOfWeek: 6, startMinute: 14 * 60, durationMinutes: 120 }], enroll: 9 },
  { code: 'PY-K02', name: 'Python cơ bản K02', course: 'PY-101', teacher: 4, room: 4, capacity: 24, startOffsetDays: -30, weeks: 9, slots: [{ dayOfWeek: 3, startMinute: 18 * 60, durationMinutes: 120 }, { dayOfWeek: 6, startMinute: 9 * 60, durationMinutes: 120 }], enroll: 13 },
  { code: 'MATH6-K01', name: 'Toán tư duy 6 K01', course: 'MATH-6', teacher: 5, room: 2, capacity: 20, startOffsetDays: -120, weeks: 10, slots: [{ dayOfWeek: 7, startMinute: 14 * 60, durationMinutes: 90 }], enroll: 11 },
  { code: 'MATH6-K02', name: 'Toán tư duy 6 K02', course: 'MATH-6', teacher: 5, room: 2, capacity: 20, startOffsetDays: 10, weeks: 10, slots: [{ dayOfWeek: 7, startMinute: 16 * 60, durationMinutes: 90 }], enroll: 5 },
  { code: 'TOEIC-K06', name: 'TOEIC 650+ K06 (sáng)', course: 'TOEIC-650', teacher: 2, room: 3, capacity: 25, startOffsetDays: 14, weeks: 10, slots: [{ dayOfWeek: 3, startMinute: 8 * 60, durationMinutes: 120 }], enroll: 0 },
];

const BANDS = [
  { label: 'Xuất sắc', minScore: '9.00' },
  { label: 'Giỏi', minScore: '8.00' },
  { label: 'Khá', minScore: '6.50' },
  { label: 'Trung bình', minScore: '5.00' },
  { label: 'Yếu', minScore: '0.00' },
];

async function wipeTenant(slug: string): Promise<void> {
  const tenant = await prisma.tenant.findUnique({ where: { slug } });
  if (!tenant) return;
  const t = { tenantId: tenant.id };
  // Child → parent order (composite FKs).
  await prisma.materialProcessingEvent.deleteMany({ where: t });
  await prisma.materialProcessingJob.deleteMany({ where: t });
  await prisma.material.deleteMany({ where: t });
  await prisma.opsLogEntry.deleteMany({ where: t });
  await prisma.payment.deleteMany({ where: t });
  await prisma.invoice.deleteMany({ where: t });
  await prisma.grade.deleteMany({ where: t });
  await prisma.assessment.deleteMany({ where: t });
  await prisma.gradeBand.deleteMany({ where: t });
  await prisma.attendance.deleteMany({ where: t });
  await prisma.enrollment.deleteMany({ where: t });
  await prisma.classSession.deleteMany({ where: t });
  await prisma.classScheduleSlot.deleteMany({ where: t });
  await prisma.classroom.deleteMany({ where: t });
  await prisma.notification.deleteMany({ where: t });
  await prisma.activityLog.deleteMany({ where: t });
  await prisma.authSession.deleteMany({ where: t });
  await prisma.user.deleteMany({ where: t });
  await prisma.room.deleteMany({ where: t });
  await prisma.course.deleteMany({ where: t });
  await prisma.teacher.deleteMany({ where: t });
  await prisma.student.deleteMany({ where: t });
  await prisma.tenant.delete({ where: { id: tenant.id } });
}

function personName(r: () => number): string {
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
  return `${pick(FAMILY)} ${pick(MIDDLE)} ${pick(GIVEN)}`;
}

async function seedTenant(slug: string, name: string, seed: number, districts: string[], studentCount: number): Promise<void> {
  const r = rng(seed);
  const today = localYmd();
  const now = new Date();
  const tenant = await prisma.tenant.create({ data: { slug, name } });
  const tenantId = tenant.id;
  const domain = `${slug}.edu.example`;

  await prisma.gradeBand.createMany({ data: BANDS.map((b) => ({ tenantId, ...b })) });

  // Teachers
  const teachers = [];
  for (let i = 0; i < TEACHERS.length; i++) {
    const fullName = personName(r);
    teachers.push(
      await prisma.teacher.create({
        data: {
          tenantId,
          code: `GV${String(i + 1).padStart(3, '0')}`,
          fullName,
          email: `${slugify(fullName)}.gv${i + 1}@${domain}`,
          phone: `09${String(Math.floor(r() * 1e8)).padStart(8, '0')}`,
          specialization: TEACHERS[i].spec,
          qualification: TEACHERS[i].qual,
          bio: `Giáo viên phụ trách ${TEACHERS[i].spec.toLowerCase()} tại ${name}.`,
          hiredAt: ymdToDate(addDaysYmd(today, -Math.floor(200 + r() * 1200))),
          status: i === 7 ? 'ON_LEAVE' : 'ACTIVE',
        },
      }),
    );
  }

  // Students
  const students = [];
  for (let i = 0; i < studentCount; i++) {
    const fullName = personName(r);
    const age = 11 + Math.floor(r() * 20);
    students.push(
      await prisma.student.create({
        data: {
          tenantId,
          code: `HV${String(i + 1).padStart(4, '0')}`,
          fullName,
          email: `${slugify(fullName)}.${i + 1}@${domain}`,
          phone: `03${String(Math.floor(r() * 1e8)).padStart(8, '0')}`,
          dateOfBirth: ymdToDate(addDaysYmd(today, -(age * 365 + Math.floor(r() * 300)))),
          gender: r() < 0.5 ? 'Nam' : 'Nữ',
          address: `${Math.floor(1 + r() * 200)} đường số ${Math.floor(1 + r() * 30)}, ${districts[Math.floor(r() * districts.length)]}`,
          guardianName: age < 18 ? personName(r) : null,
          guardianPhone: age < 18 ? `09${String(Math.floor(r() * 1e8)).padStart(8, '0')}` : null,
          status: i >= studentCount - 3 ? 'INACTIVE' : 'ACTIVE',
        },
      }),
    );
  }
  const activeStudents = students.filter((s) => s.status === 'ACTIVE');

  const rooms = [];
  for (const room of ROOMS) rooms.push(await prisma.room.create({ data: { tenantId, ...room } }));

  const courses = new Map<string, { id: string; tuitionVnd: bigint }>();
  for (const c of COURSES) {
    const row = await prisma.course.create({
      data: { tenantId, code: c.code, name: c.name, level: c.level, description: c.description, content: c.content, tuitionVnd: BigInt(c.tuition), durationHours: c.hours, totalSessions: c.sessions, status: 'ACTIVE' },
    });
    courses.set(c.code, row);
  }
  await prisma.course.create({
    data: { tenantId, code: 'AI-KIDS', name: 'AI cho thiếu nhi (sắp mở)', level: 'Tiểu học', description: 'Khóa học đang được thiết kế.', tuitionVnd: 3_000_000n, durationHours: 24, totalSessions: 12, status: 'DRAFT' },
  });

  let invoiceSeq = 1;
  let paymentSeq = 1;
  let studentCursor = 0;

  for (const cls of CLASSES) {
    const course = courses.get(cls.course)!;
    const startYmd = addDaysYmd(today, cls.startOffsetDays);
    const endYmd = addDaysYmd(startYmd, cls.weeks * 7 - 1);
    const status = endYmd < today ? 'COMPLETED' : startYmd > today ? 'PLANNED' : 'ACTIVE';
    const teacher = teachers[cls.teacher];
    const room = rooms[cls.room];

    const classroom = await prisma.classroom.create({
      data: { tenantId, code: cls.code, name: cls.name, courseId: course.id, teacherId: teacher.id, roomId: room.id, capacity: cls.capacity, startDate: ymdToDate(startYmd), endDate: ymdToDate(endYmd), status },
    });
    await prisma.classScheduleSlot.createMany({ data: cls.slots.map((s) => ({ tenantId, classroomId: classroom.id, ...s, roomId: room.id })) });

    const occurrences = expandWeeklySlots(startYmd, endYmd, cls.slots.map((s) => ({ ...s, roomId: room.id })));
    await prisma.classSession.createMany({
      data: occurrences.map((o, idx) => ({
        tenantId,
        classroomId: classroom.id,
        teacherId: teacher.id,
        roomId: o.roomId,
        startsAt: o.startsAt,
        endsAt: o.endsAt,
        topic: `Buổi ${idx + 1}`,
        status: o.endsAt < now ? 'COMPLETED' : 'SCHEDULED',
      })),
    });
    const sessions = await prisma.classSession.findMany({ where: { tenantId, classroomId: classroom.id }, orderBy: { startsAt: 'asc' } });

    // Enrollments (round-robin over active students, so many students take 2 classes).
    const enrolled = [];
    for (let i = 0; i < cls.enroll; i++) {
      const student = activeStudents[studentCursor % activeStudents.length];
      studentCursor += 1;
      if (enrolled.some((s) => s.id === student.id)) continue;
      enrolled.push(student);
    }
    const tuition = course.tuitionVnd;
    for (const student of enrolled) {
      const dropped = r() < 0.06 && status !== 'PLANNED';
      await prisma.enrollment.create({
        data: { tenantId, classroomId: classroom.id, studentId: student.id, status: dropped ? 'DROPPED' : status === 'COMPLETED' ? 'COMPLETED' : 'ACTIVE', enrolledAt: localToUtcSafe(addDaysYmd(startYmd, -Math.floor(3 + r() * 10))), endedAt: dropped ? now : null },
      });

      // Invoice + payments
      const discount = r() < 0.2 ? tuition / 10n : 0n;
      const due = tuition - discount;
      const roll = r();
      const paid = status === 'COMPLETED' || roll < 0.55 ? due : roll < 0.8 ? (due / 2n / 1000n) * 1000n : 0n;
      const dueDate = addDaysYmd(startYmd, 14);
      const invoice = await prisma.invoice.create({
        data: {
          tenantId,
          code: `HD${String(invoiceSeq++).padStart(5, '0')}`,
          studentId: student.id,
          classroomId: classroom.id,
          courseId: course.id,
          description: `Học phí ${cls.name}`,
          amountVnd: tuition,
          discountVnd: discount,
          paidVnd: paid,
          dueDate: ymdToDate(dueDate),
          status: paid === 0n ? 'UNPAID' : paid >= due ? 'PAID' : 'PARTIAL',
          issuedAt: localToUtcSafe(addDaysYmd(startYmd, -7)),
        },
      });
      if (paid > 0n) {
        await prisma.payment.create({
          data: { tenantId, invoiceId: invoice.id, amountVnd: paid, method: r() < 0.6 ? 'BANK_TRANSFER' : 'CASH', paidAt: localToUtcSafe(addDaysYmd(startYmd, Math.floor(r() * 10) - 5)), receivedBy: 'Phòng Kế toán', idempotencyKey: `seed-${slug}-${paymentSeq++}`, requestHash: '0'.repeat(64), note: paid < due ? 'Thanh toán đợt 1' : null },
        });
      }
    }

    // Attendance for completed sessions
    const pastSessions = sessions.filter((s) => s.status === 'COMPLETED');
    const attendanceRows = [];
    for (const session of pastSessions) {
      for (const student of enrolled) {
        const x = r();
        attendanceRows.push({ tenantId, sessionId: session.id, studentId: student.id, status: (x < 0.84 ? 'PRESENT' : x < 0.91 ? 'LATE' : x < 0.96 ? 'ABSENT' : 'EXCUSED') as 'PRESENT' | 'LATE' | 'ABSENT' | 'EXCUSED', recordedAt: session.endsAt });
      }
    }
    if (attendanceRows.length) await prisma.attendance.createMany({ data: attendanceRows });

    // Assessments + grades
    if (status !== 'PLANNED') {
      const plan = [
        { name: 'Kiểm tra 15 phút', type: 'QUIZ' as const, weight: 20, at: 0.25 },
        { name: 'Kiểm tra giữa kỳ', type: 'MIDTERM' as const, weight: 30, at: 0.5 },
        { name: 'Thi cuối kỳ', type: 'FINAL' as const, weight: 50, at: 0.97 },
      ];
      for (const a of plan) {
        const heldOn = addDaysYmd(startYmd, Math.floor(cls.weeks * 7 * a.at));
        const assessment = await prisma.assessment.create({ data: { tenantId, classroomId: classroom.id, name: a.name, type: a.type, weight: a.weight, maxScore: '10', heldOn: ymdToDate(heldOn) } });
        if (heldOn < today) {
          await prisma.grade.createMany({
            data: enrolled.map((s) => ({ tenantId, assessmentId: assessment.id, studentId: s.id, score: (Math.round(Math.min(10, Math.max(2.5, 5.2 + r() * 4.6 + (r() < 0.1 ? 1 : 0))) * 4) / 4).toFixed(2) })),
          });
        }
      }
    }
  }

  // Notifications + activity
  await prisma.notification.createMany({
    data: [
      { tenantId, type: 'SYSTEM', title: 'Chào mừng đến EduCenter Cloud', body: 'Hệ thống quản lý trung tâm đã sẵn sàng. Dữ liệu trong môi trường demo là dữ liệu tổng hợp.', recipientRole: 'ADMIN' },
      { tenantId, type: 'TUITION', title: 'Nhắc hạn học phí', body: 'Có học viên còn công nợ quá hạn. Xem trang Học phí để theo dõi.', recipientRole: 'ADMIN', link: '/tuition' },
      ...teachers.slice(0, 6).map((t) => ({ tenantId, type: 'SCHEDULE' as const, title: 'Lịch dạy tuần này', body: 'Vui lòng kiểm tra lịch dạy và điểm danh đầy đủ sau mỗi buổi học.', recipientRole: 'TEACHER' as const, recipientTeacherId: t.id, link: '/schedule' })),
      ...activeStudents.slice(0, 20).map((s) => ({ tenantId, type: 'CLASS' as const, title: 'Thông báo lớp học', body: 'Trung tâm cập nhật lịch học mới, vui lòng xem trang Lịch học.', recipientRole: 'STUDENT' as const, recipientStudentId: s.id, link: '/schedule' })),
    ],
  });
  await prisma.activityLog.createMany({
    data: [
      { tenantId, actorRole: 'SYSTEM', actorName: 'Seed', action: 'seed.completed', entityType: 'tenant', entityId: tenantId, summary: `Khởi tạo dữ liệu demo cho ${name}` },
    ],
  });

  // Login accounts: one admin + every seeded teacher / student (their profile email), same demo password.
  const accounts = [
    { email: `admin@${domain}`, role: 'ADMIN' as const, displayName: 'Quản trị trung tâm' },
    ...teachers.map((t) => ({ email: t.email!.toLowerCase(), role: 'TEACHER' as const, displayName: t.fullName, teacherId: t.id })),
    ...students.filter((s) => s.email).map((s) => ({ email: s.email!.toLowerCase(), role: 'STUDENT' as const, displayName: s.fullName, studentId: s.id })),
  ];
  const data = [];
  for (const a of accounts) data.push({ tenantId, ...a, passwordHash: await hashPassword(DEMO_PASSWORD) });
  await prisma.user.createMany({ data });
}

function localToUtcSafe(ymd: string): Date {
  return new Date(`${ymd}T02:00:00Z`);
}

async function main(): Promise<void> {
  const started = Date.now();
  for (const slug of ['hanoi-center', 'saigon-center']) await wipeTenant(slug);
  await seedTenant('hanoi-center', 'EduCenter Hà Nội', 20261124, DISTRICTS_HN, 60);
  await seedTenant('saigon-center', 'EduCenter Sài Gòn', 20261125, DISTRICTS_SG, 40);
  const counts = {
    tenants: await prisma.tenant.count(),
    students: await prisma.student.count(),
    teachers: await prisma.teacher.count(),
    classrooms: await prisma.classroom.count(),
    sessions: await prisma.classSession.count(),
    attendances: await prisma.attendance.count(),
    invoices: await prisma.invoice.count(),
    users: await prisma.user.count(),
  };
  console.log(JSON.stringify({ msg: 'seed.completed', durationMs: Date.now() - started, counts }));
  console.log('Demo login (center hanoi-center): admin@hanoi-center.edu.example — password from SEED_DEMO_PASSWORD (default Demo@12345). Teachers/students sign in with their profile email.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
