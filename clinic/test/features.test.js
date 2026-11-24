'use strict';
// BHYT billing + XML export, reminders, CLS result sheet, and schema migration.
process.env.DB_PATH = ':memory:';
process.env.ADMIN_PASSWORD = 'admin12345';
process.env.BHYT_MA_CSKCB = '01999';
process.env.LUONG_CO_SO = '2340000';
process.env.CLINIC_PHONE = '02412345678';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createApp } = require('../src/server');
const { db } = require('../src/db');
const bhyt = require('../src/bhyt');
const { normalizePhone, fill } = require('../src/routes/reminders');
const { today, addDays } = require('../src/helpers');

let server;
let base;
test.before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

class Browser {
  constructor() { this.cookie = ''; this.csrf = ''; }
  async req(method, p, form) {
    const headers = { cookie: this.cookie };
    let body;
    if (form) {
      headers['content-type'] = 'application/x-www-form-urlencoded';
      const params = new URLSearchParams({ _csrf: this.csrf });
      for (const [k, v] of Object.entries(form)) for (const x of [].concat(v)) params.append(k, x);
      body = params.toString();
    }
    const res = await fetch(base + p, { method, headers, body, redirect: 'manual' });
    const set = res.headers.getSetCookie();
    if (set.length) this.cookie = set.map((c) => c.split(';')[0]).join('; ');
    const text = await res.text();
    const m = text.match(/name="_csrf" value="([^"]+)"/);
    if (m) this.csrf = m[1];
    return { status: res.status, location: res.headers.get('location'), text, type: res.headers.get('content-type') };
  }
  get(p) { return this.req('GET', p); }
  post(p, form) { return this.req('POST', p, form); }
  async login(u, pw) { await this.get('/login'); const r = await this.post('/login', { username: u, password: pw }); assert.equal(r.status, 302); }
}
const idFrom = (loc) => Number(loc.match(/\/(\d+)(?:$|\?)/)[1]);

test('BHYT helpers', () => {
  assert.equal(bhyt.benefitFromCard('DN4010123456789'), 80);
  assert.equal(bhyt.benefitFromCard('HT3010123456789'), 95);
  assert.equal(bhyt.benefitFromCard('TE1010123456789'), 100);
  assert.equal(bhyt.benefitFromCard('SHORT'), null);
  assert.deepEqual(bhyt.split(100000, true, 80), { thanhTienBV: 100000, thanhTienBH: 100000, bhtt: 80000, bncct: 20000, bntt: 0 });
  assert.deepEqual(bhyt.split(50000, false, 80), { thanhTienBV: 50000, thanhTienBH: 0, bhtt: 0, bncct: 0, bntt: 50000 });
  assert.equal(bhyt.fullCoverageThreshold(), 351000);
});

test('reminder helpers', () => {
  assert.equal(normalizePhone('0912 345 678'), '0912345678');
  assert.equal(normalizePhone('+84912345678'), '0912345678');
  assert.equal(normalizePhone('abc'), '');
  assert.equal(fill('Chào {ten}, {x}', { ten: 'An' }), 'Chào An, {x}');
});

test('BHYT visit: co-pay on invoices, XML export, validation', async () => {
  const admin = new Browser();
  await admin.login('admin', 'admin12345');
  for (const [username, role] of [['bsi', 'doctor'], ['letan', 'receptionist'], ['thungan', 'cashier'], ['ktv', 'technician']]) {
    await admin.get('/admin/users/new');
    await admin.post('/admin/users', { username, full_name: `NV ${role}`, role, password: 'password123', active: '1', license_no: role === 'doctor' ? 'CCHN-001' : '' });
  }
  const noi = db.prepare(`SELECT * FROM departments WHERE name = 'Nội tổng quát'`).get();
  await admin.get('/admin/departments');
  await admin.post('/admin/departments', { id: String(noi.id), name: noi.name, room: noi.room, default_service_id: String(noi.default_service_id), active: '1', bhyt_code: 'K01' });
  assert.equal(db.prepare('SELECT bhyt_code FROM departments WHERE id = ?').get(noi.id).bhyt_code, 'K01');
  const kb01 = db.prepare(`SELECT * FROM services WHERE code = 'KB01'`).get();
  await admin.get('/admin/services');
  await admin.post('/admin/services', { id: String(kb01.id), code: 'KB01', name: kb01.name, category: kb01.category, price: String(kb01.price), active: '1', bhyt_code: '01.1900.1778' });
  const para = db.prepare(`SELECT * FROM medicines WHERE code = 'T001'`).get();
  await admin.get(`/pharmacy/${para.id}/edit`);
  await admin.post(`/pharmacy/${para.id}`, { code: 'T001', name: para.name, unit: para.unit, price: String(para.price), min_stock: '10', active: '1', bhyt_code: '40.17', strength: '500mg', route: 'Uống', reg_no: 'VD-1' });
  assert.equal(db.prepare('SELECT bhyt_code, strength FROM medicines WHERE id = ?').get(para.id).strength, '500mg');

  // Patient with a valid 80% card
  const lt = new Browser();
  await lt.login('letan', 'password123');
  await lt.get('/patients/new');
  let r = await lt.post('/patients', {
    full_name: 'Trần Văn Bảo', gender: 'M', dob: '1975-02-03', phone: '0911222333', id_number: '001075000111',
    insurance_number: 'dn4 010 123 456 789', insurance_valid_from: addDays(today(), -100), insurance_valid_to: addDays(today(), 200), insurance_reg_place: '01001',
  });
  assert.equal(r.status, 302);
  const pid = idFrom(r.location);
  assert.equal(db.prepare('SELECT insurance_number FROM patients WHERE id = ?').get(pid).insurance_number, 'DN4010123456789');

  // Invalid card number rejected
  await lt.get('/patients/new');
  r = await lt.post('/patients', { full_name: 'X', insurance_number: 'abc' });
  assert.equal(r.status, 400);
  assert.match(r.text, /Số thẻ BHYT không hợp lệ/);

  // Check in as BHYT
  await lt.get(`/visits/new?patient_id=${pid}`);
  r = await lt.post('/visits', { patient_id: String(pid), department_id: String(noi.id), service_id: String(kb01.id), bhyt: '1' });
  const vid = idFrom(r.location);
  assert.equal(db.prepare('SELECT bhyt FROM visits WHERE id = ?').get(vid).bhyt, 1);

  // Consultation fee 150,000 is under 15% of base salary -> BHYT pays 100%
  const tn = new Browser();
  await tn.login('thungan', 'password123');
  await tn.get('/invoices');
  r = await tn.post(`/invoices/from-visit/${vid}`, {});
  const inv1 = idFrom(r.location);
  let inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(inv1);
  assert.equal(inv.subtotal, 150000);
  assert.equal(inv.insurance_amount, 150000);
  assert.equal(inv.total, 0);
  r = await tn.get(`/invoices/${inv1}`);
  assert.match(r.text, /BHYT chi trả/);
  await tn.post(`/invoices/${inv1}/pay`, { payment_method: 'cash' });
  assert.equal(db.prepare('SELECT status FROM invoices WHERE id = ?').get(inv1).status, 'paid');

  // Doctor: an imaging test with a BHYT code pushes the visit over the threshold -> 80%
  const cd06 = db.prepare(`SELECT * FROM services WHERE code = 'CD06'`).get();
  db.prepare('UPDATE services SET bhyt_code = ? WHERE id = ?').run('18.0071.0001', cd06.id);
  const xn01 = db.prepare(`SELECT * FROM services WHERE code = 'XN01'`).get(); // not covered
  const bs = new Browser();
  await bs.login('bsi', 'password123');
  await bs.get(`/visits/${vid}`);
  await bs.post(`/visits/${vid}/start`, {});
  await bs.get(`/visits/${vid}`);
  await bs.post(`/visits/${vid}/services`, { service_id: String(cd06.id), quantity: '1' });
  await bs.get(`/visits/${vid}`);
  await bs.post(`/visits/${vid}/services`, { service_id: String(xn01.id), quantity: '1' });
  await bs.get(`/visits/${vid}`);
  await bs.post(`/visits/${vid}/prescription`, { medicine_id: String(para.id), quantity: '10', dosage: 'Uống khi sốt', days: '3' });

  // XML export refuses an unfinished visit
  assert.ok(bhyt.validate(bhyt.loadVisit(vid)).errors.includes('Lượt khám chưa kết thúc'));

  await bs.get(`/visits/${vid}`);
  await bs.post(`/visits/${vid}/exam`, { diagnosis: 'Viêm họng cấp', icd_code: 'J02.9', finish: '1', weight: '60' });

  await tn.get('/invoices');
  r = await tn.post(`/invoices/from-visit/${vid}`, {});
  const inv2 = idFrom(r.location);
  inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(inv2);
  // CD06 500,000 (80% => 400,000) + paracetamol 10,000 (80% => 8,000) + XN01 90,000 not covered
  assert.equal(inv.subtotal, 500000 + 10000 + 90000);
  assert.equal(inv.insurance_amount, 400000 + 8000);
  assert.equal(inv.total, 600000 - 408000);
  await tn.get(`/invoices/${inv2}`);
  await tn.post(`/invoices/${inv2}/pay`, { payment_method: 'cash' });

  // Technician enters a result; CLS sheet prints it with the technician's name
  const ktv = new Browser();
  await ktv.login('ktv', 'password123');
  const item = db.prepare('SELECT id FROM visit_services WHERE visit_id = ? AND service_id = ?').get(vid, cd06.id);
  await ktv.get('/lab?show=all');
  await ktv.post(`/lab/${item.id}/result`, { result: 'BI-RADS 2 — tổn thương lành tính', show: 'all' });
  r = await ktv.get(`/lab/visit/${vid}/print`);
  assert.equal(r.status, 200);
  assert.match(r.text, /Phiếu kết quả cận lâm sàng/i);
  assert.match(r.text, /BI-RADS 2/);
  assert.match(r.text, /NV technician/);
  assert.match(r.text, /Tổng phân tích tế bào máu/);
  assert.match(r.text, /chưa có kết quả/);
  r = await ktv.get(`/lab/visit/${vid}/print?item=${item.id}`);
  assert.doesNotMatch(r.text, /Tổng phân tích tế bào máu/);

  // BHYT export page + XML download (cashier only)
  r = await bs.get('/bhyt');
  assert.equal(r.status, 403);
  r = await tn.get(`/bhyt?from=${today()}&to=${today()}`);
  assert.match(r.text, /Trần Văn Bảo/);
  assert.match(r.text, /Hợp lệ/);
  r = await tn.get(`/bhyt/visit/${vid}`);
  assert.match(r.text, /MA_THE_BHYT/);
  r = await tn.post('/bhyt/export', { from: today(), to: today() });
  assert.equal(r.status, 200);
  assert.match(r.type, /xml/);
  assert.match(r.text, /^<\?xml[^>]*><GIAMDINHHS><THONGTINDONVI><MACSKCB>01999<\/MACSKCB>/);
  const files = [...r.text.matchAll(/<LOAIHOSO>(XML\d)<\/LOAIHOSO><NOIDUNGFILE>([^<]+)<\/NOIDUNGFILE>/g)]
    .map(([, t, b]) => [t, Buffer.from(b, 'base64').toString('utf8')]);
  assert.deepEqual(files.map(([t]) => t), ['XML1', 'XML2', 'XML3']);
  const xml1 = files[0][1];
  const tag = (x, t) => x.match(new RegExp(`<${t}>(.*?)</${t}>`))?.[1];
  assert.equal(tag(xml1, 'MA_THE_BHYT'), 'DN4010123456789');
  assert.equal(tag(xml1, 'NGAY_SINH'), '197502030000');
  assert.equal(tag(xml1, 'GIOI_TINH'), '1');
  assert.equal(tag(xml1, 'MA_BENH_CHINH'), 'J02.9');
  assert.equal(tag(xml1, 'MA_KHOA'), 'K01');
  assert.equal(tag(xml1, 'T_TONGCHI_BV'), String(750000));
  assert.equal(tag(xml1, 'T_TONGCHI_BH'), String(660000));
  assert.equal(tag(xml1, 'T_BHTT'), String(528000)); // 80% of 660,000 (visit total over threshold)
  assert.equal(tag(xml1, 'T_BNCCT'), String(132000));
  assert.equal(tag(xml1, 'T_BNTT'), String(90000));
  assert.equal(tag(xml1, 'T_THUOC'), String(10000));
  assert.match(xml1, /<HO_TEN><!\[CDATA\[Trần Văn Bảo\]\]><\/HO_TEN>/);
  assert.match(files[1][1], /<MA_THUOC>40.17<\/MA_THUOC>/);
  assert.match(files[1][1], /<MA_BAC_SI>CCHN-001<\/MA_BAC_SI>/);
  assert.equal((files[2][1].match(/<CHI_TIET_DVKT>/g) || []).length, 3);

  // Expired card cannot be used for a BHYT visit
  db.prepare('UPDATE patients SET insurance_valid_to = ? WHERE id = ?').run(addDays(today(), -1), pid);
  await lt.get(`/visits/new?patient_id=${pid}`);
  r = await lt.post('/visits', { patient_id: String(pid), department_id: String(noi.id), bhyt: '1' });
  assert.equal(r.status, 400);
  assert.match(r.text, /Thẻ BHYT đã hết hạn/);

  // Reports show the BHYT receivable
  r = await tn.get('/reports');
  assert.match(r.text, /BHYT phải thu/);
  assert.match(r.text, /558\.000/); // 150,000 + 408,000
});

test('reminders: appointments and follow-ups for a day', async () => {
  const lt = new Browser();
  await lt.login('letan', 'password123');
  const tomorrow = addDays(today(), 1);
  const pid = db.prepare(`SELECT id FROM patients WHERE full_name = 'Trần Văn Bảo'`).get().id;
  const dept = db.prepare(`SELECT id FROM departments WHERE name = 'Nhi'`).get().id;
  await lt.get(`/appointments/new?patient_id=${pid}`);
  await lt.post('/appointments', { patient_id: String(pid), department_id: String(dept), date: tomorrow, time: '09:15', reason: 'Khám lại' });
  // A follow-up due tomorrow for another patient
  await lt.get('/patients/new');
  const r0 = await lt.post('/patients', { full_name: 'Lê Thị Cúc', phone: '+84 988 777 666' });
  const p2 = idFrom(r0.location);
  db.prepare(`INSERT INTO visits (patient_id, department_id, visit_date, queue_number, status, follow_up_date) VALUES (?,?,?,?,?,?)`)
    .run(p2, dept, today(), 99, 'done', tomorrow);

  let r = await lt.get(`/reminders?date=${tomorrow}`);
  assert.equal(r.status, 200);
  assert.match(r.text, /Kính gửi Trần Văn Bảo: Phòng khám Đa khoa xin nhắc lịch hẹn khám Nhi lúc 09:15/);
  assert.match(r.text, /Kính gửi Lê Thị Cúc: Phòng khám Đa khoa xin nhắc lịch tái khám/);
  assert.match(r.text, /https:\/\/zalo\.me\/0988777666/);
  assert.match(r.text, /02412345678/);

  r = await lt.get(`/reminders/export.csv?date=${tomorrow}`);
  assert.match(r.text, /0911222333,Trần Văn Bảo,Lịch hẹn/);
  assert.match(r.text, /0988777666,Lê Thị Cúc,Tái khám/);

  const appt = db.prepare('SELECT id FROM appointments WHERE patient_id = ? ORDER BY id DESC').get(pid);
  await lt.get(`/reminders?date=${tomorrow}`);
  r = await lt.post('/reminders/mark', { id: String(appt.id), kind: 'appointment', date: tomorrow });
  assert.equal(r.status, 302);
  assert.ok(db.prepare('SELECT reminded_at FROM appointments WHERE id = ?').get(appt.id).reminded_at);
  r = await lt.get(`/reminders/export.csv?date=${tomorrow}`);
  assert.doesNotMatch(r.text, /Trần Văn Bảo/, 'already-reminded rows are left out of the CSV');

  // Cashier has no access to reminders
  const tn = new Browser();
  await tn.login('thungan', 'password123');
  assert.equal((await tn.get('/reminders')).status, 403);
});

test('new pages render for admin', async () => {
  const admin = new Browser();
  await admin.login('admin', 'admin12345');
  const vid = db.prepare('SELECT id FROM visits LIMIT 1').get().id;
  for (const p of ['/bhyt', `/bhyt/visit/${vid}`, '/reminders', `/lab/visit/${vid}/print`, '/patients/new', '/pharmacy/new', '/admin/departments', '/admin/services', '/admin/users/new']) {
    const r = await admin.get(p);
    assert.equal(r.status, 200, `${p} -> ${r.status}\n${r.text.slice(0, 400)}`);
  }
});

test('upgrades a database created by the previous version', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clinic-mig-'));
  const file = path.join(dir, 'old.db');
  // Minimal "v1.0" tables without the new columns
  execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', '-e', `
    const { DatabaseSync } = require('node:sqlite');
    const d = new DatabaseSync(${JSON.stringify(file)});
    d.exec("CREATE TABLE patients (id INTEGER PRIMARY KEY, code TEXT UNIQUE, full_name TEXT NOT NULL, gender TEXT, dob TEXT, phone TEXT, id_number TEXT, insurance_number TEXT, address TEXT, occupation TEXT, allergies TEXT, medical_history TEXT, emergency_contact TEXT, created_at TEXT)");
    d.exec("INSERT INTO patients (full_name) VALUES ('Bệnh nhân cũ')");
  `]);
  const out = execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', '-e', `
    require('./src/db');
    const { DatabaseSync } = require('node:sqlite');
    const d = new DatabaseSync(${JSON.stringify(file)});
    console.log(JSON.stringify({ cols: d.prepare('PRAGMA table_info(patients)').all().map(c => c.name), n: d.prepare('SELECT COUNT(*) AS n FROM patients').get().n }));
  `], { cwd: path.join(__dirname, '..'), env: { ...process.env, DB_PATH: file, CONFIG_FILE: path.join(dir, 'none.env') } }).toString();
  const { cols, n } = JSON.parse(out.trim().split('\n').pop());
  assert.ok(cols.includes('insurance_valid_to'));
  assert.ok(cols.includes('insurance_benefit'));
  assert.equal(n, 1, 'existing rows kept');
  fs.rmSync(dir, { recursive: true, force: true });
});
