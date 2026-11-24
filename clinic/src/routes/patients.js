'use strict';
const express = require('express');
const { db, tx, audit } = require('../db');
const { requireLogin, requireRole } = require('../auth');
const { str, isDate, int, today } = require('../helpers');

const router = express.Router();
router.use(requireLogin);

const FIELDS = ['full_name', 'gender', 'dob', 'phone', 'id_number', 'insurance_number', 'address',
  'occupation', 'allergies', 'medical_history', 'emergency_contact',
  'insurance_valid_from', 'insurance_valid_to', 'insurance_reg_place', 'insurance_benefit'];

function readPatient(body) {
  const p = {};
  for (const f of FIELDS) p[f] = str(body[f]);
  const errors = [];
  if (!p.full_name) errors.push('Vui lòng nhập họ tên.');
  if (p.gender && !['M', 'F', 'O'].includes(p.gender)) errors.push('Giới tính không hợp lệ.');
  if (p.dob && !isDate(p.dob)) errors.push('Ngày sinh không hợp lệ.');
  if (p.dob && p.dob > today()) errors.push('Ngày sinh không được ở tương lai.');
  if (p.phone && !/^[0-9+\-\s().]{8,15}$/.test(p.phone)) errors.push('Số điện thoại không hợp lệ.');
  if (p.insurance_number) {
    p.insurance_number = p.insurance_number.replace(/\s+/g, '').toUpperCase();
    if (!/^[A-Z0-9]{10,15}$/.test(p.insurance_number)) errors.push('Số thẻ BHYT không hợp lệ (10–15 ký tự chữ và số).');
  }
  for (const f of ['insurance_valid_from', 'insurance_valid_to']) if (p[f] && !isDate(p[f])) errors.push('Hạn thẻ BHYT không hợp lệ.');
  if (p.insurance_valid_from && p.insurance_valid_to && p.insurance_valid_from > p.insurance_valid_to) errors.push('Hạn thẻ BHYT: ngày bắt đầu sau ngày kết thúc.');
  p.insurance_benefit = p.insurance_benefit ? Number(p.insurance_benefit) : null;
  if (p.insurance_benefit !== null && ![80, 95, 100].includes(p.insurance_benefit)) errors.push('Mức hưởng BHYT phải là 80, 95 hoặc 100%.');
  return { p, errors };
}

function searchPatients(q, limit = 20) {
  if (!q) return [];
  const like = `%${q}%`;
  return db.prepare(`SELECT id, code, full_name, phone, dob, gender FROM patients
    WHERE full_name LIKE ? OR phone LIKE ? OR code LIKE ? OR id_number LIKE ? OR insurance_number LIKE ?
    ORDER BY id DESC LIMIT ?`).all(like, like, like, like, like, limit);
}

function createPatient(p, userId) {
  return tx(() => {
    const r = db.prepare(`INSERT INTO patients (${FIELDS.join(',')}) VALUES (${FIELDS.map(() => '?').join(',')})`)
      .run(...FIELDS.map((f) => p[f]));
    const id = Number(r.lastInsertRowid);
    db.prepare('UPDATE patients SET code = ? WHERE id = ?').run(`BN${String(id).padStart(6, '0')}`, id);
    audit(userId, 'create', 'patient', id);
    return id;
  });
}

router.get('/', (req, res) => {
  const q = str(req.query.q);
  const page = Math.max(1, int(req.query.page) || 1);
  const size = 25;
  let where = '';
  const params = [];
  if (q) {
    where = `WHERE full_name LIKE ? OR phone LIKE ? OR code LIKE ? OR id_number LIKE ? OR insurance_number LIKE ?`;
    const like = `%${q}%`;
    params.push(like, like, like, like, like);
  }
  const total = db.prepare(`SELECT COUNT(*) AS n FROM patients ${where}`).get(...params).n;
  const patients = db.prepare(`SELECT p.*, (SELECT MAX(visit_date) FROM visits v WHERE v.patient_id = p.id) AS last_visit
    FROM patients p ${where} ORDER BY p.id DESC LIMIT ? OFFSET ?`).all(...params, size, (page - 1) * size);
  res.render('patients/list', { title: 'Bệnh nhân', patients, q, page, pages: Math.max(1, Math.ceil(total / size)), total });
});

// JSON search for pickers
router.get('/search.json', (req, res) => {
  const q = str(req.query.q);
  if (!q) return res.json([]);
  const like = `%${q}%`;
  res.json(db.prepare(`SELECT id, code, full_name, phone, dob, gender FROM patients
    WHERE full_name LIKE ? OR phone LIKE ? OR code LIKE ? ORDER BY id DESC LIMIT 10`).all(like, like, like));
});

router.get('/new', requireRole('receptionist', 'doctor'), (req, res) => {
  res.render('patients/form', { title: 'Thêm bệnh nhân', p: {}, errors: [], action: '/patients' });
});

router.post('/', requireRole('receptionist', 'doctor'), (req, res) => {
  const { p, errors } = readPatient(req.body);
  if (errors.length) return res.status(400).render('patients/form', { title: 'Thêm bệnh nhân', p, errors, action: '/patients' });
  const id = createPatient(p, req.user.id);
  req.flash('ok', 'Đã thêm bệnh nhân.');
  const next = [].concat(req.body.next || []).filter(Boolean).pop();
  if (next === 'checkin') return res.redirect(`/visits/new?patient_id=${id}`);
  if (next === 'appointment') return res.redirect(`/appointments/new?patient_id=${id}`);
  res.redirect(`/patients/${id}`);
});

function loadPatient(req, res, next) {
  const p = db.prepare('SELECT * FROM patients WHERE id = ?').get(int(req.params.id));
  if (!p) return res.status(404).render('error', { title: 'Không tìm thấy', message: 'Không tìm thấy bệnh nhân.' });
  req.patient = p;
  next();
}

router.get('/:id', loadPatient, (req, res) => {
  const p = req.patient;
  const visits = db.prepare(`SELECT v.*, dp.name AS dept_name, u.full_name AS doctor_name
    FROM visits v LEFT JOIN departments dp ON dp.id = v.department_id LEFT JOIN users u ON u.id = v.doctor_id
    WHERE v.patient_id = ? ORDER BY v.visit_date DESC, v.id DESC`).all(p.id);
  const appointments = db.prepare(`SELECT a.*, dp.name AS dept_name, u.full_name AS doctor_name
    FROM appointments a LEFT JOIN departments dp ON dp.id = a.department_id LEFT JOIN users u ON u.id = a.doctor_id
    WHERE a.patient_id = ? ORDER BY a.scheduled_at DESC LIMIT 20`).all(p.id);
  const invoices = db.prepare(`SELECT * FROM invoices WHERE patient_id = ? ORDER BY id DESC LIMIT 20`).all(p.id);
  res.render('patients/show', { title: p.full_name, p, visits, appointments, invoices });
});

router.get('/:id/edit', requireRole('receptionist', 'doctor'), loadPatient, (req, res) => {
  res.render('patients/form', { title: 'Sửa thông tin bệnh nhân', p: req.patient, errors: [], action: `/patients/${req.patient.id}` });
});

router.post('/:id', requireRole('receptionist', 'doctor'), loadPatient, (req, res) => {
  const { p, errors } = readPatient(req.body);
  if (errors.length) {
    return res.status(400).render('patients/form', { title: 'Sửa thông tin bệnh nhân', p: { ...p, id: req.patient.id, code: req.patient.code }, errors, action: `/patients/${req.patient.id}` });
  }
  db.prepare(`UPDATE patients SET ${FIELDS.map((f) => `${f} = ?`).join(', ')} WHERE id = ?`)
    .run(...FIELDS.map((f) => p[f]), req.patient.id);
  audit(req.user.id, 'update', 'patient', req.patient.id);
  req.flash('ok', 'Đã cập nhật thông tin bệnh nhân.');
  res.redirect(`/patients/${req.patient.id}`);
});

module.exports = router;
module.exports.createPatient = createPatient;
module.exports.searchPatients = searchPatients;
