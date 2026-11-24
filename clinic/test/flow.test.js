'use strict';
// End-to-end test of the main clinic workflow against an in-memory database.
process.env.DB_PATH = ':memory:';
process.env.ADMIN_PASSWORD = 'admin12345';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/server');
const { db } = require('../src/db');
const { maskName } = require('../src/routes/display');

let server;
let base;

test.before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

/** Tiny browser: keeps cookies and the CSRF token of the last page. */
class Browser {
  constructor() { this.cookie = ''; this.csrf = ''; }
  async req(method, path, form) {
    const headers = { cookie: this.cookie };
    let body;
    if (form) {
      headers['content-type'] = 'application/x-www-form-urlencoded';
      body = new URLSearchParams({ _csrf: this.csrf, ...form }).toString();
    }
    const res = await fetch(base + path, { method, headers, body, redirect: 'manual' });
    const set = res.headers.getSetCookie();
    if (set.length) this.cookie = set.map((c) => c.split(';')[0]).join('; ');
    const text = await res.text();
    const m = text.match(/name="_csrf" value="([^"]+)"/);
    if (m) this.csrf = m[1];
    return { status: res.status, location: res.headers.get('location'), text };
  }
  get(path) { return this.req('GET', path); }
  post(path, form) { return this.req('POST', path, form); }
  async login(username, password) {
    await this.get('/login');
    const r = await this.post('/login', { username, password });
    assert.equal(r.status, 302, `login ${username}`);
    assert.equal(r.location, '/');
  }
}

const idFrom = (location) => Number(location.match(/\/(\d+)(?:$|\?)/)[1]);

test('redirects anonymous users to login', async () => {
  const b = new Browser();
  const r = await b.get('/patients');
  assert.equal(r.status, 302);
  assert.equal(r.location, '/login');
});

test('rejects bad password and missing CSRF token', async () => {
  const b = new Browser();
  await b.get('/login');
  const bad = await b.post('/login', { username: 'admin', password: 'wrong' });
  assert.equal(bad.status, 401);
  b.csrf = 'nope';
  const forged = await b.post('/login', { username: 'admin', password: 'admin12345' });
  assert.equal(forged.status, 403);
});

test('full clinic workflow', async () => {
  const admin = new Browser();
  await admin.login('admin', 'admin12345');

  // Admin creates staff
  const noi = db.prepare(`SELECT id, default_service_id FROM departments WHERE name = 'Nội tổng quát'`).get();
  for (const [username, role] of [['bs.an', 'doctor'], ['letan', 'receptionist'], ['thungan', 'cashier'], ['duoc', 'pharmacist'], ['ktv', 'technician']]) {
    await admin.get('/admin/users/new');
    const r = await admin.post('/admin/users', {
      username, full_name: `Test ${role}`, role, password: 'password123', department_id: role === 'doctor' ? String(noi.id) : '', active: '1',
    });
    assert.equal(r.status, 302, `create ${username}`);
  }
  const doctorId = db.prepare(`SELECT id FROM users WHERE username = 'bs.an'`).get().id;

  // Reception registers a patient and checks them in
  const rec = new Browser();
  await rec.login('letan', 'password123');
  await rec.get('/patients/new');
  let r = await rec.post('/patients', { full_name: 'Nguyễn Văn An', gender: 'M', dob: '1980-05-12', phone: '0912345678', allergies: 'Penicillin' });
  assert.equal(r.status, 302);
  const patientId = idFrom(r.location);
  assert.equal(db.prepare('SELECT code FROM patients WHERE id = ?').get(patientId).code, `BN${String(patientId).padStart(6, '0')}`);

  // Validation errors are shown, not saved
  await rec.get('/patients/new');
  r = await rec.post('/patients', { full_name: '', phone: 'abc' });
  assert.equal(r.status, 400);
  assert.match(r.text, /Vui lòng nhập họ tên/);

  // Picker search finds the patient
  r = await rec.get('/visits/new?q=0912');
  assert.match(r.text, /Nguyễn Văn An/);

  await rec.get(`/visits/new?patient_id=${patientId}`);
  r = await rec.post('/visits', { patient_id: String(patientId), department_id: String(noi.id), service_id: String(noi.default_service_id), reason: 'Sốt, ho' });
  assert.equal(r.status, 302);
  const visitId = idFrom(r.location);
  const visit = db.prepare('SELECT * FROM visits WHERE id = ?').get(visitId);
  assert.equal(visit.queue_number, 1);
  assert.equal(visit.status, 'waiting');

  // Receptionist cannot prescribe
  await rec.get(`/visits/${visitId}`);
  r = await rec.post(`/visits/${visitId}/prescription`, { medicine_id: '1', quantity: '10' });
  assert.equal(r.status, 403);

  // Patient pays the consultation fee first (common workflow)
  const cash = new Browser();
  await cash.login('thungan', 'password123');
  await cash.get('/invoices');
  r = await cash.post(`/invoices/from-visit/${visitId}`, {});
  assert.equal(r.status, 302);
  const inv1 = idFrom(r.location);
  await cash.get(`/invoices/${inv1}`);
  r = await cash.post(`/invoices/${inv1}/pay`, { payment_method: 'cash', discount: '0' });
  assert.equal(r.status, 302);
  assert.equal(db.prepare('SELECT status, total FROM invoices WHERE id = ?').get(inv1).status, 'paid');

  // Doctor examines, orders a lab test and prescribes
  const doc = new Browser();
  await doc.login('bs.an', 'password123');
  r = await doc.get('/display');
  assert.match(r.text, /N\. V\. AN/);
  await doc.get(`/visits/${visitId}`);
  r = await doc.post(`/visits/${visitId}/start`, {});
  assert.equal(db.prepare('SELECT status, doctor_id FROM visits WHERE id = ?').get(visitId).doctor_id, doctorId);
  const cbc = db.prepare(`SELECT id, price FROM services WHERE code = 'XN01'`).get();
  await doc.get(`/visits/${visitId}`);
  r = await doc.post(`/visits/${visitId}/services`, { service_id: String(cbc.id), quantity: '1' });
  assert.equal(r.status, 302);
  const para = db.prepare(`SELECT id, price, stock FROM medicines WHERE code = 'T001'`).get();
  await doc.get(`/visits/${visitId}`);
  r = await doc.post(`/visits/${visitId}/prescription`, { medicine_id: String(para.id), quantity: '10', dosage: 'Uống 1 viên khi sốt', days: '3' });
  assert.equal(r.status, 302);

  // The paid consultation line can no longer be removed
  const examItem = db.prepare(`SELECT id FROM visit_services WHERE visit_id = ? AND service_id = ?`).get(visitId, noi.default_service_id);
  await doc.get(`/visits/${visitId}`);
  r = await doc.post(`/visits/${visitId}/services/${examItem.id}/delete`, {});
  r = await doc.get(r.location);
  assert.match(r.text, /đã thanh toán, không thể xóa/);

  // Technician enters the lab result from the worklist
  const ktv = new Browser();
  await ktv.login('ktv', 'password123');
  r = await ktv.get('/lab');
  assert.match(r.text, /Tổng phân tích tế bào máu/);
  const labItem = db.prepare('SELECT id FROM visit_services WHERE visit_id = ? AND service_id = ?').get(visitId, cbc.id);
  r = await ktv.post(`/lab/${labItem.id}/result`, { result: 'WBC 12.5 G/L (tăng)', show: 'pending' });
  assert.equal(r.status, 302);
  assert.equal(db.prepare('SELECT result FROM visit_services WHERE id = ?').get(labItem.id).result, 'WBC 12.5 G/L (tăng)');

  // Finishing without a diagnosis is refused; with a diagnosis it succeeds
  await doc.get(`/visits/${visitId}`);
  await doc.post(`/visits/${visitId}/exam`, { pulse: '88', temperature: '38,5', finish: '1' });
  assert.equal(db.prepare('SELECT status, temperature FROM visits WHERE id = ?').get(visitId).temperature, 38.5);
  assert.equal(db.prepare('SELECT status FROM visits WHERE id = ?').get(visitId).status, 'in_progress');
  await doc.get(`/visits/${visitId}`);
  await doc.post(`/visits/${visitId}/exam`, { diagnosis: 'Viêm họng cấp', icd_code: 'j02.9', follow_up_date: '2099-01-01', finish: '1' });
  const done = db.prepare('SELECT status, icd_code FROM visits WHERE id = ?').get(visitId);
  assert.equal(done.status, 'done');
  assert.equal(done.icd_code, 'J02.9');
  r = await doc.get(`/visits/${visitId}/print`);
  assert.match(r.text, /Đơn thuốc/i);
  assert.match(r.text, /Paracetamol/);

  // Second invoice: lab test + medicine; paying dispenses stock
  await cash.get('/invoices');
  r = await cash.post(`/invoices/from-visit/${visitId}`, {});
  const inv2 = idFrom(r.location);
  assert.notEqual(inv2, inv1);
  const inv2Row = db.prepare('SELECT subtotal FROM invoices WHERE id = ?').get(inv2);
  assert.equal(inv2Row.subtotal, cbc.price + para.price * 10);
  await cash.get(`/invoices/${inv2}`);
  r = await cash.post(`/invoices/${inv2}/pay`, { payment_method: 'transfer', discount: '5000' });
  const paid = db.prepare('SELECT status, total FROM invoices WHERE id = ?').get(inv2);
  assert.equal(paid.status, 'paid');
  assert.equal(paid.total, inv2Row.subtotal - 5000);
  assert.equal(db.prepare('SELECT stock FROM medicines WHERE id = ?').get(para.id).stock, para.stock - 10);
  r = await cash.get(`/invoices/${inv2}/print`);
  assert.equal(r.status, 200);

  // Nothing left to bill
  await cash.get('/invoices');
  r = await cash.post(`/invoices/from-visit/${visitId}`, {});
  assert.equal(r.location, '/invoices');

  // Admin cancels the second invoice -> stock returns
  await admin.get(`/invoices/${inv2}`);
  r = await admin.post(`/invoices/${inv2}/cancel`, { reason: 'Nhập sai' });
  assert.equal(db.prepare('SELECT status FROM invoices WHERE id = ?').get(inv2).status, 'cancelled');
  assert.equal(db.prepare('SELECT stock FROM medicines WHERE id = ?').get(para.id).stock, para.stock);

  // Cashier cannot cancel invoices
  await cash.get(`/invoices/${inv1}`);
  r = await cash.post(`/invoices/${inv1}/cancel`, { reason: 'x' });
  assert.equal(r.status, 403);

  // Reports & CSV
  r = await cash.get('/reports');
  assert.equal(r.status, 200);
  assert.match(r.text, /Viêm họng cấp/);
  r = await cash.get('/reports/invoices.csv');
  assert.match(r.text, /HD0000/);

  // Insufficient stock blocks payment
  await rec.get(`/visits/new?patient_id=${patientId}`);
  r = await rec.post('/visits', { patient_id: String(patientId), department_id: String(noi.id) });
  const visit2 = idFrom(r.location);
  const syrup = db.prepare(`SELECT id, stock FROM medicines WHERE code = 'T012'`).get();
  await doc.get(`/visits/${visit2}`);
  await doc.post(`/visits/${visit2}/prescription`, { medicine_id: String(syrup.id), quantity: String(syrup.stock + 1) });
  await cash.get('/invoices');
  r = await cash.post(`/invoices/from-visit/${visit2}`, {});
  const inv3 = idFrom(r.location);
  await cash.get(`/invoices/${inv3}`);
  r = await cash.post(`/invoices/${inv3}/pay`, { payment_method: 'cash' });
  r = await cash.get(r.location);
  assert.match(r.text, /Không đủ tồn kho/);
  assert.equal(db.prepare('SELECT status FROM invoices WHERE id = ?').get(inv3).status, 'unpaid');
});

test('appointments: book, detect clash, check in', async () => {
  const rec = new Browser();
  await rec.login('letan', 'password123');
  const patientId = db.prepare('SELECT id FROM patients LIMIT 1').get().id;
  const doctorId = db.prepare(`SELECT id FROM users WHERE username = 'bs.an'`).get().id;
  const dept = db.prepare('SELECT id FROM departments LIMIT 1').get().id;
  const today = new Date().toLocaleDateString('sv-SE');
  await rec.get(`/appointments/new?patient_id=${patientId}`);
  const form = { patient_id: String(patientId), department_id: String(dept), doctor_id: String(doctorId), date: today, time: '09:30', reason: 'Tái khám' };
  let r = await rec.post('/appointments', form);
  assert.equal(r.status, 302);
  await rec.get(`/appointments/new?patient_id=${patientId}`);
  r = await rec.post('/appointments', form);
  assert.equal(r.status, 400);
  assert.match(r.text, /đã có lịch hẹn khác/);
  const apptId = db.prepare('SELECT id FROM appointments ORDER BY id DESC LIMIT 1').get().id;
  await rec.get('/appointments');
  r = await rec.post(`/appointments/${apptId}/checkin`, {});
  assert.equal(r.status, 302);
  const a = db.prepare('SELECT status, visit_id FROM appointments WHERE id = ?').get(apptId);
  assert.equal(a.status, 'checked_in');
  assert.ok(a.visit_id);
});

test('every main page renders for admin', async () => {
  const admin = new Browser();
  await admin.login('admin', 'admin12345');
  const visitId = db.prepare('SELECT id FROM visits LIMIT 1').get().id;
  const patientId = db.prepare('SELECT id FROM patients LIMIT 1').get().id;
  const invId = db.prepare('SELECT id FROM invoices LIMIT 1').get().id;
  const pages = ['/', '/patients', '/patients/new', `/patients/${patientId}`, `/patients/${patientId}/edit`,
    '/visits', '/visits/new', `/visits/${visitId}`, `/visits/${visitId}/print`, '/lab', '/lab?show=all', '/display',
    '/appointments', '/appointments?view=week', '/appointments/new', '/invoices', `/invoices/${invId}`, `/invoices/${invId}/print`,
    '/pharmacy', '/pharmacy?filter=low', '/pharmacy/new', '/pharmacy/1', '/pharmacy/1/edit', '/reports',
    '/admin/users', '/admin/users/new', '/admin/departments', '/admin/services', '/admin/audit', '/account/password'];
  for (const p of pages) {
    const r = await admin.get(p);
    assert.equal(r.status, 200, `${p} -> ${r.status}\n${r.text.slice(0, 500)}`);
  }
  assert.equal((await admin.get('/nope')).status, 404);
});

test('masks names on the public display', () => {
  assert.equal(maskName('Nguyễn Văn An'), 'N. V. AN');
  assert.equal(maskName('An'), 'AN');
});
