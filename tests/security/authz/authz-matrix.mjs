#!/usr/bin/env node
/**
 * Authorization matrix for the EduCenter API (black-box, HTTP only).
 *
 * Expected results come from the BUSINESS RULES written in README.md (section "Quy tắc nghiệp vụ"),
 * not from the @Roles/@AnyRole decorators: the point is to find places where code and rules disagree.
 * Unclear rules are "?" and never count as FAIL, except when a response leaks IDs that the rules
 * forbid outright (other tenant, other students, tuition for teachers, ...).
 *
 * Usage (see README.md):  node tests/security/authz/authz-matrix.mjs [--include-writes]
 * Env: BASE_URL, APP_ORIGIN, TEST_PASSWORD (required), OUT_DIR.
 *
 * Never prints or writes cookies, tokens, passwords or response bodies.
 * Node 24+, built-in fetch only, no dependencies.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

// ───────────────────────────── Configuration ─────────────────────────────

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..', '..');
const API_SRC = path.join(REPO_ROOT, 'apps', 'api', 'src');

const USAGE = `Usage: node tests/security/authz/authz-matrix.mjs [--include-writes]
  BASE_URL      API base (default http://localhost:3000)
  APP_ORIGIN    Origin sent on unsafe requests (default http://localhost:5173)
  TEST_PASSWORD password of the seeded accounts (required)
  OUT_DIR       where the CSV goes (default ../EduCenter-test-results next to the repo)
  --include-writes  also send write requests that MUST be refused (localhost only)`;

const argv = process.argv.slice(2);
if (argv.includes('--help') || argv.includes('-h')) {
  console.log(USAGE);
  process.exit(0);
}
for (const a of argv) if (a !== '--include-writes') fatal(`Unknown argument: ${a}\n${USAGE}`);
const INCLUDE_WRITES = argv.includes('--include-writes');

const BASE_URL = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
const APP_ORIGIN = process.env.APP_ORIGIN || 'http://localhost:5173';
const PASSWORD = process.env.TEST_PASSWORD;
const OUT_DIR = process.env.OUT_DIR ? path.resolve(process.env.OUT_DIR) : path.resolve(REPO_ROOT, '..', 'EduCenter-test-results');
const API = `${BASE_URL}/api/v1`;
const EVIL_ORIGIN = 'https://evil.example';
const TENANTS = { A: 'hanoi-center', B: 'saigon-center' };

let baseHost;
try {
  baseHost = new URL(BASE_URL).hostname;
} catch {
  fatal(`BASE_URL is not a valid URL`);
}
const IS_LOCAL = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(baseHost);
if (!PASSWORD) fatal('TEST_PASSWORD is not set (the password is read from this variable only).');
if (INCLUDE_WRITES && !IS_LOCAL) fatal(`--include-writes is only allowed when BASE_URL is localhost/127.0.0.1 (got host "${baseHost}").`);

// Expectations and results
const A = 'ALLOW';
const D = 'DENY';
const Q = '?';
const PASS = 'PASS';
const FAIL = 'FAIL';
const SKIP = 'SKIP';
const DENY_STATUSES = new Set([401, 403, 404]);
const OK_ENROLLMENT = new Set(['ACTIVE', 'COMPLETED']);

/** Questions still open with the dev team: these rows stay "?" and carry this tag. */
const PENDING = {
  Q1: 'CHỜ DEV (Q1: học viên INACTIVE có được đăng nhập?)',
  Q2: 'CHỜ DEV (Q2: request ghi không có Origin có được chấp nhận?)',
  Q13: 'CHỜ DEV (Q13: học liệu không gắn lớp / lịch sử học liệu)',
  Q14: 'CHỜ DEV (Q14: ghi danh DROPPED/CANCELLED)',
};
/** Known, reported bugs: the row stays FAIL and the note names the bug. */
const KNOWN_BUGS = {
  '/cloud/logs': 'BUG-02: ops-log callback entries have tenantId=null and are listed to every tenant admin',
};

class SetupError extends Error {}

function fatal(msg) {
  console.error(`authz-matrix: ${msg}`);
  process.exit(2);
}

// ───────────────────────────── HTTP ─────────────────────────────

/**
 * One request. `origin`: 'default' = APP_ORIGIN on unsafe methods only; null = no Origin header;
 * any string = that Origin. Returns status + body text (kept in memory only, never logged).
 */
async function call(actor, method, p, { body, origin = 'default', headers = {} } = {}) {
  const h = { accept: 'application/json', ...headers };
  if (actor?.cookie) h.cookie = actor.cookie;
  const unsafe = !['GET', 'HEAD', 'OPTIONS'].includes(method);
  if (origin === 'default') {
    if (unsafe) h.origin = APP_ORIGIN;
  } else if (origin) {
    h.origin = origin;
  }
  if (body !== undefined) h['content-type'] = 'application/json';
  let res;
  try {
    res = await fetch(API + p, {
      method,
      headers: h,
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'manual',
      signal: AbortSignal.timeout(30_000),
    });
  } catch (e) {
    return { status: 0, text: '', json: undefined, error: e?.name ?? 'Error', setCookies: [] };
  }
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }
  return { status: res.status, text, json, setCookies: res.headers.getSetCookie?.() ?? [] };
}

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const uuidsIn = (text) => new Set((text.match(UUID_RE) ?? []).map((s) => s.toLowerCase()));
const lc = (v) => (v ? String(v).toLowerCase() : undefined);
/** `obj.<key>Id` or `obj.<key>.id`, lower-cased. */
const refId = (obj, key) => lc(obj?.[`${key}Id`] ?? obj?.[key]?.id);
const stripQuery = (p) => p.split('?')[0];

async function login(tenantSlug, email) {
  const r = await call(null, 'POST', '/auth/login', { body: { tenantSlug, email, password: PASSWORD } });
  const cookie = r.setCookies.map((s) => s.split(';')[0].trim()).find((s) => /^(__Host-)?educenter_session=/.test(s));
  return { status: r.status, cookie, principal: r.json?.principal };
}

// ───────────────────────────── Reference data (via admin) ─────────────────────────────

function newTenant(key) {
  return {
    key,
    slug: TENANTS[key],
    tenantId: undefined,
    allIds: new Set(), // every UUID seen in this tenant's admin responses
    students: new Map(), // id -> { id, email, status, code }
    teachers: new Map(), // id -> { id, email, status, code }
    courses: new Map(), // id -> { id }
    classrooms: new Map(), // id -> { id, code, name, teacherId, courseId, roster: Map(studentId -> enrollment status), sessions: [{id,status}], assessments: [id] }
    invoices: [], // { id, studentId, status }
    payments: [], // { id, studentId }
    materials: [], // { id, classroomId, courseId, visibility }
    jobs: [], // { id }
    warnings: [],
  };
}

async function refGet(T, admin, p, { optional = false } = {}) {
  const r = await call(admin, 'GET', p);
  if (r.status < 200 || r.status >= 300) {
    if (optional) {
      T.warnings.push(`GET ${stripQuery(p)} -> ${r.status}`);
      return undefined;
    }
    throw new SetupError(`${admin.name}: GET ${stripQuery(p)} returned ${r.status}`);
  }
  for (const id of uuidsIn(r.text)) T.allIds.add(id);
  return r.json;
}

async function refAll(T, admin, p, opts) {
  const out = [];
  for (let page = 1; page <= 200; page++) {
    const j = await refGet(T, admin, `${p}${p.includes('?') ? '&' : '?'}page=${page}&pageSize=100`, opts);
    if (j === undefined) return out;
    if (Array.isArray(j)) return j;
    if (!Array.isArray(j?.items)) return out;
    out.push(...j.items);
    if (page >= (j.meta?.totalPages ?? 1)) break;
  }
  return out;
}

async function loadTenant(T, admin) {
  T.tenantId = lc(admin.principal.tenantId);
  T.allIds.add(T.tenantId);
  for (const s of await refAll(T, admin, '/students')) T.students.set(lc(s.id), { id: lc(s.id), email: s.email, status: s.status, code: s.code });
  for (const t of await refAll(T, admin, '/teachers')) T.teachers.set(lc(t.id), { id: lc(t.id), email: t.email, status: t.status, code: t.code });
  for (const c of await refAll(T, admin, '/courses')) T.courses.set(lc(c.id), { id: lc(c.id) });
  await refGet(T, admin, '/rooms');
  for (const c of await refAll(T, admin, '/classrooms')) {
    const id = lc(c.id);
    const roster = new Map();
    for (const e of (await refGet(T, admin, `/classrooms/${id}/students`)) ?? []) roster.set(refId(e, 'student'), e.status);
    const sessions = ((await refGet(T, admin, `/classrooms/${id}/sessions`)) ?? []).map((s) => ({ id: lc(s.id), status: s.status }));
    const assessments = ((await refGet(T, admin, `/classrooms/${id}/assessments`)) ?? []).map((a) => lc(a.id));
    T.classrooms.set(id, { id, code: c.code, name: c.name, teacherId: refId(c, 'teacher'), courseId: refId(c, 'course'), roster, sessions, assessments });
  }
  T.invoices = (await refAll(T, admin, '/invoices')).map((i) => ({ id: lc(i.id), studentId: refId(i, 'student'), status: i.status }));
  T.payments = (await refAll(T, admin, '/payments', { optional: true })).map((x) => ({ id: lc(x.id), studentId: refId(x, 'student') ?? refId(x.invoice, 'student') }));
  await refAll(T, admin, '/enrollments', { optional: true });
  T.materials = (await refAll(T, admin, '/materials', { optional: true })).map((m) => ({ id: lc(m.id), classroomId: refId(m, 'classroom'), courseId: refId(m, 'course'), visibility: m.visibility }));
  T.jobs = (await refAll(T, admin, '/cloud/jobs', { optional: true })).map((j) => ({ id: lc(j.id) }));
}

// ───────────────────────────── Relations ─────────────────────────────

/** 'yes' | 'no' | 'unclear' (enrolled only with a DROPPED/CANCELLED enrollment). */
function enrollState(c, studentId) {
  const st = c?.roster.get(studentId);
  if (st === undefined) return 'no';
  return OK_ENROLLMENT.has(st) ? 'yes' : 'unclear';
}
const teaches = (c, teacherId) => (c?.teacherId && c.teacherId === teacherId ? 'yes' : 'no');
const classesOfTeacher = (T, teacherId) => [...T.classrooms.values()].filter((c) => c.teacherId === teacherId);
function anyRel(states) {
  if (states.includes('yes')) return 'yes';
  if (states.includes('unclear')) return 'unclear';
  return 'no';
}
const teacherHasStudent = (T, teacherId, studentId) => anyRel(classesOfTeacher(T, teacherId).map((c) => enrollState(c, studentId)));

/** Relation of a logged-in, same-tenant, non-admin actor to a target. */
function relation(actor, target) {
  const T = tenants[target.tenant];
  const isT = actor.role === 'TEACHER';
  const d = target.data;
  switch (target.res) {
    case 'classroom':
      return isT ? teaches(d, actor.teacherId) : enrollState(d, actor.studentId);
    case 'session':
    case 'assessment': {
      const c = T.classrooms.get(d.classroomId);
      return isT ? teaches(c, actor.teacherId) : enrollState(c, actor.studentId);
    }
    case 'student':
      return isT ? teacherHasStudent(T, actor.teacherId, d.id) : d.id === actor.studentId ? 'yes' : 'no';
    case 'teacher':
      return isT ? (d.id === actor.teacherId ? 'yes' : 'no') : anyRel(classesOfTeacher(T, d.id).map((c) => enrollState(c, actor.studentId)));
    case 'course': {
      const cls = [...T.classrooms.values()].filter((c) => c.courseId === d.id);
      return isT ? anyRel(cls.map((c) => teaches(c, actor.teacherId))) : anyRel(cls.map((c) => enrollState(c, actor.studentId)));
    }
    case 'invoice':
      return isT ? teacherHasStudent(T, actor.teacherId, d.studentId) : d.studentId === actor.studentId ? 'yes' : 'no';
    case 'material': {
      if (!d.classroomId) return 'unclear';
      const c = T.classrooms.get(d.classroomId);
      return isT ? teaches(c, actor.teacherId) : enrollState(c, actor.studentId);
    }
    default:
      return 'no';
  }
}

/** rel -> expectation: 'yes' gives `yes`, 'no' gives `no`, 'unclear' gives '?'. */
const by = (yes, no = D) => (rel) => (rel === 'yes' ? yes : rel === 'no' ? no : Q);
const always = (v) => () => v;

// ───────────────────────────── Route catalogue (GET) ─────────────────────────────
// Derived from apps/api/src/**/*.controller.ts and *.module.ts (commit c73c3b4).
// Expectations = business rules (README). anon defaults to DENY. ADMIN of the same tenant = ALLOW.

/** GET routes without a resource id. */
const LIST_ROUTES = [
  { route: '/health', anon: A, ADMIN: A, TEACHER: A, STUDENT: A },
  { route: '/health/live', anon: A, ADMIN: A, TEACHER: A, STUDENT: A },
  { route: '/auth/options', anon: A, ADMIN: A, TEACHER: A, STUDENT: A },
  { route: '/context', ADMIN: A, TEACHER: A, STUDENT: A },
  // Dev decision (Q9): 200 with an EMPTY items list for teachers/students.
  { route: '/context/personas', ADMIN: A, TEACHER: A, STUDENT: A, emptyItemsFor: ['TEACHER', 'STUDENT'] },
  { route: '/dashboard', ADMIN: A, TEACHER: A, STUDENT: A }, // Q3
  { route: '/students', ADMIN: A, TEACHER: A, STUDENT: A }, // Q12: student gets only self (leak check)
  { route: '/teachers', ADMIN: A, TEACHER: A, STUDENT: A }, // Q4
  { route: '/courses', ADMIN: A, TEACHER: A, STUDENT: A }, // Q4
  { route: '/rooms', ADMIN: A, TEACHER: A, STUDENT: A }, // Q4
  { route: '/classrooms', ADMIN: A, TEACHER: A, STUDENT: A },
  { route: '/schedule', ADMIN: A, TEACHER: A, STUDENT: A },
  { route: '/schedule/conflicts', ADMIN: A, TEACHER: D, STUDENT: D }, // Q8
  { route: '/enrollments', ADMIN: A, TEACHER: A, STUDENT: A }, // Q7 (scoped, leak check)
  { route: '/attendance/pending', ADMIN: A, TEACHER: A, STUDENT: D }, // Q8
  { route: '/attendance/history', ADMIN: A, TEACHER: A, STUDENT: A },
  { route: '/grade-bands', ADMIN: A, TEACHER: A, STUDENT: A }, // Q4
  { route: '/invoices', ADMIN: A, TEACHER: D, STUDENT: A },
  { route: '/payments', ADMIN: A, TEACHER: D, STUDENT: A },
  { route: '/tuition/summary', ADMIN: A, TEACHER: D, STUDENT: A },
  { route: '/materials', ADMIN: A, TEACHER: A, STUDENT: A },
  { route: '/notifications', ADMIN: A, TEACHER: A, STUDENT: A }, // Q3
  { route: '/notifications/unread-count', ADMIN: A, TEACHER: A, STUDENT: A }, // Q3
  { route: '/activity', ADMIN: A, TEACHER: D, STUDENT: D },
  ...['students', 'teachers', 'courses', 'classes', 'attendance', 'grades', 'revenue', 'debts'].map((kind) => ({
    route: '/reports/:kind',
    path: `/reports/${kind}`,
    idKind: `kind=${kind}`,
    ADMIN: A,
    TEACHER: D,
    STUDENT: D,
  })),
  ...['overview', 'storage', 'jobs', 'reconciler', 'metrics', 'logs', 'resources', 'cost'].map((x) => ({ route: `/cloud/${x}`, ADMIN: A, TEACHER: D, STUDENT: D })),
  // Token-authorised (signed URL), not session-authorised: only the "not logged in" rule applies.
  { route: '/storage/local/object', anonOnly: true },
];

/** GET routes with :id. T/S = expectation for TEACHER/STUDENT from their relation to the target. */
const ID_ROUTES = [
  { route: '/classrooms/:id', res: 'classroom', T: by(A), S: by(A) },
  // Q10: a student sees only themself in the roster, so classmate IDs are a FAIL here too.
  { route: '/classrooms/:id/students', res: 'classroom', T: by(A), S: by(A) },
  { route: '/classrooms/:id/sessions', res: 'classroom', T: by(A), S: by(A) },
  { route: '/classrooms/:id/assessments', res: 'classroom', T: by(A), S: by(A) },
  { route: '/classrooms/:id/gradebook', res: 'classroom', T: by(A), S: by(A) },
  { route: '/classrooms/:id/attendance-summary', res: 'classroom', T: by(A), S: by(A) }, // Q11
  { route: '/sessions/:id', res: 'session', T: by(A), S: by(A) },
  { route: '/sessions/:id/attendance', res: 'session', T: by(A), S: by(A) },
  { route: '/assessments/:id/grades', res: 'assessment', T: by(A), S: by(A) },
  { route: '/students/:id', res: 'student', T: by(A), S: by(A) },
  { route: '/students/:id/overview', res: 'student', T: by(A), S: by(A) },
  { route: '/students/:id/grades', res: 'student', T: by(A), S: by(A) },
  { route: '/students/:id/attendance-summary', res: 'student', T: by(A), S: by(A) },
  // Q5: teacher = own profile only; student = teachers of enrolled classes only.
  { route: '/teachers/:id', res: 'teacher', T: by(A), S: by(A) },
  { route: '/teachers/:id/overview', res: 'teacher', T: by(A), S: by(A) },
  // Q6: course of a class taught / enrolled only.
  { route: '/courses/:id', res: 'course', T: by(A), S: by(A) },
  { route: '/invoices/:id', res: 'invoice', T: always(D), S: by(A) },
  { route: '/materials/:id', res: 'material', T: by(A), S: by(A) },
  { route: '/materials/:id/history', res: 'material', T: by(A), S: always(Q), pending: 'Q13' },
  { route: '/materials/:id/access', res: 'material', query: '?kind=preview', T: by(A), S: by(A) },
  { route: '/cloud/jobs/:id', res: 'job', T: always(D), S: always(D) },
];

// ───────────────────────────── Fixtures ─────────────────────────────

const byCode = (a, b) => String(a.code ?? '').localeCompare(String(b.code ?? ''));

function pickFixtures(T) {
  const okTeacher = (id) => T.teachers.get(id)?.status === 'ACTIVE' && !!T.teachers.get(id)?.email;
  const okStudent = (id) => T.students.get(id)?.status === 'ACTIVE' && !!T.students.get(id)?.email;
  const classes = [...T.classrooms.values()].sort(byCode);
  const usable = (c) => c.teacherId && c.sessions.length > 0 && c.assessments.length > 0 && okTeacher(c.teacherId);

  let X;
  let Y;
  let S1;
  for (const x of classes.filter(usable)) {
    const ys = classes.filter((c) => c.id !== x.id && usable(c) && c.teacherId !== x.teacherId);
    for (const y of ys) {
      const s = [...x.roster].find(([sid, st]) => st === 'ACTIVE' && okStudent(sid) && !y.roster.has(sid));
      if (s) {
        X = x;
        Y = y;
        S1 = s[0];
        break;
      }
    }
    if (X) break;
  }
  if (!X) throw new SetupError(`${T.slug}: no class X / Y pair found (need two classes with different active teachers, sessions, assessments and an ACTIVE student only in X). Re-seed the database?`);

  const T1 = X.teacherId;
  const T2 = Y.teacherId;
  const s2Candidates = [...T.students.values()]
    .filter((s) => okStudent(s.id) && !X.roster.has(s.id))
    .map((s) => ({ s, score: (Y.roster.get(s.id) === 'ACTIVE' ? 2 : 0) + (teacherHasStudent(T, T1, s.id) === 'no' ? 4 : 0) }))
    .sort((a, b) => b.score - a.score || byCode(a.s, b.s));
  if (!s2Candidates.length) throw new SetupError(`${T.slug}: no ACTIVE student outside class ${X.code}`);
  const S2 = s2Candidates[0].s.id;
  const S3 = [...T.students.values()].filter((s) => s.status === 'INACTIVE' && s.email).sort(byCode)[0]?.id;

  const sessionOf = (c) => (c.sessions.find((s) => s.status === 'COMPLETED') ?? c.sessions[0]).id;
  const s1Courses = new Set([...T.classrooms.values()].filter((c) => c.roster.has(S1)).map((c) => c.courseId));
  const otherCourse = [...T.courses.keys()].find((id) => id === Y.courseId && !s1Courses.has(id)) ?? [...T.courses.keys()].find((id) => !s1Courses.has(id));
  const invoiceOf = (sid) => T.invoices.find((i) => i.studentId === sid && i.status !== 'CANCELLED') ?? T.invoices.find((i) => i.studentId === sid);
  const matX = T.materials.find((m) => m.classroomId === X.id);
  const matOther = T.materials.find((m) => m !== matX);

  return { X, Y, T1, T2, S1, S2, S3, sX: sessionOf(X), sY: sessionOf(Y), aX: X.assessments[0], aY: Y.assessments[0], cX: X.courseId, cY: otherCourse, invS1: invoiceOf(S1), invS2: invoiceOf(S2), matX, matOther };
}

/** First usable target of each kind in tenant B (only needs to exist). */
function pickOther(T) {
  const c = [...T.classrooms.values()].sort(byCode).find((x) => x.sessions.length && x.assessments.length) ?? [...T.classrooms.values()][0];
  return {
    classroom: c,
    session: c?.sessions[0]?.id,
    assessment: c?.assessments[0],
    student: [...T.students.values()].sort(byCode).find((s) => s.status === 'ACTIVE')?.id,
    teacher: [...T.teachers.values()].sort(byCode)[0]?.id,
    course: [...T.courses.keys()][0],
    invoice: T.invoices[0],
    material: T.materials[0],
    job: T.jobs[0]?.id,
  };
}

/** Targets per resource kind: [same-tenant X-side, same-tenant Y-side, other tenant]. */
function buildTargets(fx, other) {
  const tA = tenants.A;
  const t = (tenant, res, id, data, label) => (id ? { tenant, res, id, data: data ?? { id }, label } : { tenant, res, id: undefined, label });
  const sess = (tenant, id) => {
    const c = [...tenants[tenant].classrooms.values()].find((x) => x.sessions.some((s) => s.id === id));
    return { id, classroomId: c?.id };
  };
  const asmt = (tenant, id) => {
    const c = [...tenants[tenant].classrooms.values()].find((x) => x.assessments.includes(id));
    return { id, classroomId: c?.id };
  };
  return {
    classroom: [t('A', 'classroom', fx.X.id, fx.X, 'X'), t('A', 'classroom', fx.Y.id, fx.Y, 'Y'), t('B', 'classroom', other.classroom?.id, other.classroom, 'B')],
    session: [t('A', 'session', fx.sX, sess('A', fx.sX), 'X'), t('A', 'session', fx.sY, sess('A', fx.sY), 'Y'), t('B', 'session', other.session, sess('B', other.session), 'B')],
    assessment: [t('A', 'assessment', fx.aX, asmt('A', fx.aX), 'X'), t('A', 'assessment', fx.aY, asmt('A', fx.aY), 'Y'), t('B', 'assessment', other.assessment, asmt('B', other.assessment), 'B')],
    student: [t('A', 'student', fx.S1, tA.students.get(fx.S1), 'studentIn'), t('A', 'student', fx.S2, tA.students.get(fx.S2), 'studentOut'), t('B', 'student', other.student, undefined, 'B')],
    teacher: [t('A', 'teacher', fx.T1, tA.teachers.get(fx.T1), 'teacherAssigned'), t('A', 'teacher', fx.T2, tA.teachers.get(fx.T2), 'teacherOther'), t('B', 'teacher', other.teacher, undefined, 'B')],
    course: [t('A', 'course', fx.cX, { id: fx.cX }, 'course(X)'), t('A', 'course', fx.cY, { id: fx.cY }, 'course(other)'), t('B', 'course', other.course, undefined, 'B')],
    invoice: [t('A', 'invoice', fx.invS1?.id, fx.invS1, 'invoice(studentIn)'), t('A', 'invoice', fx.invS2?.id, fx.invS2, 'invoice(studentOut)'), t('B', 'invoice', other.invoice?.id, other.invoice, 'B')],
    material: [t('A', 'material', fx.matX?.id, fx.matX, 'material(X)'), t('A', 'material', fx.matOther?.id, fx.matOther, 'material(other)'), t('B', 'material', other.material?.id, other.material, 'B')],
    job: [t('A', 'job', tA.jobs[0]?.id, undefined, 'job(A)'), t('A', 'job', undefined, undefined, '-'), t('B', 'job', other.job, undefined, 'B')],
  };
}

// ───────────────────────────── Leak detection ─────────────────────────────

/** ID sets the actor must never receive. verdict FAIL = forbidden by the rules; '?' = rule unclear. */
function buildLeakSets(actor) {
  if (!actor.role) return [];
  const own = tenants[actor.tenant];
  const other = tenants[actor.tenant === 'A' ? 'B' : 'A'];
  const sets = [{ label: 'otherTenant', ids: other.allIds, verdict: FAIL }];
  const classes = [...own.classrooms.values()];
  const classIds = (cs) => new Set(cs.flatMap((c) => [c.id, ...c.sessions.map((s) => s.id), ...c.assessments]));

  if (actor.role === 'TEACHER') {
    const mine = classesOfTeacher(own, actor.teacherId);
    const inScope = new Set(mine.flatMap((c) => [...c.roster.keys()]));
    sets.push({ label: 'studentOutOfScope', ids: new Set([...own.students.keys()].filter((id) => !inScope.has(id))), verdict: FAIL });
    sets.push({ label: 'tuition', ids: new Set([...own.invoices, ...own.payments].map((x) => x.id)), verdict: FAIL });
    sets.push({ label: 'classNotTaught', ids: classIds(classes.filter((c) => c.teacherId !== actor.teacherId)), verdict: Q });
  }
  if (actor.role === 'STUDENT') {
    const me = actor.studentId;
    const mine = classes.filter((c) => c.roster.has(me));
    const classmates = new Set(mine.flatMap((c) => [...c.roster.keys()]).filter((id) => id !== me));
    sets.push({ label: 'otherStudent', ids: new Set([...own.students.keys()].filter((id) => id !== me && !classmates.has(id))), verdict: FAIL });
    sets.push({ label: 'classmate', ids: classmates, verdict: FAIL });
    sets.push({ label: 'otherTuition', ids: new Set([...own.invoices, ...own.payments].filter((x) => x.studentId && x.studentId !== me).map((x) => x.id)), verdict: FAIL });
    sets.push({ label: 'classNotEnrolled', ids: classIds(classes.filter((c) => !c.roster.has(me))), verdict: FAIL });
  }
  return sets;
}

function findLeaks(actor, text) {
  if (!actor.leakSets?.length || !text) return [];
  const found = uuidsIn(text);
  const out = [];
  for (const set of actor.leakSets) {
    let n = 0;
    for (const id of found) if (set.ids.has(id)) n++;
    if (n) out.push({ label: set.label, count: n, verdict: set.verdict });
  }
  return out;
}

/** Which open question makes an :id row "?". */
function pendingFor(target, spec) {
  if (spec.pending) return PENDING[spec.pending];
  if (target.res === 'material' && !target.data?.classroomId) return PENDING.Q13;
  return PENDING.Q14; // relation 'unclear' = only a DROPPED/CANCELLED enrollment links them
}

// ───────────────────────────── Evaluation ─────────────────────────────

function bodyHasData(r, targetId) {
  if (r.status >= 200 && r.status < 300) {
    const j = r.json;
    if (j === undefined) return r.text.trim().length > 0;
    if (Array.isArray(j)) return j.length > 0;
    if (j && typeof j === 'object') return Array.isArray(j.items) ? j.items.length > 0 : Object.keys(j).length > 0;
    return j !== null && j !== '';
  }
  return !!targetId && r.text.toLowerCase().includes(targetId);
}

/** Status-level verdict; leaks are applied on top. */
function judge(expected, status, hasData, requireStatus) {
  if (status === 0) return { result: Q, note: 'network error / timeout' };
  const ok = status >= 200 && status < 300;
  if (expected === D) {
    if (requireStatus) return status === requireStatus && !hasData ? { result: PASS } : { result: FAIL, note: `expected ${requireStatus}` };
    if (DENY_STATUSES.has(status) && !hasData) return { result: PASS };
    if (ok) return { result: FAIL, note: hasData ? 'served' : '2xx (empty) instead of refusal' };
    if (DENY_STATUSES.has(status)) return { result: FAIL, note: 'refused but body has resource data' };
    return { result: Q, note: `inconclusive status` };
  }
  if (expected === A) {
    if (ok) return { result: PASS };
    if (DENY_STATUSES.has(status)) return { result: FAIL, note: 'refused but rules allow' };
    return { result: Q, note: 'inconclusive status' };
  }
  return { result: Q };
}

const rows = [];

function record({ route, method = 'GET', actor, idKind = '-', expected, r, targetId, requireStatus, requireEmptyItems, extraNote }) {
  if (!r) {
    rows.push({ route, method, actor: actor.name ?? actor, idKind, expected, status: '-', bodyHasData: '-', result: SKIP, note: extraNote ?? '' });
    return;
  }
  const hasData = bodyHasData(r, targetId);
  let { result, note } = judge(expected, r.status, hasData, requireStatus);
  if (requireEmptyItems && result === PASS && !(Array.isArray(r.json?.items) && r.json.items.length === 0)) {
    result = FAIL;
    note = 'items must be empty';
  }
  const leaks = typeof actor === 'object' ? findLeaks(actor, r.text) : [];
  if (leaks.some((l) => l.verdict === FAIL)) result = FAIL;
  else if (leaks.length && result === PASS) result = Q;
  const bug = result === FAIL ? KNOWN_BUGS[route] : '';
  const notes = [note, leaks.length ? `leak:${leaks.map((l) => `${l.label}=${l.count}`).join(',')}` : '', bug, extraNote].filter(Boolean);
  rows.push({ route, method, actor: actor.name ?? actor, idKind, expected, status: String(r.status), bodyHasData: hasData ? 'yes' : 'no', result, note: notes.join('; ') });
}

function expectedFor(actor, target, spec) {
  if (!actor.role) return D;
  if (target.tenant !== actor.tenant) return D;
  if (actor.role === 'ADMIN') return A;
  const rel = relation(actor, target);
  return (actor.role === 'TEACHER' ? spec.T : spec.S)(rel);
}

function idKindFor(actor, target) {
  if (!actor.role) return 'n/a';
  if (target.tenant !== actor.tenant) return 'otherTenant';
  if (actor.role === 'ADMIN') return 'sameTenant';
  return relation(actor, target) === 'yes' ? 'own' : 'sameTenant';
}

// ───────────────────────────── Route discovery (coverage check) ─────────────────────────────

function walk(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (/\.(controller|module)\.ts$/.test(e.name)) out.push(p);
  }
  return out;
}

/** GET routes declared in the source, params normalised to their names (`:id`, `:kind`). */
function discoverGetRoutes() {
  if (!existsSync(API_SRC)) return undefined;
  const found = new Set();
  const re = /@(Controller|Get)\(\s*(?:'([^']*)'|"([^"]*)")?\s*\)/g;
  for (const file of walk(API_SRC)) {
    const text = readFileSync(file, 'utf8');
    let prefix = '';
    for (const m of text.matchAll(re)) {
      const arg = m[2] ?? m[3] ?? '';
      if (m[1] === 'Controller') prefix = arg;
      else found.add('/' + [prefix, arg].filter(Boolean).join('/'));
    }
  }
  return found;
}

// ───────────────────────────── Output ─────────────────────────────

const COLUMNS = ['route', 'method', 'actor', 'idKind', 'expected', 'status', 'bodyHasData', 'result', 'note'];

function printTable(list) {
  const w = COLUMNS.map((c) => Math.min(60, Math.max(c.length, ...list.map((r) => String(r[c]).length))));
  const line = (vals) => vals.map((v, i) => String(v).slice(0, w[i]).padEnd(w[i])).join(' | ');
  console.log(line(COLUMNS));
  console.log(w.map((n) => '-'.repeat(n)).join('-+-'));
  for (const r of list) console.log(line(COLUMNS.map((c) => r[c])));
}

function writeCsv(list) {
  const esc = (v) => {
    const s = String(v ?? '');
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  mkdirSync(OUT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(OUT_DIR, `authz-matrix-${stamp}.csv`);
  writeFileSync(file, [COLUMNS.join(','), ...list.map((r) => COLUMNS.map((c) => esc(r[c])).join(','))].join('\r\n') + '\r\n', 'utf8');
  return file;
}

// ───────────────────────────── Main ─────────────────────────────

const tenants = { A: newTenant('A'), B: newTenant('B') };
const actors = [];

async function main() {
  console.log(`authz-matrix → ${BASE_URL}  (writes: ${INCLUDE_WRITES ? 'ON' : 'off'})`);
  const rel = path.relative(REPO_ROOT, OUT_DIR);
  if (!rel.startsWith('..') && !path.isAbsolute(rel)) console.warn(`WARNING: OUT_DIR is inside the repository (${OUT_DIR}).`);

  const options = await call(null, 'GET', '/auth/options');
  if (options.status !== 200) throw new SetupError(`GET /auth/options returned ${options.status} — is the API running at ${BASE_URL}?`);
  const authMode = options.json?.authMode;
  const demoNote = authMode === 'demo' ? 'AUTH_MODE=demo: requests without a session get a demo principal' : '';
  if (demoNote) console.warn(`WARNING: ${demoNote}. Anonymous rows will reflect that.`);

  // Admins first: they provide the reference IDs.
  const anonymous = { name: 'anonymous' };
  const loginActor = async (name, tenant, email, role, idField) => {
    const r = await login(TENANTS[tenant], email);
    if (r.status !== 200 || !r.cookie || !r.principal) throw new SetupError(`login failed for ${name} (${email}): status ${r.status}`);
    if (r.principal.role !== role || r.principal.tenantSlug !== TENANTS[tenant]) throw new SetupError(`${name} logged in with unexpected role/tenant`);
    const actor = { name, tenant, role, email, cookie: r.cookie, principal: r.principal, teacherId: lc(r.principal.teacherId), studentId: lc(r.principal.studentId) };
    if (idField && !actor[idField]) throw new SetupError(`${name}: principal has no ${idField}`);
    return actor;
  };
  const adminA = await loginActor('adminA', 'A', `admin@${TENANTS.A}.edu.example`, 'ADMIN');
  const adminB = await loginActor('adminB', 'B', `admin@${TENANTS.B}.edu.example`, 'ADMIN');
  await loadTenant(tenants.A, adminA);
  await loadTenant(tenants.B, adminB);

  const fx = pickFixtures(tenants.A);
  const other = pickOther(tenants.B);
  const email = (map, id) => map.get(id)?.email?.toLowerCase();
  const teacherAssigned = await loginActor('teacherAssigned', 'A', email(tenants.A.teachers, fx.T1), 'TEACHER', 'teacherId');
  const teacherOther = await loginActor('teacherOther', 'A', email(tenants.A.teachers, fx.T2), 'TEACHER', 'teacherId');
  const studentIn = await loginActor('studentIn', 'A', email(tenants.A.students, fx.S1), 'STUDENT', 'studentId');
  const studentOut = await loginActor('studentOut', 'A', email(tenants.A.students, fx.S2), 'STUDENT', 'studentId');
  if (teacherAssigned.teacherId !== fx.T1 || studentIn.studentId !== fx.S1) throw new SetupError('logged-in profile does not match the selected fixture');

  actors.push(anonymous, adminA, adminB, teacherAssigned, teacherOther, studentIn, studentOut);
  for (const a of actors) a.leakSets = buildLeakSets(a);

  console.log(`\nClass X = ${fx.X.code}, class Y = ${fx.Y.code}`);
  console.log('Actors:');
  for (const a of actors) console.log(`  ${a.name.padEnd(16)} ${a.email ?? '(no session)'}`);
  const warnings = [...tenants.A.warnings.map((w) => `A: ${w}`), ...tenants.B.warnings.map((w) => `B: ${w}`)];
  if (!fx.matX && !fx.matOther) warnings.push('tenant A has no materials: /materials/:id rows are SKIP');
  if (!tenants.A.jobs.length) warnings.push('tenant A has no processing jobs: /cloud/jobs/:id same-tenant rows are SKIP');
  for (const w of warnings) console.warn(`  note: ${w}`);

  // ── Separate check: can an INACTIVE student sign in?
  if (fx.S3) {
    const inactiveEmail = email(tenants.A.students, fx.S3);
    console.log(`  ${'studentInactive'.padEnd(16)} ${inactiveEmail} (login check only)`);
    const r = await login(TENANTS.A, inactiveEmail);
    const ok = r.status === 200 && !!r.cookie;
    rows.push({ route: '/auth/login', method: 'POST', actor: 'studentInactive', idKind: '-', expected: Q, status: String(r.status), bodyHasData: r.principal ? 'yes' : 'no', result: Q, note: `${ok ? 'INACTIVE student CAN sign in' : 'INACTIVE student cannot sign in'}; ${PENDING.Q1}` });
    if (r.cookie) await call({ cookie: r.cookie }, 'POST', '/auth/logout');
  } else {
    rows.push({ route: '/auth/login', method: 'POST', actor: 'studentInactive', idKind: '-', expected: Q, status: '-', bodyHasData: '-', result: SKIP, note: 'no INACTIVE student with an email' });
  }

  // ── GET matrix: list routes
  for (const spec of LIST_ROUTES) {
    for (const actor of actors) {
      if (spec.anonOnly && actor.role) continue;
      const expected = actor.role ? spec[actor.role] : spec.anon ?? D;
      const r = await call(actor, 'GET', spec.path ?? spec.route);
      const requireEmptyItems = !!spec.emptyItemsFor?.includes(actor.role);
      record({ route: spec.route, actor, idKind: spec.idKind ?? '-', expected, r, requireEmptyItems, extraNote: [requireEmptyItems ? 'items must be empty' : '', !actor.role ? demoNote : ''].filter(Boolean).join('; ') });
    }
  }

  // ── GET matrix: :id routes
  const targets = buildTargets(fx, other);
  for (const spec of ID_ROUTES) {
    const [tx, ty, tb] = targets[spec.res];
    for (const actor of actors) {
      // anonymous: one same-tenant id is enough; admins: own tenant + other tenant; others: all three.
      const list = (!actor.role ? [tx] : actor.role === 'ADMIN' ? (actor.tenant === 'A' ? [tx, tb] : [tb, tx]) : [tx, ty, tb]).filter((t) => t.label !== '-');
      for (const target of list) {
        if (!target?.id) {
          record({ route: spec.route, actor, idKind: target ? idKindFor(actor, { ...target, data: {} }) : '-', expected: '-', extraNote: `no ${spec.res} fixture (${target?.label ?? '-'})` });
          continue;
        }
        const expected = expectedFor(actor, target, spec);
        const r = await call(actor, 'GET', spec.route.replace(':id', target.id) + (spec.query ?? ''));
        const pending = expected === Q ? pendingFor(target, spec) : '';
        record({ route: spec.route, actor, idKind: idKindFor(actor, target), expected, r, targetId: target.id, extraNote: [`target=${target.label}`, pending, !actor.role ? demoNote : ''].filter(Boolean).join('; ') });
      }
    }
  }

  // ── Writes that MUST be refused (localhost only)
  if (INCLUDE_WRITES) await runWrites({ fx, adminA, adminB, teacherAssigned, teacherOther, studentIn, anonymous });

  // ── Coverage: GET routes in the source that this catalogue does not know
  const known = new Set([...LIST_ROUTES.map((s) => s.route), ...ID_ROUTES.map((s) => s.route)]);
  const discovered = discoverGetRoutes();
  let coverage = 'source not found, coverage not checked';
  if (discovered) {
    const missing = [...discovered].filter((r) => !known.has(r)).sort();
    for (const route of missing) rows.push({ route, method: 'GET', actor: '-', idKind: '-', expected: Q, status: '-', bodyHasData: '-', result: Q, note: 'GET route in source but not in the matrix: add rules' });
    coverage = `${[...discovered].filter((r) => known.has(r)).length}/${discovered.size} GET routes from source covered${missing.length ? `; NOT covered: ${missing.join(', ')}` : ''}`;
  }

  // ── Clean up our sessions
  for (const a of actors) if (a.cookie) await call(a, 'POST', '/auth/logout');

  printTable(rows);
  const count = (x) => rows.filter((r) => r.result === x).length;
  console.log(`\nRows: ${rows.length}  PASS ${count(PASS)}  FAIL ${count(FAIL)}  ? ${count(Q)}  SKIP ${count(SKIP)}`);
  console.log(`Coverage: ${coverage}`);
  console.log(`CSV: ${writeCsv(rows)}`);
  process.exitCode = count(FAIL) > 0 ? 1 : 0;
}

/** Write probes. Bodies are valid and, where possible, no-ops (current values written back). */
async function runWrites({ fx, adminA, adminB, teacherAssigned, teacherOther, studentIn, anonymous }) {
  const get = async (p) => {
    const r = await call(adminA, 'GET', p);
    return r.status === 200 ? r.json : undefined;
  };
  const s1 = await get(`/students/${fx.S1}`);
  const s2 = await get(`/students/${fx.S2}`);
  const invS1 = fx.invS1 ? await get(`/invoices/${fx.invS1.id}`) : undefined;
  const invS2 = fx.invS2 ? await get(`/invoices/${fx.invS2.id}`) : undefined;
  const bands = await get('/grade-bands');
  const sheetY = await get(`/assessments/${fx.aY}/grades`);
  const gradeRow = sheetY?.rows?.find((x) => x.score !== null && x.score !== undefined);
  const attX = await get(`/sessions/${fx.sX}/attendance`);
  const attRow = attX?.rows?.find((x) => x.status);

  const probes = [
    { actor: studentIn, method: 'POST', route: '/students', body: { fullName: 'Authz Probe' } },
    fx.invS1 && { actor: studentIn, method: 'POST', route: '/invoices/:id/payments', id: fx.invS1.id, idKind: 'own', body: { amountVnd: '1000', method: 'CASH' }, headers: { 'idempotency-key': randomUUID() } },
    bands && { actor: studentIn, method: 'PUT', route: '/grade-bands', body: { bands } },
    { actor: studentIn, method: 'POST', route: '/cloud/reconciler/run' },
    { actor: teacherAssigned, method: 'POST', route: '/enrollments', body: { classroomId: fx.X.id, studentId: fx.S2, createInvoice: false } },
    invS1 && { actor: teacherAssigned, method: 'PATCH', route: '/invoices/:id', id: fx.invS1.id, idKind: 'sameTenant', body: { description: invS1.description } },
    gradeRow
      ? { actor: teacherAssigned, method: 'PUT', route: '/assessments/:id/grades', id: fx.aY, idKind: 'sameTenant', note: 'class not taught', body: { grades: [{ studentId: refId(gradeRow, 'student'), score: gradeRow.score, ...(gradeRow.comment ? { comment: gradeRow.comment } : {}), version: gradeRow.version }] } }
      : { skip: 'no graded row in class Y', actor: teacherAssigned, method: 'PUT', route: '/assessments/:id/grades' },
    attRow
      ? { actor: teacherOther, method: 'PUT', route: '/sessions/:id/attendance', id: fx.sX, idKind: 'sameTenant', note: 'class not taught', body: { records: [{ studentId: refId(attRow, 'student'), status: attRow.status, ...(attRow.note ? { note: attRow.note } : {}) }], markCompleted: false } }
      : { skip: 'no attendance row in class X', actor: teacherOther, method: 'PUT', route: '/sessions/:id/attendance' },
    s2 && { actor: adminB, method: 'PATCH', route: '/students/:id', id: fx.S2, idKind: 'otherTenant', body: { fullName: s2.fullName } },
    { actor: adminB, method: 'PATCH', route: '/classrooms/:id', id: fx.X.id, idKind: 'otherTenant', body: { name: fx.X.name } },
    invS2 && { actor: adminB, method: 'PATCH', route: '/invoices/:id', id: fx.invS2.id, idKind: 'otherTenant', body: { description: invS2.description } },
    s1 && { actor: adminA, method: 'PATCH', route: '/students/:id', id: fx.S1, idKind: 'sameTenant', origin: EVIL_ORIGIN, requireStatus: 403, note: `Origin: ${EVIL_ORIGIN}`, body: { fullName: s1.fullName } },
    s1 && { actor: adminA, method: 'PATCH', route: '/students/:id', id: fx.S1, idKind: 'sameTenant', origin: null, expected: Q, note: `no Origin header; ${PENDING.Q2}`, body: { fullName: s1.fullName } },
    { actor: anonymous, method: 'POST', route: '/students', idKind: 'n/a', body: { fullName: 'Authz Probe' } },
  ].filter(Boolean);

  for (const p of probes) {
    if (p.skip) {
      record({ route: p.route, method: p.method, actor: p.actor, expected: D, extraNote: p.skip });
      continue;
    }
    const r = await call(p.actor, p.method, p.route.replace(':id', p.id ?? ''), { body: p.body, origin: p.origin === undefined ? 'default' : p.origin, headers: p.headers });
    const ok = r.status >= 200 && r.status < 300;
    record({ route: p.route, method: p.method, actor: p.actor, idKind: p.idKind ?? '-', expected: p.expected ?? D, r, targetId: p.id, requireStatus: p.requireStatus, extraNote: [p.note, ok && (p.expected ?? D) === D ? 'WRITE ACCEPTED — data may have changed' : ''].filter(Boolean).join('; ') });
  }
}

main().catch((e) => {
  if (e instanceof SetupError) fatal(`setup: ${e.message}`);
  fatal(`unexpected error: ${e?.stack ?? e}`);
});
