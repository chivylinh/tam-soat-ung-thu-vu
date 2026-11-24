'use strict';
const express = require('express');
const { db, audit } = require('../db');
const { requireLogin, requireRole } = require('../auth');
const { str, int, isDate, today, addDays, APPT_STATUS } = require('../helpers');
const clinical = require('../clinical');
const { searchPatients } = require('./patients');

const router = express.Router();
router.use(requireLogin);

const lookups = () => ({
  departments: db.prepare('SELECT * FROM departments WHERE active = 1 ORDER BY name').all(),
  doctors: db.prepare(`SELECT id, full_name, title, department_id FROM users WHERE role = 'doctor' AND active = 1 ORDER BY full_name`).all(),
});

router.get('/', (req, res) => {
  const date = isDate(req.query.date) ? req.query.date : today();
  const view = req.query.view === 'week' ? 'week' : 'day';
  const from = date;
  const to = view === 'week' ? addDays(date, 6) : date;
  const departmentId = int(req.query.department_id);
  const doctorId = int(req.query.doctor_id);
  const where = ['substr(a.scheduled_at,1,10) BETWEEN ? AND ?'];
  const params = [from, to];
  if (departmentId) { where.push('a.department_id = ?'); params.push(departmentId); }
  if (doctorId) { where.push('a.doctor_id = ?'); params.push(doctorId); }
  const appointments = db.prepare(`SELECT a.*, p.full_name, p.phone, p.code, dp.name AS dept_name, u.full_name AS doctor_name
    FROM appointments a JOIN patients p ON p.id = a.patient_id
    LEFT JOIN departments dp ON dp.id = a.department_id LEFT JOIN users u ON u.id = a.doctor_id
    WHERE ${where.join(' AND ')} ORDER BY a.scheduled_at`).all(...params);
  res.render('appointments/list', {
    title: 'Lịch hẹn', appointments, date, view, from, to, departmentId, doctorId,
    prev: addDays(date, view === 'week' ? -7 : -1), next: addDays(date, view === 'week' ? 7 : 1), ...lookups(),
  });
});

function readForm(body) {
  const f = {
    patient_id: int(body.patient_id),
    department_id: int(body.department_id),
    doctor_id: int(body.doctor_id),
    date: str(body.date),
    time: str(body.time),
    reason: str(body.reason),
  };
  const errors = [];
  if (!f.patient_id || !db.prepare('SELECT 1 FROM patients WHERE id = ?').get(f.patient_id)) errors.push('Vui lòng chọn bệnh nhân.');
  if (!isDate(f.date)) errors.push('Ngày hẹn không hợp lệ.');
  if (!f.time || !/^\d{2}:\d{2}$/.test(f.time)) errors.push('Giờ hẹn không hợp lệ.');
  if (!f.department_id) errors.push('Vui lòng chọn chuyên khoa.');
  f.scheduled_at = `${f.date} ${f.time}:00`;
  if (!errors.length && f.doctor_id) {
    const clash = db.prepare(`SELECT 1 FROM appointments WHERE doctor_id = ? AND scheduled_at = ? AND status = 'scheduled' AND id != ?`)
      .get(f.doctor_id, f.scheduled_at, int(body.id) || 0);
    if (clash) errors.push('Bác sĩ đã có lịch hẹn khác vào giờ này.');
  }
  return { f, errors };
}

const patientOf = (id) => (id ? db.prepare('SELECT * FROM patients WHERE id = ?').get(id) : null);

router.get('/new', requireRole('receptionist', 'doctor'), (req, res) => {
  const f = { date: isDate(req.query.date) ? req.query.date : today(), time: '08:00', patient_id: int(req.query.patient_id) };
  const q = str(req.query.q);
  res.render('appointments/form', { title: 'Đặt lịch hẹn', f, patient: patientOf(f.patient_id), q, results: searchPatients(q), errors: [], action: '/appointments', ...lookups() });
});

router.post('/', requireRole('receptionist', 'doctor'), (req, res) => {
  const { f, errors } = readForm(req.body);
  if (errors.length) {
    return res.status(400).render('appointments/form', { title: 'Đặt lịch hẹn', f, patient: patientOf(f.patient_id), q: null, results: [], errors, action: '/appointments', ...lookups() });
  }
  const r = db.prepare(`INSERT INTO appointments (patient_id, department_id, doctor_id, scheduled_at, reason, created_by)
    VALUES (?,?,?,?,?,?)`).run(f.patient_id, f.department_id, f.doctor_id, f.scheduled_at, f.reason, req.user.id);
  audit(req.user.id, 'create', 'appointment', Number(r.lastInsertRowid));
  req.flash('ok', 'Đã đặt lịch hẹn.');
  res.redirect(`/appointments?date=${f.date}`);
});

function loadAppt(req, res, next) {
  const a = db.prepare('SELECT * FROM appointments WHERE id = ?').get(int(req.params.id));
  if (!a) return res.status(404).render('error', { title: 'Không tìm thấy', message: 'Không tìm thấy lịch hẹn.' });
  req.appt = a;
  next();
}

router.get('/:id/edit', requireRole('receptionist', 'doctor'), loadAppt, (req, res) => {
  const a = req.appt;
  const f = { ...a, date: a.scheduled_at.slice(0, 10), time: a.scheduled_at.slice(11, 16) };
  res.render('appointments/form', { title: 'Sửa lịch hẹn', f, patient: patientOf(a.patient_id), q: null, results: [], errors: [], action: `/appointments/${a.id}`, ...lookups() });
});

router.post('/:id', requireRole('receptionist', 'doctor'), loadAppt, (req, res) => {
  if (req.appt.status !== 'scheduled') {
    req.flash('error', 'Chỉ sửa được lịch hẹn chưa tiếp đón.');
    return res.redirect('/appointments');
  }
  const { f, errors } = readForm({ ...req.body, id: req.appt.id });
  if (errors.length) {
    return res.status(400).render('appointments/form', { title: 'Sửa lịch hẹn', f: { ...f, id: req.appt.id }, patient: patientOf(f.patient_id), q: null, results: [], errors, action: `/appointments/${req.appt.id}`, ...lookups() });
  }
  db.prepare(`UPDATE appointments SET patient_id = ?, department_id = ?, doctor_id = ?, scheduled_at = ?, reason = ? WHERE id = ?`)
    .run(f.patient_id, f.department_id, f.doctor_id, f.scheduled_at, f.reason, req.appt.id);
  audit(req.user.id, 'update', 'appointment', req.appt.id);
  req.flash('ok', 'Đã cập nhật lịch hẹn.');
  res.redirect(`/appointments?date=${f.date}`);
});

router.post('/:id/status', requireRole('receptionist', 'doctor'), loadAppt, (req, res) => {
  const status = req.body.status;
  const a = req.appt;
  const date = a.scheduled_at.slice(0, 10);
  if (!['cancelled', 'no_show', 'scheduled'].includes(status) || a.status === 'checked_in') {
    req.flash('error', 'Thao tác không hợp lệ.');
    return res.redirect(`/appointments?date=${date}`);
  }
  db.prepare('UPDATE appointments SET status = ? WHERE id = ?').run(status, a.id);
  audit(req.user.id, `status:${status}`, 'appointment', a.id);
  req.flash('ok', `Đã chuyển trạng thái: ${APPT_STATUS[status][0]}.`);
  res.redirect(`/appointments?date=${date}`);
});

// Check-in: turn an appointment into a visit in today's queue
router.post('/:id/checkin', requireRole('receptionist', 'doctor'), loadAppt, (req, res) => {
  const a = req.appt;
  if (a.status !== 'scheduled') {
    req.flash('error', 'Lịch hẹn này không ở trạng thái chờ tiếp đón.');
    return res.redirect('/appointments');
  }
  const dept = a.department_id ? db.prepare('SELECT default_service_id FROM departments WHERE id = ?').get(a.department_id) : null;
  const visitId = clinical.createVisit({
    patientId: a.patient_id, departmentId: a.department_id, doctorId: a.doctor_id,
    reason: a.reason, serviceId: int(req.body.service_id) || dept?.default_service_id || null, userId: req.user.id,
  });
  db.prepare(`UPDATE appointments SET status = 'checked_in', visit_id = ? WHERE id = ?`).run(visitId, a.id);
  const v = db.prepare('SELECT queue_number FROM visits WHERE id = ?').get(visitId);
  req.flash('ok', `Đã tiếp đón từ lịch hẹn. Số thứ tự: ${v.queue_number}.`);
  res.redirect(`/visits/${visitId}`);
});

module.exports = router;
