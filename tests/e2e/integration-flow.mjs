#!/usr/bin/env node
/**
 * Priority integration flow (education + cloud), against a RUNNING API:
 *   1 create course → 2 create class (timetable + generated sessions) → 3 create student →
 *   4 enroll → 5 upload a PDF for the course (policy → direct upload to quarantine) →
 *   6/7 processing (LOCAL MOCK worker or Function Compute) → 8 preview stored →
 *   9 READY via HMAC callback → 10 visible in the course materials as the enrolled STUDENT →
 *   11 preview URL → 12 download (bytes identical) → 13 activity + telemetry recorded.
 * Also: a non-PDF upload is REJECTED; a forged callback is refused (401).
 *
 *   node tests/e2e/integration-flow.mjs            (BASE_URL defaults to http://127.0.0.1:3000)
 *
 * Exits non-zero on the first failed check. Creates uniquely-coded demo rows (safe to re-run).
 */
const BASE = (process.env.BASE_URL ?? 'http://127.0.0.1:3000').replace(/\/$/, '');
const API = `${BASE}/api/v1`;
const RUN = Date.now().toString(36).toUpperCase().slice(-5);
// Unique weekly slot per run so repeated runs do not collide with earlier E2E classes.
const SLOT_DAY = 1 + (Date.now() % 7);
const SLOT_HOUR = 5 + (Math.floor(Date.now() / 7) % 2);
const SLOT_MIN = ['00', '15', '30', '45'][Math.floor(Date.now() / 14) % 4];
const results = [];
let cookie = '';

function check(name, cond, detail = '') {
  results.push({ name, ok: Boolean(cond), detail });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
  if (!cond) {
    console.log(`\n${results.filter((r) => r.ok).length}/${results.length} checks passed`);
    process.exit(1);
  }
}

async function call(method, path, body, headers = {}) {
  const res = await fetch(path.startsWith('http') ? path : `${API}${path}`, {
    method,
    headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}), origin: process.env.APP_ORIGIN ?? 'http://localhost:5173', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, json, headers: res.headers };
}

/** Minimal valid multi-page PDF with a correct xref table. */
function makePdf(title, pages) {
  const objects = [];
  const kids = [];
  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  objects.push(null); // pages, filled below
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  for (let i = 0; i < pages; i++) {
    const content = `BT /F1 24 Tf 72 720 Td (EduCenter ${title} - page ${i + 1}) Tj ET`;
    objects.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    const contentRef = objects.length;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentRef} 0 R >>`);
    kids.push(`${objects.length} 0 R`);
  }
  objects[1] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${pages} >>`;
  objects.push(`<< /Title (${title}) /Author (EduCenter E2E) >>`);
  const infoRef = objects.length;
  let out = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info ${infoRef} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

async function uploadTo(target, bytes, filename) {
  const form = new FormData();
  for (const [k, v] of Object.entries(target.fields)) form.append(k, v);
  form.append(target.fileField, new Blob([bytes], { type: 'application/pdf' }), filename);
  const url = target.url.startsWith('http') ? target.url : `${BASE}${target.url}`;
  const res = await fetch(url, { method: 'POST', body: form });
  return res.status;
}

async function waitFor(path, done, timeoutMs = 60_000) {
  const until = Date.now() + timeoutMs;
  let last;
  while (Date.now() < until) {
    last = await call('GET', path);
    if (done(last.json)) return last.json;
    await new Promise((r) => setTimeout(r, 750));
  }
  return last?.json;
}

const ymd = (d) => d.toISOString().slice(0, 10);
const today = new Date();

async function main() {
  console.log(`EduCenter integration flow against ${API} (run ${RUN})\n`);
  const health = await call('GET', '/health');
  check('API + database healthy', health.status === 200 && health.json?.checks?.database === 'up', JSON.stringify(health.json));

  check('switch to Admin persona', (await call('PUT', '/context', { personaKey: 'admin' })).status === 200);
  const ctx = (await call('GET', '/context')).json;
  console.log(`      mode: storage=${ctx.mode.storage} processing=${ctx.mode.processing}`);

  // 1. Course
  const course = await call('POST', '/courses', { code: `E2E-${RUN}`, name: `Khóa kiểm thử E2E ${RUN}`, description: 'Tạo bởi integration-flow.mjs', tuitionVnd: '1500000', durationHours: 12, totalSessions: 6, status: 'ACTIVE' });
  check('1. create course', course.status === 201, course.json?.code ?? JSON.stringify(course.json));

  // 2. Class with a timetable → generated sessions (teacher picked among free ones; conflicts → try next)
  const teachers = (await call('GET', '/teachers?status=ACTIVE&pageSize=50')).json.items;
  let cls;
  const start = ymd(new Date(today.getTime() + 2 * 86400000));
  const end = ymd(new Date(today.getTime() + 30 * 86400000));
  for (const t of teachers) {
    cls = await call('POST', '/classrooms', { code: `E2E-${RUN}`, name: `Lớp E2E ${RUN}`, courseId: course.json.id, teacherId: t.id, capacity: 10, startDate: start, endDate: end, slots: [{ dayOfWeek: SLOT_DAY, startTime: `0${SLOT_HOUR}:${SLOT_MIN}`, durationMinutes: 60 }] });
    if (cls.status === 201) break;
  }
  check('2. create class + timetable', cls.status === 201 && cls.json.generatedSessions > 0, `${cls.json?.code} · ${cls.json?.generatedSessions} sessions`);

  const clash = await call('POST', '/classrooms', { code: `E2X-${RUN}`, name: 'Trùng lịch', courseId: course.json.id, teacherId: cls.json.teacher.id, capacity: 5, startDate: start, endDate: end, slots: [{ dayOfWeek: SLOT_DAY, startTime: `0${SLOT_HOUR}:${SLOT_MIN === '45' ? '59' : '50'}`, durationMinutes: 60 }] });
  check('   teacher double-booking rejected', clash.status === 409 && clash.json.code === 'SCHEDULE_CONFLICT', clash.json?.message);

  // 3. Student
  const student = await call('POST', '/students', { fullName: `Học viên E2E ${RUN}`, email: `e2e.${RUN.toLowerCase()}@example.test`, phone: '0900000000' });
  check('3. create student', student.status === 201, student.json?.code);

  // 4. Enrollment (+ automatic tuition invoice, duplicate prevention)
  const enr = await call('POST', '/enrollments', { classroomId: cls.json.id, studentId: student.json.id });
  check('4. enroll student into class', enr.status === 201 && enr.json.invoice?.amountVnd === '1500000', `invoice ${enr.json?.invoice?.code}`);
  const dup = await call('POST', '/enrollments', { classroomId: cls.json.id, studentId: student.json.id });
  check('   duplicate enrollment rejected', dup.status === 409 && dup.json.code === 'ENROLLMENT_DUPLICATE');

  // 5. Material upload for the course
  const pdf = makePdf(`Bai giang ${RUN}`, 3);
  const created = await call('POST', '/materials', { title: `Bài giảng E2E ${RUN}`, category: 'LECTURE', visibility: 'COURSE', courseId: course.json.id, filename: `bai-giang-${RUN}.pdf`, contentType: 'application/pdf', size: pdf.length });
  check('5. create material + upload policy', created.status === 201 && created.json.upload?.method === 'POST', `provider ${created.json?.upload?.provider}, expires ${created.json?.upload?.expiresAt}`);
  const mid = created.json.material.id;
  const up = await uploadTo(created.json.upload, pdf, `bai-giang-${RUN}.pdf`);
  check('6. direct upload to quarantine', up === 204 || up === 200, `HTTP ${up}`);
  const completed = await call('POST', `/materials/${mid}/complete`);
  check('   upload confirmed → PROCESSING', completed.status === 201 && ['PROCESSING', 'READY'].includes(completed.json.status), completed.json?.status);

  // 7-9. Processing → callback → READY
  const ready = await waitFor(`/materials/${mid}`, (m) => m && ['READY', 'REJECTED', 'FAILED'].includes(m.status));
  check('7-9. processed, HMAC callback applied → READY', ready?.status === 'READY' && ready.pageCount === 3 && ready.hasPreview, `${ready?.status}, ${ready?.pageCount} pages, processor ${ready?.latestJob?.processor}, ${ready?.latestJob?.durationMs} ms`);

  // 10. Visible to the enrolled student on the course
  check('switch to Student persona', (await call('PUT', '/context', { personaKey: `student:${student.json.code}` })).status === 200);
  const visible = await call('GET', `/materials?courseId=${course.json.id}`);
  check('10. material listed for enrolled student', visible.status === 200 && visible.json.items.some((m) => m.id === mid));

  // 11. Preview
  const preview = await call('GET', `/materials/${mid}/access?kind=preview`);
  check('11. signed preview URL', preview.status === 200 && preview.json.url && preview.json.ttlSeconds > 0, `${preview.json?.contentType}, ttl ${preview.json?.ttlSeconds}s`);
  const pv = await fetch(preview.json.url.startsWith('http') ? preview.json.url : `${BASE}${preview.json.url}`);
  check('    preview fetch', pv.status === 200, `${pv.headers.get('content-type')}`);

  // 12. Download
  const dl = await call('GET', `/materials/${mid}/access?kind=download`);
  const file = await fetch(dl.json.url.startsWith('http') ? dl.json.url : `${BASE}${dl.json.url}`);
  const bytes = Buffer.from(await file.arrayBuffer());
  check('12. download identical to upload', file.status === 200 && bytes.equals(pdf), `${bytes.length} bytes`);

  const tampered = new URL(dl.json.url, BASE);
  tampered.searchParams.set(tampered.searchParams.has('token') ? 'token' : 'x-oss-signature', 'tampered');
  check('    tampered signed URL refused', (await fetch(tampered)).status >= 400);

  // Student cannot see tuition of others / cannot upload
  check('    student cannot upload materials', (await call('POST', '/materials', { title: 'x', category: 'OTHER', visibility: 'COURSE', courseId: course.json.id, filename: 'x.pdf', contentType: 'application/pdf', size: 10 })).status === 403);

  // 13. Activity + telemetry
  check('switch back to Admin', (await call('PUT', '/context', { personaKey: 'admin' })).status === 200);
  const activity = await call('GET', '/activity?pageSize=50');
  check('13. activity recorded (enrollment, upload, download)', ['enrollment.created', 'material.uploaded', 'material.downloaded'].every((a) => activity.json.items.some((x) => x.action === a)));
  const jobs = await call('GET', `/cloud/jobs?q=${encodeURIComponent(ready.latestJob.correlationId)}`);
  check('    processing job recorded with correlation ID', jobs.status === 200 && jobs.json.items[0]?.status === 'SUCCEEDED', ready.latestJob.correlationId);
  const logs = await call('GET', `/cloud/logs?correlationId=${encodeURIComponent(ready.latestJob.correlationId)}&pageSize=50`);
  check('    ops logs carry the correlation ID', logs.status === 200 && logs.json.items.length >= 3, `${logs.json.items.length} entries: ${[...new Set(logs.json.items.map((l) => l.service))].join(', ')}`);
  const metrics = await call('GET', '/cloud/metrics?window=60');
  check('    telemetry: callback latency + API latency', metrics.json.inProcess.some((m) => m.name === 'callback.latency' && m.count > 0) && metrics.json.inProcess.some((m) => m.name === 'api.request' && m.count > 0));

  // Negative paths
  const bad = Buffer.from('definitely not a pdf file');
  const badM = await call('POST', '/materials', { title: `Tệp giả ${RUN}`, category: 'OTHER', visibility: 'COURSE', courseId: course.json.id, filename: `fake-${RUN}.pdf`, contentType: 'application/pdf', size: bad.length });
  await uploadTo(badM.json.upload, bad, `fake-${RUN}.pdf`);
  await call('POST', `/materials/${badM.json.material.id}/complete`);
  const rejected = await waitFor(`/materials/${badM.json.material.id}`, (m) => m && ['READY', 'REJECTED', 'FAILED'].includes(m.status));
  check('    non-PDF content → REJECTED', rejected?.status === 'REJECTED', rejected?.rejectReason);

  const forged = await fetch(`${API}/internal/material-callback`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-edu-key-id': 'k1', 'x-edu-timestamp': String(Math.floor(Date.now() / 1000)), 'x-edu-signature': `v1=${'0'.repeat(64)}` }, body: JSON.stringify({ materialId: mid }) });
  check('    forged callback refused (401)', forged.status === 401);

  const nonPdf = await call('POST', '/materials', { title: 'docx', category: 'OTHER', visibility: 'COURSE', courseId: course.json.id, filename: 'a.docx', contentType: 'application/msword', size: 10 });
  check('    non-PDF type refused before upload', nonPdf.status === 422);

  console.log(`\n${results.filter((r) => r.ok).length}/${results.length} checks passed`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
