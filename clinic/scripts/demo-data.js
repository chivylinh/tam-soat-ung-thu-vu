'use strict';
// Fill the database with demo staff, patients and today's activity. Usage: npm run demo
require('../src/config');
const { db } = require('../src/db');
const { hashPassword } = require('../src/auth');
const clinical = require('../src/clinical');
const { createPatient } = require('../src/routes/patients');
const { today, addDays } = require('../src/helpers');

if (db.prepare('SELECT COUNT(*) AS n FROM patients').get().n > 0) {
  console.log('Cơ sở dữ liệu đã có bệnh nhân — bỏ qua tạo dữ liệu mẫu.');
  process.exit(0);
}

const dept = (name) => db.prepare('SELECT id FROM departments WHERE name = ?').get(name).id;
const pw = hashPassword('matkhau123');
const staff = [
  ['bs.minh', 'Trần Quang Minh', 'doctor', 'Nội tổng quát', 'BS.CKI'],
  ['bs.lan', 'Lê Thị Lan', 'doctor', 'Nhi', 'ThS.BS'],
  ['bs.hung', 'Phạm Văn Hùng', 'doctor', 'Tai - Mũi - Họng', 'BS'],
  ['bs.thu', 'Ngô Minh Thư', 'doctor', 'Sản - Phụ khoa', 'BS.CKII'],
  ['ktv.nam', 'Đỗ Hoài Nam', 'technician', 'Xét nghiệm', 'KTV'],
  ['letan', 'Vũ Thị Hoa', 'receptionist', null, null],
  ['thungan', 'Bùi Thanh Tâm', 'cashier', null, null],
  ['duocsi', 'Hoàng Gia Bảo', 'pharmacist', null, 'DS'],
];
const ins = db.prepare('INSERT INTO users (username, password_hash, full_name, role, department_id, title) VALUES (?,?,?,?,?,?)');
for (const [u, n, r, d, t] of staff) ins.run(u, pw, n, r, d ? dept(d) : null, t);
const uid = (u) => db.prepare('SELECT id FROM users WHERE username = ?').get(u).id;

const people = [
  ['Nguyễn Văn An', 'M', '1978-03-14', '0912345601', 'Hà Đông, Hà Nội'],
  ['Trần Thị Bích', 'F', '1990-11-02', '0912345602', 'Cầu Giấy, Hà Nội'],
  ['Lê Minh Khang', 'M', '2019-06-20', '0912345603', 'Thanh Xuân, Hà Nội'],
  ['Phạm Thu Hà', 'F', '1985-01-30', '0912345604', 'Long Biên, Hà Nội'],
  ['Hoàng Đức Long', 'M', '1962-09-09', '0912345605', 'Đống Đa, Hà Nội'],
  ['Vũ Ngọc Ánh', 'F', '1999-12-25', '0912345606', 'Hoàng Mai, Hà Nội'],
  ['Đặng Quốc Bảo', 'M', '2015-04-04', '0912345607', 'Ba Đình, Hà Nội'],
  ['Bùi Thị Mai', 'F', '1972-07-17', '0912345608', 'Tây Hồ, Hà Nội'],
  ['Đỗ Thành Công', 'M', '1988-02-11', '0912345609', 'Nam Từ Liêm, Hà Nội'],
  ['Ngô Thị Hạnh', 'F', '1995-05-05', '0912345610', 'Gia Lâm, Hà Nội'],
];
const admin = uid('admin');
const pids = people.map(([full_name, gender, dob, phone, address], i) => createPatient({
  full_name, gender, dob, phone, address, id_number: null, insurance_number: i % 3 === 0 ? `DN40101${String(1000000 + i)}` : null,
  occupation: null, allergies: i === 0 ? 'Penicillin' : null, medical_history: i === 4 ? 'Tăng huyết áp 10 năm, đang dùng Amlodipin' : null, emergency_contact: null,
}, admin));

const svc = (code) => db.prepare('SELECT id FROM services WHERE code = ?').get(code).id;
const med = (code) => db.prepare('SELECT id FROM medicines WHERE code = ?').get(code).id;
const plan = [
  [0, 'Nội tổng quát', 'KB01', 'bs.minh', 'Sốt, ho 3 ngày', 'done', 'Viêm phế quản cấp', 'J20.9', ['XN01', 'CD04'], [['T003', 14], ['T001', 10]]],
  [4, 'Nội tổng quát', 'KB01', 'bs.minh', 'Kiểm tra huyết áp định kỳ', 'done', 'Tăng huyết áp vô căn', 'I10', ['XN03', 'CD05'], [['T007', 30]]],
  [7, 'Nội tổng quát', 'KB01', 'bs.minh', 'Mệt mỏi, khát nước', 'in_progress', null, null, ['XN02', 'XN07'], []],
  [8, 'Nội tổng quát', 'KB01', null, 'Đau thượng vị', 'waiting', null, null, [], []],
  [1, 'Nội tổng quát', 'KB01', null, 'Khám sức khỏe', 'waiting', null, null, [], []],
  [2, 'Nhi', 'KB03', 'bs.lan', 'Sốt cao, quấy khóc', 'done', 'Viêm họng cấp', 'J02.9', [], [['T001', 6], ['T010', 5]]],
  [6, 'Nhi', 'KB03', 'bs.lan', 'Tiêu chảy', 'waiting', null, null, [], []],
  [9, 'Tai - Mũi - Họng', 'KB05', 'bs.hung', 'Nghẹt mũi, chảy mũi', 'in_progress', null, null, [], []],
  [3, 'Sản - Phụ khoa', 'KB04', 'bs.thu', 'Khám phụ khoa định kỳ', 'waiting', null, null, [], []],
  [5, 'Da liễu', 'KB08', null, 'Nổi mẩn ngứa', 'waiting', null, null, [], []],
];
for (const [pi, d, s, doc, reason, status, dx, icd, orders, rx] of plan) {
  const vid = clinical.createVisit({ patientId: pids[pi], departmentId: dept(d), doctorId: doc ? uid(doc) : null, reason, serviceId: svc(s), userId: uid('letan') });
  for (const o of orders) clinical.addService(vid, svc(o), doc ? uid(doc) : admin);
  for (const [m, q] of rx) clinical.addPrescription(vid, { medicineId: med(m), quantity: q, dosage: 'Uống 1 viên x 2 lần/ngày, sau ăn', days: 7 });
  db.prepare(`UPDATE visits SET status = ?, diagnosis = ?, icd_code = ?, pulse = 82, bp_systolic = 125, bp_diastolic = 80, temperature = 37.2,
    weight = 62, height = 165, follow_up_date = ? WHERE id = ?`).run(status, dx, icd, dx ? addDays(today(), 5) : null, vid);
  if (orders.includes('XN01')) db.prepare(`UPDATE visit_services SET result = 'WBC 11.8 G/L, NEU 78%' WHERE visit_id = ? AND service_id = ?`).run(vid, svc('XN01'));
  if (status === 'done') {
    const inv = clinical.syncInvoice(vid, uid('thungan'));
    clinical.payInvoice(inv, { method: pi % 2 ? 'transfer' : 'cash', discount: 0 }, uid('thungan'));
  } else {
    // consultation fee paid up front
    const inv = clinical.syncInvoice(vid, uid('thungan'));
    if (status === 'in_progress') clinical.payInvoice(inv, { method: 'cash', discount: 0 }, uid('thungan'));
  }
}
db.prepare(`INSERT INTO appointments (patient_id, department_id, doctor_id, scheduled_at, reason, created_by) VALUES (?,?,?,?,?,?)`)
  .run(pids[1], dept('Sản - Phụ khoa'), uid('bs.thu'), `${today()} 15:30:00`, 'Siêu âm thai', uid('letan'));
db.prepare(`INSERT INTO appointments (patient_id, department_id, doctor_id, scheduled_at, reason, created_by) VALUES (?,?,?,?,?,?)`)
  .run(pids[4], dept('Nội tổng quát'), uid('bs.minh'), `${addDays(today(), 1)} 08:00:00`, 'Tái khám huyết áp', uid('letan'));
db.prepare(`UPDATE medicines SET stock = 8 WHERE code = 'T012'`).run();

console.log('Đã tạo dữ liệu mẫu. Tài khoản nhân viên (mật khẩu: matkhau123):');
for (const [u, n, r] of staff) console.log(`  ${u.padEnd(10)} ${r.padEnd(13)} ${n}`);
