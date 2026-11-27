#!/usr/bin/env node
/**
 * Role journeys with REAL login (AUTH_MODE=session) — tester: Dương.
 * Read-only: safe against local AND the Azure demo. Each journey logs in through /auth/login and walks
 * the screens a user of that role opens, checking status codes and that the data is in scope.
 * (tests/e2e/integration-flow.mjs needs AUTH_MODE=demo — see BUG-01.)
 *
 *   $env:BASE_URL = "http://localhost:3000"   # or https://<app>.azurewebsites.net
 *   $env:TEST_PASSWORD = "<seed password>"    # local default Demo@12345
 *   node tests/e2e/role-journeys.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execSync } from 'node:child_process';
import { API, BASE_URL, IS_LOCAL, Session, TENANT_A, TEST_PASSWORD, itemsOf } from '../security/lib/client.mjs';

if (!TEST_PASSWORD) {
  console.error('TEST_PASSWORD is required for a non-local BASE_URL.');
  process.exit(2);
}
let sha = 'unknown';
try {
  sha = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
} catch {}

const results = [];
const timings = [];
function check(journey, step, ok, detail = '') {
  results.push({ journey, step, result: ok ? 'PASS' : 'FAIL', detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  [${journey}] ${step}${detail ? `  — ${detail}` : ''}`);
}
async function get(s, journey, path) {
  const r = await s.call('GET', path);
  timings.push({ journey, path: path.replace(/[0-9a-f-]{36}/g, ':id').replace(/\?.*$/, ''), ms: r.ms, status: r.status });
  return r;
}

console.log(`EduCenter role journeys → ${API} (${IS_LOCAL ? 'LOCAL' : 'REMOTE'}, sha ${sha})\n`);

// ---------------------------------------------------------------- Admin
const admin = new Session('admin');
const la = await admin.login(TENANT_A, `admin@${TENANT_A}.edu.example`);
check('Admin', 'login', la.status === 200 && la.json?.principal?.role === 'ADMIN', `${la.status}`);
if (la.status !== 200) {
  console.error('Admin login failed — stop.');
  process.exit(2);
}
for (const [step, path] of [
  ['dashboard', '/dashboard'], ['students', '/students?pageSize=20'], ['teachers', '/teachers?pageSize=20'], ['courses', '/courses?pageSize=20'],
  ['classrooms', '/classrooms?pageSize=20'], ['schedule (week)', '/schedule'], ['enrollments', '/enrollments?pageSize=20'], ['invoices', '/invoices?pageSize=20'],
  ['tuition summary', '/tuition/summary'], ['payments', '/payments?pageSize=20'], ['notifications', '/notifications'], ['activity log', '/activity?pageSize=20'],
  ['report: debts', '/reports/debts'], ['materials', '/materials?pageSize=20'],
]) {
  const r = await get(admin, 'Admin', path);
  check('Admin', step, r.status === 200, `${r.status} ${Math.round(r.ms)}ms`);
}

const students = itemsOf(await admin.call('GET', '/students?status=ACTIVE&pageSize=100')).filter((s) => s.email);
const teachers = itemsOf(await admin.call('GET', '/teachers?pageSize=100')).filter((t) => t.email);
const classes = itemsOf(await admin.call('GET', '/classrooms?pageSize=100'));

// pick a class that has a teacher and at least one enrolled student with a login
let pick;
for (const c of classes) {
  const t = teachers.find((x) => x.id === (c.teacherId ?? c.teacher?.id));
  if (!t) continue;
  const roster = itemsOf(await admin.call('GET', `/classrooms/${c.id}/students`));
  const enrolledIds = new Set(roster.map((r) => r.student?.id ?? r.studentId ?? r.id));
  const st = students.find((s) => enrolledIds.has(s.id));
  if (st) {
    pick = { c, t, st, enrolledIds };
    break;
  }
}
if (!pick) {
  check('Setup', 'find class with teacher + enrolled student', false, 'none found');
} else {
  console.log(`\nClass ${pick.c.code} · teacher ${pick.t.email} · student ${pick.st.email}\n`);

  // ---------------------------------------------------------------- Teacher
  const teacher = new Session('teacher');
  const lt = await teacher.login(TENANT_A, pick.t.email);
  check('Teacher', 'login', lt.status === 200 && lt.json?.principal?.role === 'TEACHER', `${lt.status}`);
  const myClasses = itemsOf(await get(teacher, 'Teacher', '/classrooms?pageSize=100'));
  check('Teacher', 'sees own class', myClasses.some((c) => c.id === pick.c.id), `${myClasses.length} class(es)`);
  check('Teacher', 'sees ONLY own classes', myClasses.every((c) => (c.teacherId ?? c.teacher?.id) === pick.t.id), '');
  const sessions = itemsOf(await get(teacher, 'Teacher', `/classrooms/${pick.c.id}/sessions`));
  check('Teacher', 'class sessions', sessions.length > 0, `${sessions.length}`);
  if (sessions[0]) {
    const att = await get(teacher, 'Teacher', `/sessions/${sessions[0].id}/attendance`);
    check('Teacher', 'open attendance sheet', att.status === 200, `${att.status}`);
  }
  const gb = await get(teacher, 'Teacher', `/classrooms/${pick.c.id}/gradebook`);
  check('Teacher', 'gradebook', gb.status === 200, `${gb.status}`);
  const pending = await get(teacher, 'Teacher', '/attendance/pending');
  check('Teacher', 'pending attendance list', pending.status === 200, `${pending.status}`);
  const dashT = await get(teacher, 'Teacher', '/dashboard');
  check('Teacher', 'dashboard', dashT.status === 200, `${dashT.status}`);
  const inv = await teacher.call('GET', '/invoices');
  check('Teacher', 'NO tuition access', inv.status === 403, `${inv.status}`);

  // ---------------------------------------------------------------- Student
  const student = new Session('student');
  const ls = await student.login(TENANT_A, pick.st.email);
  check('Student', 'login', ls.status === 200 && ls.json?.principal?.role === 'STUDENT', `${ls.status}`);
  const sid = ls.json?.principal?.studentId ?? pick.st.id;
  const dashS = await get(student, 'Student', '/dashboard');
  check('Student', 'dashboard', dashS.status === 200, `${dashS.status}`);
  const sched = await get(student, 'Student', '/schedule');
  check('Student', 'schedule', sched.status === 200, `${sched.status}`);
  const grades = await get(student, 'Student', `/students/${sid}/grades`);
  check('Student', 'own grades', grades.status === 200, `${grades.status}`);
  const attS = await get(student, 'Student', `/students/${sid}/attendance-summary`);
  check('Student', 'own attendance', attS.status === 200, `${attS.status}`);
  const invS = itemsOf(await get(student, 'Student', '/invoices?pageSize=100'));
  check('Student', 'only own invoices', invS.every((i) => (i.studentId ?? i.student?.id) === sid), `${invS.length} invoice(s)`);
  const myCls = itemsOf(await get(student, 'Student', '/classrooms?pageSize=100'));
  check('Student', 'sees enrolled class', myCls.some((c) => c.id === pick.c.id), `${myCls.length} class(es)`);
  const mats = await get(student, 'Student', '/materials?pageSize=50');
  check('Student', 'materials list', mats.status === 200, `${mats.status}, ${itemsOf(mats).length} item(s)`);
  const other = students.find((s) => s.id !== sid);
  if (other) {
    const r = await student.call('GET', `/students/${other.id}/grades`);
    check('Student', "cannot open another student's grades", r.status === 403 || r.status === 404, `${r.status}`);
  }
  const lo = await student.logout();
  const after = await student.call('GET', '/dashboard');
  check('Student', 'logout ends the session', (lo.status === 204 || lo.status === 200) && after.status === 401, `${lo.status}/${after.status}`);
}

// ---------------------------------------------------------------- report
const fail = results.filter((r) => r.result === 'FAIL').length;
console.log(`\n${results.length - fail}/${results.length} steps passed`);
const sorted = timings.map((t) => t.ms).sort((a, b) => a - b);
const pct = (p) => (sorted.length ? Math.round(sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)]) : 0);
console.log(`Response time over ${sorted.length} GETs: p50 ${pct(0.5)} ms · p95 ${pct(0.95)} ms · max ${Math.round(sorted.at(-1) ?? 0)} ms`);

const outDir = resolve(process.env.OUT_DIR ?? '../EduCenter-test-results');
mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
writeFileSync(resolve(outDir, `e2e-roles-${stamp}.md`), [
  `# E2E role journeys — ${IS_LOCAL ? 'LOCAL' : 'REMOTE'}`,
  '',
  `Target \`${BASE_URL}\` · commit \`${sha}\` · ${new Date().toISOString()}`,
  '',
  `**${results.length - fail}/${results.length} steps passed** · GET latency p50 ${pct(0.5)} ms, p95 ${pct(0.95)} ms (${sorted.length} requests, client-side)`,
  '',
  '| Journey | Step | Result | Detail |',
  '|---|---|---|---|',
  ...results.map((r) => `| ${r.journey} | ${r.step} | **${r.result}** | ${r.detail} |`),
  '',
].join('\n'));
console.log(`Saved: ${resolve(outDir, `e2e-roles-${stamp}.md`)}`);
process.exit(fail ? 1 : 0);
