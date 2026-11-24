'use strict';
const express = require('express');
const { db, audit } = require('../db');
const { requireLogin, requireRole } = require('../auth');
const { str, int, num, isDate, today, nowStr, VISIT_STATUS } = require('../helpers');
const clinical = require('../clinical');
const { searchPatients } = require('./patients');
const bhyt = require('../bhyt');

const router = express.Router();
router.use(requireLogin);

const lookups = () => ({
  departments: db.prepare('SELECT * FROM departments WHERE active = 1 ORDER BY name').all(),
  doctors: db.prepare(`SELECT id, full_name, title, department_id FROM users WHERE role = 'doctor' AND active = 1 ORDER BY full_name`).all(),
  examServices: db.prepare(`SELECT * FROM services WHERE active = 1 AND category = 'Khám' ORDER BY code`).all(),
});

// Queue / list of visits for a day
router.get('/', (req, res) => {
  const date = isDate(req.query.date) ? req.query.date : today();
  const status = VISIT_STATUS[req.query.status] ? req.query.status : null;
  const departmentId = int(req.query.department_id);
  const mine = req.query.mine === '1';
  const where = ['v.visit_date = ?'];
  const params = [date];
  if (status) { where.push('v.status = ?'); params.push(status); }
  if (departmentId) { where.push('v.department_id = ?'); params.push(departmentId); }
  if (mine) { where.push('v.doctor_id = ?'); params.push(req.user.id); }
  const visits = db.prepare(`SELECT v.*, p.full_name, p.code, p.gender, p.dob, p.phone,
      dp.name AS dept_name, u.full_name AS doctor_name,
      (SELECT COUNT(*) FROM invoices i WHERE i.visit_id = v.id AND i.status = 'paid') AS paid_count
    FROM visits v JOIN patients p ON p.id = v.patient_id
    LEFT JOIN departments dp ON dp.id = v.department_id
    LEFT JOIN users u ON u.id = v.doctor_id
    WHERE ${where.join(' AND ')}
    ORDER BY CASE v.status WHEN 'in_progress' THEN 0 WHEN 'waiting' THEN 1 WHEN 'done' THEN 2 ELSE 3 END,
             v.queue_number`).all(...params);
  res.render('visits/list', { title: 'Tiếp đón & hàng đợi khám', visits, date, status, departmentId, mine, ...lookups() });
});

// Reception: register a new visit
router.get('/new', requireRole('receptionist', 'doctor'), (req, res) => {
  const patient = int(req.query.patient_id)
    ? db.prepare('SELECT * FROM patients WHERE id = ?').get(int(req.query.patient_id)) : null;
  const q = str(req.query.q);
  res.render('visits/new', { title: 'Tiếp đón bệnh nhân', patient, q, results: searchPatients(q), errors: [], form: {}, ...lookups() });
});

router.post('/', requireRole('receptionist', 'doctor'), (req, res) => {
  const form = {
    patientId: int(req.body.patient_id),
    departmentId: int(req.body.department_id),
    doctorId: int(req.body.doctor_id),
    serviceId: int(req.body.service_id),
    reason: str(req.body.reason),
    bhyt: req.body.bhyt === '1',
  };
  const errors = [];
  if (!form.patientId) errors.push('Vui lòng chọn bệnh nhân.');
  if (form.bhyt && form.patientId) {
    const pt = db.prepare('SELECT * FROM patients WHERE id = ?').get(form.patientId);
    const c = bhyt.coverage({ bhyt: 1, visit_date: today() }, pt);
    if (!c.eligible) errors.push(`Không thể khám BHYT: ${c.reasons.join('; ')}.`);
  }
  if (!form.departmentId) errors.push('Vui lòng chọn chuyên khoa.');
  if (errors.length) {
    const patient = form.patientId ? db.prepare('SELECT * FROM patients WHERE id = ?').get(form.patientId) : null;
    return res.status(400).render('visits/new', { title: 'Tiếp đón bệnh nhân', patient, q: null, results: [], errors, form, ...lookups() });
  }
  const id = clinical.createVisit({ ...form, userId: req.user.id });
  const v = db.prepare('SELECT queue_number FROM visits WHERE id = ?').get(id);
  req.flash('ok', `Đã tiếp đón. Số thứ tự: ${v.queue_number}.`);
  res.redirect(`/visits/${id}`);
});

function loadVisit(req, res, next) {
  const v = db.prepare(`SELECT v.*, dp.name AS dept_name, dp.room, u.full_name AS doctor_name, u.title AS doctor_title
    FROM visits v LEFT JOIN departments dp ON dp.id = v.department_id LEFT JOIN users u ON u.id = v.doctor_id
    WHERE v.id = ?`).get(int(req.params.id));
  if (!v) return res.status(404).render('error', { title: 'Không tìm thấy', message: 'Không tìm thấy lượt khám.' });
  req.visit = v;
  next();
}

function visitDetails(v) {
  return {
    patient: db.prepare('SELECT * FROM patients WHERE id = ?').get(v.patient_id),
    services: db.prepare(`SELECT vs.*, s.name, s.code, s.category FROM visit_services vs JOIN services s ON s.id = vs.service_id
      WHERE vs.visit_id = ? ORDER BY vs.id`).all(v.id),
    prescription: db.prepare(`SELECT pi.*, m.name, m.unit, m.active_ingredient, m.stock FROM prescription_items pi
      JOIN medicines m ON m.id = pi.medicine_id WHERE pi.visit_id = ? ORDER BY pi.id`).all(v.id),
    invoices: db.prepare(`SELECT * FROM invoices WHERE visit_id = ? ORDER BY id`).all(v.id),
  };
}

router.get('/:id', loadVisit, (req, res) => {
  const v = req.visit;
  const d = visitDetails(v);
  const history = db.prepare(`SELECT v.id, v.visit_date, v.diagnosis, v.icd_code, dp.name AS dept_name
    FROM visits v LEFT JOIN departments dp ON dp.id = v.department_id
    WHERE v.patient_id = ? AND v.id != ? AND v.status = 'done' ORDER BY v.visit_date DESC LIMIT 10`).all(v.patient_id, v.id);
  res.render('visits/show', {
    title: `Khám bệnh — ${d.patient.full_name}`, v, ...d, history,
    paidInvoiceIds: new Set(d.invoices.filter((i) => i.status === 'paid').map((i) => i.id)),
    allServices: db.prepare('SELECT * FROM services WHERE active = 1 ORDER BY category, name').all(),
    medicines: db.prepare('SELECT * FROM medicines WHERE active = 1 ORDER BY name').all(),
    ...lookups(),
  });
});

const back = (req, res) => res.redirect(`/visits/${req.visit.id}`);
const handle = (fn) => (req, res, next) => {
  try { fn(req, res, next); } catch (e) {
    if (e instanceof clinical.UserError) { req.flash('error', e.userMessage); return back(req, res); }
    next(e);
  }
};

router.post('/:id/start', requireRole('doctor'), loadVisit, handle((req, res) => {
  if (req.visit.status !== 'waiting') throw new clinical.UserError('Chỉ có thể bắt đầu khám lượt đang chờ.');
  const doctorId = req.visit.doctor_id || (req.user.role === 'doctor' ? req.user.id : null);
  db.prepare(`UPDATE visits SET status = 'in_progress', started_at = ?, doctor_id = ? WHERE id = ?`).run(nowStr(), doctorId, req.visit.id);
  audit(req.user.id, 'start', 'visit', req.visit.id);
  back(req, res);
}));

router.post('/:id/exam', requireRole('doctor'), loadVisit, handle((req, res) => {
  if (req.visit.status === 'cancelled') throw new clinical.UserError('Lượt khám đã bị hủy.');
  const b = req.body;
  const followUp = str(b.follow_up_date);
  if (followUp && !isDate(followUp)) throw new clinical.UserError('Ngày tái khám không hợp lệ.');
  db.prepare(`UPDATE visits SET pulse = ?, bp_systolic = ?, bp_diastolic = ?, temperature = ?, resp_rate = ?, spo2 = ?,
      weight = ?, height = ?, symptoms = ?, examination = ?, diagnosis = ?, icd_code = ?, treatment_plan = ?, advice = ?,
      follow_up_date = ?, doctor_id = COALESCE(doctor_id, ?),
      status = CASE WHEN status = 'waiting' THEN 'in_progress' ELSE status END,
      started_at = COALESCE(started_at, ?)
    WHERE id = ?`).run(
    int(b.pulse), int(b.bp_systolic), int(b.bp_diastolic), num(b.temperature), int(b.resp_rate), int(b.spo2),
    num(b.weight), num(b.height), str(b.symptoms), str(b.examination), str(b.diagnosis), str(b.icd_code)?.toUpperCase() ?? null,
    str(b.treatment_plan), str(b.advice), followUp, req.user.role === 'doctor' ? req.user.id : null, nowStr(), req.visit.id,
  );
  audit(req.user.id, 'update', 'visit', req.visit.id);
  if (b.finish === '1') {
    if (!str(b.diagnosis)) throw new clinical.UserError('Đã lưu. Cần nhập chẩn đoán trước khi kết thúc khám.');
    db.prepare(`UPDATE visits SET status = 'done', finished_at = ? WHERE id = ?`).run(nowStr(), req.visit.id);
    audit(req.user.id, 'finish', 'visit', req.visit.id);
    req.flash('ok', 'Đã kết thúc khám. Bệnh nhân có thể đến quầy thu ngân.');
  } else {
    req.flash('ok', 'Đã lưu thông tin khám.');
  }
  back(req, res);
}));

router.post('/:id/reopen', requireRole('doctor'), loadVisit, handle((req, res) => {
  if (req.visit.status !== 'done') throw new clinical.UserError('Chỉ mở lại lượt khám đã kết thúc.');
  db.prepare(`UPDATE visits SET status = 'in_progress', finished_at = NULL WHERE id = ?`).run(req.visit.id);
  audit(req.user.id, 'reopen', 'visit', req.visit.id);
  back(req, res);
}));

router.post('/:id/cancel', requireRole('receptionist', 'doctor'), loadVisit, handle((req, res) => {
  if (clinical.hasPaidInvoice(req.visit.id)) throw new clinical.UserError('Lượt khám đã có hóa đơn thanh toán, không thể hủy. Hãy hủy hóa đơn trước.');
  if (req.visit.status === 'done') throw new clinical.UserError('Không thể hủy lượt khám đã hoàn tất.');
  db.prepare(`UPDATE visits SET status = 'cancelled' WHERE id = ?`).run(req.visit.id);
  db.prepare(`UPDATE invoices SET status = 'cancelled', note = 'Hủy theo lượt khám' WHERE visit_id = ? AND status = 'unpaid'`).run(req.visit.id);
  audit(req.user.id, 'cancel', 'visit', req.visit.id);
  req.flash('ok', 'Đã hủy lượt khám.');
  back(req, res);
}));

router.post('/:id/assign', requireRole('receptionist', 'doctor'), loadVisit, handle((req, res) => {
  if (req.visit.status === 'done' || req.visit.status === 'cancelled') throw new clinical.UserError('Không thể chuyển lượt khám này.');
  const departmentId = int(req.body.department_id) || req.visit.department_id;
  const doctorId = int(req.body.doctor_id);
  const useBhyt = req.body.bhyt === '1' ? 1 : 0;
  if (useBhyt && !req.visit.bhyt) {
    const pt = db.prepare('SELECT * FROM patients WHERE id = ?').get(req.visit.patient_id);
    const c = bhyt.coverage({ bhyt: 1, visit_date: req.visit.visit_date }, pt);
    if (!c.eligible) throw new clinical.UserError(`Không thể chuyển sang khám BHYT: ${c.reasons.join('; ')}.`);
  }
  db.prepare('UPDATE visits SET department_id = ?, doctor_id = ?, bhyt = ? WHERE id = ?').run(departmentId, doctorId, useBhyt, req.visit.id);
  // Re-price any open (unpaid) invoice with the new BHYT setting
  if (db.prepare(`SELECT 1 FROM invoices WHERE visit_id = ? AND status = 'unpaid'`).get(req.visit.id)) clinical.syncInvoice(req.visit.id, req.user.id);
  audit(req.user.id, 'assign', 'visit', req.visit.id);
  req.flash('ok', 'Đã cập nhật phòng khám / bác sĩ.');
  back(req, res);
}));

// Orders (chỉ định dịch vụ)
router.post('/:id/services', requireRole('doctor', 'receptionist'), loadVisit, handle((req, res) => {
  const serviceId = int(req.body.service_id);
  if (!serviceId) throw new clinical.UserError('Vui lòng chọn dịch vụ.');
  clinical.addService(req.visit.id, serviceId, req.user.id, int(req.body.quantity) || 1);
  audit(req.user.id, 'order_service', 'visit', req.visit.id, String(serviceId));
  back(req, res);
}));

router.post('/:id/services/:sid/delete', requireRole('doctor', 'receptionist'), loadVisit, handle((req, res) => {
  clinical.removeService(req.visit.id, int(req.params.sid));
  back(req, res);
}));

router.post('/:id/services/:sid/result', requireRole('doctor', 'technician'), loadVisit, handle((req, res) => {
  db.prepare('UPDATE visit_services SET result = ?, result_at = ?, result_by = ? WHERE id = ? AND visit_id = ?')
    .run(str(req.body.result), nowStr(), req.user.id, int(req.params.sid), req.visit.id);
  audit(req.user.id, 'service_result', 'visit', req.visit.id, req.params.sid);
  req.flash('ok', 'Đã lưu kết quả.');
  back(req, res);
}));

// Prescription (kê đơn)
router.post('/:id/prescription', requireRole('doctor'), loadVisit, handle((req, res) => {
  const medicineId = int(req.body.medicine_id);
  if (!medicineId) throw new clinical.UserError('Vui lòng chọn thuốc.');
  const m = clinical.addPrescription(req.visit.id, {
    medicineId, quantity: int(req.body.quantity), dosage: str(req.body.dosage), days: int(req.body.days),
  });
  if (m.stock < int(req.body.quantity)) req.flash('error', `Lưu ý: ${m.name} chỉ còn ${m.stock} ${m.unit} trong kho.`);
  audit(req.user.id, 'prescribe', 'visit', req.visit.id, String(medicineId));
  back(req, res);
}));

router.post('/:id/prescription/:iid/delete', requireRole('doctor'), loadVisit, handle((req, res) => {
  clinical.removePrescription(req.visit.id, int(req.params.iid));
  back(req, res);
}));

// Printable prescription / visit summary
router.get('/:id/print', loadVisit, (req, res) => {
  res.render('visits/print', { title: 'Đơn thuốc', v: req.visit, ...visitDetails(req.visit) });
});

module.exports = router;
