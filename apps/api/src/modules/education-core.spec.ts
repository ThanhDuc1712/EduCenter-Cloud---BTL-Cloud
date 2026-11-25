import { addDaysYmd, expandWeeklySlots, isoWeekday, isYmd, localDayRange, localToUtc, localYmd, overlaps, startOfIsoWeek } from '../common/time';
import { countAttendance } from './attendance/attendance.service';
import { percentEncode, signRpc, signSls } from './cloud/aliyun.client';
import { classify, weightedAverage } from './grades/grades.service';
import { toCsv } from './reports/reports.module';
import { invoiceStatus } from './tuition/invoice-code';

describe('time helpers (Asia/Ho_Chi_Minh)', () => {
  it('converts local wall-clock time to UTC (+07:00)', () => {
    expect(localToUtc('2026-11-24', 18 * 60).toISOString()).toBe('2026-11-24T11:00:00.000Z');
    expect(localYmd(new Date('2026-11-24T18:30:00Z'))).toBe('2026-11-25');
    expect(localDayRange('2026-11-24')).toEqual({ start: new Date('2026-11-23T17:00:00Z'), end: new Date('2026-11-24T17:00:00Z') });
  });

  it('computes ISO weekdays and week starts', () => {
    expect(isoWeekday('2026-11-23')).toBe(1); // Monday
    expect(isoWeekday('2026-11-29')).toBe(7); // Sunday
    expect(startOfIsoWeek('2026-11-26')).toBe('2026-11-23');
    expect(addDaysYmd('2026-12-31', 1)).toBe('2027-01-01');
    expect(isYmd('2026-02-30')).toBe(false);
  });

  it('expands a weekly timetable into sessions', () => {
    const occ = expandWeeklySlots('2026-11-23', '2026-12-06', [
      { dayOfWeek: 1, startMinute: 18 * 60, durationMinutes: 120 },
      { dayOfWeek: 3, startMinute: 18 * 60, durationMinutes: 120 },
    ]);
    expect(occ).toHaveLength(4);
    expect(occ[0].startsAt.toISOString()).toBe('2026-11-23T11:00:00.000Z');
    expect(occ[0].endsAt.toISOString()).toBe('2026-11-23T13:00:00.000Z');
  });

  it('detects overlapping intervals (half-open)', () => {
    const t = (h: number) => new Date(Date.UTC(2026, 0, 1, h));
    expect(overlaps(t(10), t(12), t(11), t(13))).toBe(true);
    expect(overlaps(t(10), t(12), t(12), t(13))).toBe(false); // back-to-back is fine
  });
});

describe('grades', () => {
  const bands = [
    { label: 'Giỏi', minScore: 8 },
    { label: 'Khá', minScore: 6.5 },
    { label: 'Trung bình', minScore: 5 },
    { label: 'Yếu', minScore: 0 },
  ];

  it('computes the weighted average on the 10-point scale', () => {
    expect(weightedAverage([{ score: 8, maxScore: 10, weight: 20 }, { score: 7, maxScore: 10, weight: 30 }, { score: 9, maxScore: 10, weight: 50 }])).toBe(8.2);
    expect(weightedAverage([{ score: 40, maxScore: 50, weight: 100 }])).toBe(8);
    expect(weightedAverage([])).toBeNull();
  });

  it('classifies with the configured bands', () => {
    expect(classify(8.2, bands)).toBe('Giỏi');
    expect(classify(6.5, bands)).toBe('Khá');
    expect(classify(4.9, bands)).toBe('Yếu');
    expect(classify(null, bands)).toBeNull();
  });
});

describe('attendance rate', () => {
  it('counts present + late as attended', () => {
    expect(countAttendance(['PRESENT', 'PRESENT', 'LATE', 'ABSENT', 'EXCUSED'])).toEqual({ total: 5, present: 2, late: 1, absent: 1, excused: 1, rate: 60 });
    expect(countAttendance([]).rate).toBe(0);
  });
});

describe('tuition status', () => {
  it('derives invoice status from paid amount', () => {
    expect(invoiceStatus(1000n, 0n, 0n)).toBe('UNPAID');
    expect(invoiceStatus(1000n, 100n, 500n)).toBe('PARTIAL');
    expect(invoiceStatus(1000n, 100n, 900n)).toBe('PAID');
  });
});

describe('CSV export', () => {
  it('adds a BOM, quotes and neutralises formula injection', () => {
    const csv = toCsv({ kind: 'students', title: 't', from: '', to: '', summary: [], columns: [{ key: 'a', label: 'Tên' }, { key: 'b', label: 'Số' }], rows: [{ a: '=HYPERLINK("x")', b: -5 }, { a: 'Nguyễn, Văn "A"', b: null }] });
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv).toContain(`"'=HYPERLINK(""x"")",-5`);
    expect(csv).toContain('"Nguyễn, Văn ""A""",');
  });
});

describe('Alibaba Cloud request signing', () => {
  it('percent-encodes per RFC 3986', () => {
    expect(percentEncode("a b*c~d'(e)!")).toBe('a%20b%2Ac~d%27%28e%29%21');
  });

  it('produces the documented RPC signature for the reference request', () => {
    // Reference example from the Alibaba Cloud RPC signature documentation (DescribeRegions, secret "testsecret").
    const params = { AccessKeyId: 'testid', Action: 'DescribeRegions', Format: 'XML', SignatureMethod: 'HMAC-SHA1', SignatureNonce: '3ee8c1b8-83d3-44af-a94f-4e0ad82fd6cf', SignatureVersion: '1.0', Timestamp: '2016-02-23T12:46:24Z', Version: '2014-05-26' };
    expect(signRpc(params, 'testsecret')).toBe('OLeaidS1JvxuMvnyHOwuJ+uX5qY=');
  });

  it('signs SLS requests deterministically over sorted x-log headers and query', () => {
    const h = { date: 'Mon, 24 Nov 2026 10:00:00 GMT', 'x-log-apiversion': '0.6.0', 'x-log-signaturemethod': 'hmac-sha1', 'x-log-bodyrawsize': '0' };
    const a = signSls('GET', '/logstores/fc', { to: '2', from: '1', type: 'log' }, h, 'secret');
    const b = signSls('GET', '/logstores/fc', { type: 'log', from: '1', to: '2' }, { ...h }, 'secret');
    expect(a).toBe(b);
    expect(a).not.toBe(signSls('GET', '/logstores/fc', { type: 'log', from: '1', to: '3' }, h, 'secret'));
  });
});
