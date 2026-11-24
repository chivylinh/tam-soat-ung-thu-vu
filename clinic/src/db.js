'use strict';
const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');
const { hashPassword } = require('./auth');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'clinic.db');
if (DB_PATH !== ':memory:') fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

db.exec(`
CREATE TABLE IF NOT EXISTS departments (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  room TEXT,
  default_service_id INTEGER REFERENCES services(id),
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','doctor','technician','receptionist','cashier','pharmacist')),
  department_id INTEGER REFERENCES departments(id),
  title TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS patients (
  id INTEGER PRIMARY KEY,
  code TEXT UNIQUE,
  full_name TEXT NOT NULL,
  gender TEXT CHECK (gender IN ('M','F','O')),
  dob TEXT,
  phone TEXT,
  id_number TEXT,
  insurance_number TEXT,
  address TEXT,
  occupation TEXT,
  allergies TEXT,
  medical_history TEXT,
  emergency_contact TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_patients_name ON patients(full_name);
CREATE INDEX IF NOT EXISTS idx_patients_phone ON patients(phone);

CREATE TABLE IF NOT EXISTS services (
  id INTEGER PRIMARY KEY,
  code TEXT UNIQUE,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'Khám',
  price INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS medicines (
  id INTEGER PRIMARY KEY,
  code TEXT UNIQUE,
  name TEXT NOT NULL,
  active_ingredient TEXT,
  unit TEXT NOT NULL DEFAULT 'viên',
  price INTEGER NOT NULL DEFAULT 0,
  stock INTEGER NOT NULL DEFAULT 0,
  min_stock INTEGER NOT NULL DEFAULT 0,
  expiry_date TEXT,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS appointments (
  id INTEGER PRIMARY KEY,
  patient_id INTEGER NOT NULL REFERENCES patients(id),
  department_id INTEGER REFERENCES departments(id),
  doctor_id INTEGER REFERENCES users(id),
  scheduled_at TEXT NOT NULL,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','checked_in','cancelled','no_show')),
  visit_id INTEGER REFERENCES visits(id),
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_appt_time ON appointments(scheduled_at);

CREATE TABLE IF NOT EXISTS visits (
  id INTEGER PRIMARY KEY,
  patient_id INTEGER NOT NULL REFERENCES patients(id),
  department_id INTEGER REFERENCES departments(id),
  doctor_id INTEGER REFERENCES users(id),
  visit_date TEXT NOT NULL,
  queue_number INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting','in_progress','done','cancelled')),
  reason TEXT,
  pulse INTEGER, bp_systolic INTEGER, bp_diastolic INTEGER,
  temperature REAL, resp_rate INTEGER, spo2 INTEGER,
  weight REAL, height REAL,
  symptoms TEXT,
  examination TEXT,
  diagnosis TEXT,
  icd_code TEXT,
  treatment_plan TEXT,
  advice TEXT,
  follow_up_date TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  started_at TEXT,
  finished_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_visits_date ON visits(visit_date);
CREATE INDEX IF NOT EXISTS idx_visits_patient ON visits(patient_id);

CREATE TABLE IF NOT EXISTS visit_services (
  id INTEGER PRIMARY KEY,
  visit_id INTEGER NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
  service_id INTEGER NOT NULL REFERENCES services(id),
  price INTEGER NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  result TEXT,
  result_at TEXT,
  result_by INTEGER REFERENCES users(id),
  invoice_id INTEGER REFERENCES invoices(id),
  ordered_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS prescription_items (
  id INTEGER PRIMARY KEY,
  visit_id INTEGER NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
  medicine_id INTEGER NOT NULL REFERENCES medicines(id),
  quantity INTEGER NOT NULL,
  price INTEGER NOT NULL,
  dosage TEXT,
  days INTEGER,
  invoice_id INTEGER REFERENCES invoices(id)
);

CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY,
  code TEXT UNIQUE,
  visit_id INTEGER NOT NULL REFERENCES visits(id),
  patient_id INTEGER NOT NULL REFERENCES patients(id),
  subtotal INTEGER NOT NULL DEFAULT 0,
  discount INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'unpaid' CHECK (status IN ('unpaid','paid','cancelled')),
  payment_method TEXT,
  paid_at TEXT,
  cashier_id INTEGER REFERENCES users(id),
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_invoice_visit_unpaid ON invoices(visit_id) WHERE status = 'unpaid';
CREATE INDEX IF NOT EXISTS idx_invoice_visit ON invoices(visit_id);

CREATE TABLE IF NOT EXISTS invoice_items (
  id INTEGER PRIMARY KEY,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  item_type TEXT NOT NULL CHECK (item_type IN ('service','medicine')),
  ref_id INTEGER NOT NULL,
  description TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  unit_price INTEGER NOT NULL,
  amount INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS stock_movements (
  id INTEGER PRIMARY KEY,
  medicine_id INTEGER NOT NULL REFERENCES medicines(id),
  change INTEGER NOT NULL,
  reason TEXT NOT NULL,
  ref TEXT,
  user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  action TEXT NOT NULL,
  entity TEXT,
  entity_id INTEGER,
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS sessions (
  sid TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  expires INTEGER NOT NULL
);
`);

/** Add a column to an existing table if it is missing (simple forward-only migrations). */
function ensureColumn(table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

// v1.1 — BHYT, reminders, CLS result sheets
ensureColumn('patients', 'insurance_valid_from', 'TEXT');
ensureColumn('patients', 'insurance_valid_to', 'TEXT');
ensureColumn('patients', 'insurance_reg_place', 'TEXT');      // mã nơi đăng ký KCB ban đầu (MA_DKBD)
ensureColumn('patients', 'insurance_benefit', 'INTEGER');     // mức hưởng % (80/95/100)
ensureColumn('departments', 'bhyt_code', 'TEXT');             // MA_KHOA
ensureColumn('users', 'license_no', 'TEXT');                  // số chứng chỉ hành nghề (MA_BAC_SI)
ensureColumn('services', 'bhyt_code', 'TEXT');                // mã DVKT theo danh mục BHYT
ensureColumn('medicines', 'bhyt_code', 'TEXT');               // mã thuốc theo danh mục BHYT
ensureColumn('medicines', 'strength', 'TEXT');                // hàm lượng
ensureColumn('medicines', 'route', 'TEXT');                   // đường dùng
ensureColumn('medicines', 'reg_no', 'TEXT');                  // số đăng ký
ensureColumn('visits', 'bhyt', 'INTEGER NOT NULL DEFAULT 0'); // khám BHYT
ensureColumn('visits', 'follow_up_reminded_at', 'TEXT');
ensureColumn('appointments', 'reminded_at', 'TEXT');
ensureColumn('invoices', 'insurance_amount', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('invoice_items', 'bhyt_covered', 'INTEGER NOT NULL DEFAULT 0');

/** Run fn inside a transaction; rolls back on error. */
function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function audit(userId, action, entity, entityId, detail) {
  db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?,?,?,?,?)')
    .run(userId ?? null, action, entity ?? null, entityId ?? null, detail ?? null);
}

function seed() {
  const hasUsers = db.prepare('SELECT COUNT(*) AS n FROM users').get().n > 0;
  if (hasUsers) return;

  tx(() => {
    const depts = [
      ['Nội tổng quát', 'P.101'], ['Ngoại tổng quát', 'P.102'], ['Nhi', 'P.103'],
      ['Sản - Phụ khoa', 'P.201'], ['Tai - Mũi - Họng', 'P.202'], ['Răng - Hàm - Mặt', 'P.203'],
      ['Mắt', 'P.204'], ['Da liễu', 'P.205'], ['Chẩn đoán hình ảnh', 'P.301'], ['Xét nghiệm', 'P.302'],
    ];
    const insDept = db.prepare('INSERT INTO departments (name, room) VALUES (?, ?)');
    for (const d of depts) insDept.run(...d);

    const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';
    db.prepare(`INSERT INTO users (username, password_hash, full_name, role) VALUES (?,?,?,?)`)
      .run('admin', hashPassword(adminPassword), 'Quản trị hệ thống', 'admin');

    const services = [
      ['KB01', 'Khám bệnh nội tổng quát', 'Khám', 150000],
      ['KB02', 'Khám ngoại', 'Khám', 150000],
      ['KB03', 'Khám nhi', 'Khám', 150000],
      ['KB04', 'Khám sản - phụ khoa', 'Khám', 200000],
      ['KB05', 'Khám tai mũi họng', 'Khám', 150000],
      ['KB06', 'Khám răng hàm mặt', 'Khám', 100000],
      ['KB07', 'Khám mắt', 'Khám', 150000],
      ['KB08', 'Khám da liễu', 'Khám', 150000],
      ['XN01', 'Tổng phân tích tế bào máu', 'Xét nghiệm', 90000],
      ['XN02', 'Đường huyết lúc đói (Glucose)', 'Xét nghiệm', 40000],
      ['XN03', 'Bộ mỡ máu (Cholesterol, TG, HDL, LDL)', 'Xét nghiệm', 160000],
      ['XN04', 'Chức năng gan (AST, ALT, GGT)', 'Xét nghiệm', 120000],
      ['XN05', 'Chức năng thận (Ure, Creatinin)', 'Xét nghiệm', 80000],
      ['XN06', 'Tổng phân tích nước tiểu', 'Xét nghiệm', 50000],
      ['XN07', 'HbA1c', 'Xét nghiệm', 150000],
      ['CD01', 'Siêu âm ổ bụng tổng quát', 'Chẩn đoán hình ảnh', 200000],
      ['CD02', 'Siêu âm tuyến giáp', 'Chẩn đoán hình ảnh', 180000],
      ['CD03', 'Siêu âm tuyến vú', 'Chẩn đoán hình ảnh', 200000],
      ['CD04', 'X-quang ngực thẳng', 'Chẩn đoán hình ảnh', 150000],
      ['CD05', 'Điện tim (ECG)', 'Thăm dò chức năng', 100000],
      ['CD06', 'Chụp nhũ ảnh (Mammography)', 'Chẩn đoán hình ảnh', 500000],
      ['TT01', 'Thay băng, rửa vết thương', 'Thủ thuật', 80000],
      ['TT02', 'Khâu vết thương', 'Thủ thuật', 250000],
      ['TT03', 'Tiêm', 'Thủ thuật', 30000],
    ];
    const insSvc = db.prepare('INSERT INTO services (code, name, category, price) VALUES (?,?,?,?)');
    for (const s of services) insSvc.run(...s);

    // Default exam service per department (used when checking a patient in)
    const defaults = { 'Nội tổng quát': 'KB01', 'Ngoại tổng quát': 'KB02', Nhi: 'KB03', 'Sản - Phụ khoa': 'KB04',
      'Tai - Mũi - Họng': 'KB05', 'Răng - Hàm - Mặt': 'KB06', 'Mắt': 'KB07', 'Da liễu': 'KB08' };
    for (const [dept, code] of Object.entries(defaults)) {
      db.prepare('UPDATE departments SET default_service_id = (SELECT id FROM services WHERE code = ?) WHERE name = ?').run(code, dept);
    }

    const meds = [
      ['T001', 'Paracetamol 500mg', 'Paracetamol', 'viên', 1000, 1000, 100],
      ['T002', 'Amoxicillin 500mg', 'Amoxicillin', 'viên', 2000, 500, 100],
      ['T003', 'Cefuroxim 500mg', 'Cefuroxim', 'viên', 8000, 300, 50],
      ['T004', 'Omeprazol 20mg', 'Omeprazol', 'viên', 1500, 400, 50],
      ['T005', 'Loratadin 10mg', 'Loratadin', 'viên', 1200, 300, 50],
      ['T006', 'Metformin 500mg', 'Metformin', 'viên', 1000, 600, 100],
      ['T007', 'Amlodipin 5mg', 'Amlodipin', 'viên', 1500, 600, 100],
      ['T008', 'Ibuprofen 400mg', 'Ibuprofen', 'viên', 1500, 300, 50],
      ['T009', 'Vitamin C 500mg', 'Acid ascorbic', 'viên', 800, 500, 50],
      ['T010', 'Oresol', 'Oresol', 'gói', 3000, 200, 30],
      ['T011', 'Natri clorid 0,9% 10ml', 'Natri clorid', 'lọ', 4000, 100, 20],
      ['T012', 'Siro ho thảo dược 100ml', '', 'chai', 45000, 40, 10],
    ];
    const insMed = db.prepare(`INSERT INTO medicines (code, name, active_ingredient, unit, price, stock, min_stock)
                               VALUES (?,?,?,?,?,?,?)`);
    for (const m of meds) insMed.run(...m);
  });
}

seed();

module.exports = { db, tx, audit, DB_PATH };
