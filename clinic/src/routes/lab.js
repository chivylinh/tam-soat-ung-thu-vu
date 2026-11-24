'use strict';
const express = require('express');
const { db, audit } = require('../db');
const { requireLogin, requireRole } = require('../auth');
const { str, int, isDate, today, nowStr } = require('../helpers');

const router = express.Router();
router.use(requireLogin);

/** Paraclinical worklist (xét nghiệm, chẩn đoán hình ảnh, thăm dò chức năng...). */
router.get('/', (req, res) => {
  const date = isDate(req.query.date) ? req.query.date : today();
  const category = str(req.query.category);
  const show = req.query.show === 'all' ? 'all' : 'pending';
  const where = [`s.category != 'Khám'`, 'v.visit_date = ?', `v.status != 'cancelled'`];
  const params = [date];
  if (category) { where.push('s.category = ?'); params.push(category); }
  if (show === 'pending') where.push('vs.result IS NULL');
  const items = db.prepare(`SELECT vs.*, s.name AS service_name, s.category, v.queue_number, v.id AS visit_id,
      p.full_name, p.code, p.gender, p.dob, dp.name AS dept_name, u.full_name AS ordered_by_name,
      (i.status = 'paid') AS paid
    FROM visit_services vs JOIN services s ON s.id = vs.service_id JOIN visits v ON v.id = vs.visit_id
    JOIN patients p ON p.id = v.patient_id LEFT JOIN departments dp ON dp.id = v.department_id
    LEFT JOIN users u ON u.id = vs.ordered_by LEFT JOIN invoices i ON i.id = vs.invoice_id
    WHERE ${where.join(' AND ')} ORDER BY vs.result IS NOT NULL, vs.id`).all(...params);
  const categories = db.prepare(`SELECT DISTINCT category FROM services WHERE category != 'Khám' ORDER BY category`).all().map((r) => r.category);
  res.render('lab', { title: 'Cận lâm sàng', items, date, category, show, categories });
});

/** Printable result sheet for the paraclinical services of one visit (optionally a single category or item). */
router.get('/visit/:visitId/print', (req, res) => {
  const visitId = int(req.params.visitId);
  const v = db.prepare(`SELECT v.*, d.name AS dept_name, u.full_name AS doctor_name, u.title AS doctor_title FROM visits v
    LEFT JOIN departments d ON d.id = v.department_id LEFT JOIN users u ON u.id = v.doctor_id WHERE v.id = ?`).get(visitId);
  if (!v) return res.status(404).render('error', { title: 'Không tìm thấy', message: 'Không tìm thấy lượt khám.' });
  const patient = db.prepare('SELECT * FROM patients WHERE id = ?').get(v.patient_id);
  const where = [`vs.visit_id = ?`, `s.category != 'Khám'`];
  const params = [visitId];
  const category = str(req.query.category);
  const itemId = int(req.query.item);
  if (category) { where.push('s.category = ?'); params.push(category); }
  if (itemId) { where.push('vs.id = ?'); params.push(itemId); }
  const items = db.prepare(`SELECT vs.*, s.name, s.category, s.code, o.full_name AS ordered_by_name, o.title AS ordered_by_title,
      r.full_name AS result_by_name, r.title AS result_by_title
    FROM visit_services vs JOIN services s ON s.id = vs.service_id
    LEFT JOIN users o ON o.id = vs.ordered_by LEFT JOIN users r ON r.id = vs.result_by
    WHERE ${where.join(' AND ')} ORDER BY s.category, vs.id`).all(...params);
  const groups = {};
  for (const it of items) (groups[it.category] ||= []).push(it);
  const technicians = [...new Set(items.filter((i) => i.result_by_name).map((i) => `${i.result_by_title ? i.result_by_title + ' ' : ''}${i.result_by_name}`))];
  const orderers = [...new Set(items.filter((i) => i.ordered_by_name).map((i) => `${i.ordered_by_title ? i.ordered_by_title + ' ' : ''}${i.ordered_by_name}`))];
  const lastResult = items.reduce((m, i) => (i.result_at && i.result_at > m ? i.result_at : m), '');
  res.render('lab-print', { title: 'Phiếu kết quả cận lâm sàng', v, patient, groups, items, technicians, orderers, lastResult });
});

router.post('/:id/result', requireRole('technician', 'doctor'), (req, res) => {
  const id = int(req.params.id);
  const r = db.prepare('UPDATE visit_services SET result = ?, result_at = ?, result_by = ? WHERE id = ?')
    .run(str(req.body.result), nowStr(), req.user.id, id);
  if (r.changes) audit(req.user.id, 'service_result', 'visit_service', id);
  req.flash('ok', 'Đã lưu kết quả.');
  const back = new URLSearchParams({ date: str(req.body.date) || today(), category: str(req.body.category) || '', show: req.body.show === 'all' ? 'all' : 'pending' });
  res.redirect(`/lab?${back}`);
});

module.exports = router;
