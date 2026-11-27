// k6 SMOKE load test (LT01-style, light) — tester: Dương.
// Small, safe load: proves the stack answers under concurrent users and records p95/error rate.
// It is NOT the 1,200-VU benchmark (LT03) — report that one as "Not run" with the reason.
//
//   k6 run -e BASE_URL=http://localhost:3000 -e TEST_PASSWORD=<pw> tests/load/smoke.k6.js
//   k6 run -e BASE_URL=https://<app>.azurewebsites.net -e TEST_PASSWORD=<pw> -e VUS=10 -e DURATION=3m tests/load/smoke.k6.js
//
// Read-only requests only. Logs in ONCE per role in setup() (Argon2 login is expensive by design).
import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE = (__ENV.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const API = `${BASE}/api/v1`;
const LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1)/.test(BASE);
const ORIGIN = __ENV.APP_ORIGIN || (LOCAL ? 'http://localhost:5173' : BASE);
const TENANT = __ENV.TENANT || 'hanoi-center';
const VUS = Number(__ENV.VUS || 10);
if (VUS > 30) throw new Error('Smoke test is capped at 30 VUs — agree a benchmark window with Giang/Đức first.');

export const options = {
  scenarios: {
    smoke: { executor: 'constant-vus', vus: VUS, duration: __ENV.DURATION || '2m' },
  },
  thresholds: {
    // ROADMAP SLO (V2 §15.5): read p95 < 500 ms, error < 0.5 %
    'http_req_duration{kind:read}': ['p(95)<500'],
    http_req_failed: ['rate<0.005'],
    checks: ['rate>0.99'],
  },
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

function login(email) {
  const res = http.post(`${API}/auth/login`, JSON.stringify({ tenantSlug: TENANT, email, password: __ENV.TEST_PASSWORD || 'Demo@12345' }), {
    headers: { 'content-type': 'application/json', origin: ORIGIN },
    tags: { kind: 'login' },
  });
  if (res.status !== 200) throw new Error(`login ${email} failed: ${res.status}`);
  const name = Object.keys(res.cookies).find((k) => /session/i.test(k));
  return `${name}=${res.cookies[name][0].value}`;
}

export function setup() {
  const admin = login(`admin@${TENANT}.edu.example`);
  const h = { headers: { cookie: admin } };
  const students = JSON.parse(http.get(`${API}/students?status=ACTIVE&pageSize=20`, h).body).items.filter((s) => s.email);
  const teachers = JSON.parse(http.get(`${API}/teachers?pageSize=20`, h).body).items.filter((t) => t.email);
  return {
    sessions: [
      { role: 'ADMIN', cookie: admin },
      { role: 'TEACHER', cookie: login(teachers[0].email) },
      { role: 'STUDENT', cookie: login(students[0].email) },
    ],
  };
}

// Read mix per role, roughly following the V2 §15.2 workload (schedule/classes/materials heavy).
const PATHS = {
  ADMIN: ['/dashboard', '/classrooms?pageSize=20', '/students?pageSize=20', '/schedule', '/invoices?pageSize=20', '/materials?pageSize=20'],
  TEACHER: ['/dashboard', '/classrooms?pageSize=20', '/schedule', '/attendance/pending', '/materials?pageSize=20'],
  STUDENT: ['/dashboard', '/schedule', '/classrooms?pageSize=20', '/invoices?pageSize=20', '/materials?pageSize=20'],
};

export default function (data) {
  const s = data.sessions[(__VU - 1) % data.sessions.length];
  for (const path of PATHS[s.role]) {
    const res = http.get(`${API}${path}`, { headers: { cookie: s.cookie }, tags: { kind: 'read', role: s.role, name: path.split('?')[0] } });
    check(res, { [`${s.role} ${path.split('?')[0]} 200`]: (r) => r.status === 200 });
    sleep(1 + Math.random() * 2); // think time
  }
}
