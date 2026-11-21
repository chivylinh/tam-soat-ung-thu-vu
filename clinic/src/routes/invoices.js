'use strict';
const express = require('express');
const { db } = require('../db');
const { requireLogin, requireRole } = require('../auth');
const { str, int, isDate, today, PAYMENT_METHODS, INVOICE_STATUS } = require('../helpers');
const clinical = require('../clinical');

const router = express.Router();
router.use(requireLogin);

router.get('/', requireRole('cashier', 'receptionist'), (req, res) => {
  const date = isDate(req.query.date) ? req.query.date : today();
  const status = INVOICE_STATUS[req.query.status] ? req.query.status : null;

  // Visits (any day) with items that still need to be paid
  const pending = db.prepare(`SELECT v.id, v.visit_date, v.queue_number, v.status, p.full_name, p.code, dp.name AS dept_name,
      (SELECT id FROM invoices i WHERE i.visit_id = v.id AND i.status = 'unpaid') AS unpaid_invoice_id
    FROM visits v JOIN patients p ON p.id = v.patient_id LEFT JOIN departments dp ON dp.id = v.department_id
    WHERE v.status != 'cancelled' AND v.visit_date >= date(?, '-7 day') AND (
      EXISTS (SELECT 1 FROM visit_services x LEFT JOIN invoices i ON i.id = x.invoice_id
              WHERE x.visit_id = v.id AND (x.invoice_id IS NULL OR i.status != 'paid'))
      OR EXISTS (SELECT 1 FROM prescription_items x LEFT JOIN invoices i ON i.id = x.invoice_id
              WHERE x.visit_id = v.id AND (x.invoice_id IS NULL OR i.status != 'paid')))
    ORDER BY v.visit_date DESC, v.status = 'done' DESC, v.queue_number`).all(date);

  const where = ['(substr(i.created_at,1,10) = ? OR substr(i.paid_at,1,10) = ?)'];
  const params = [date, date];
  if (status) { where.push('i.status = ?'); params.push(status); }
  const invoices = db.prepare(`SELECT i.*, p.full_name, p.code AS patient_code, u.full_name AS cashier_name
    FROM invoices i JOIN patients p ON p.id = i.patient_id LEFT JOIN users u ON u.id = i.cashier_id
    WHERE ${where.join(' AND ')} ORDER BY i.id DESC`).all(...params);
  const totals = db.prepare(`SELECT payment_method, COALESCE(SUM(total),0) AS s, COUNT(*) AS n FROM invoices
    WHERE status = 'paid' AND substr(paid_at,1,10) = ? GROUP BY payment_method`).all(date);
  res.render('invoices/list', { title: 'Thu ngân', pending, invoices, totals, date, status });
});

// Create (or refresh) the invoice for a visit and open it
router.post('/from-visit/:visitId', requireRole('cashier', 'receptionist'), (req, res, next) => {
  try {
    const id = clinical.syncInvoice(int(req.params.visitId), req.user.id);
    if (!id) { req.flash('error', 'Lượt khám không còn khoản nào cần thanh toán.'); return res.redirect('/invoices'); }
    res.redirect(`/invoices/${id}`);
  } catch (e) {
    if (e instanceof clinical.UserError) { req.flash('error', e.userMessage); return res.redirect('/invoices'); }
    next(e);
  }
});

function loadInvoice(req, res, next) {
  let inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(int(req.params.id));
  if (!inv) return res.status(404).render('error', { title: 'Không tìm thấy', message: 'Không tìm thấy hóa đơn.' });
  if (inv.status === 'unpaid') {
    clinical.syncInvoice(inv.visit_id, req.user.id);
    inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(inv.id);
  }
  req.invoice = inv;
  next();
}

function invoiceView(inv) {
  return {
    inv,
    items: db.prepare('SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY item_type DESC, id').all(inv.id),
    patient: db.prepare('SELECT * FROM patients WHERE id = ?').get(inv.patient_id),
    visit: db.prepare(`SELECT v.*, dp.name AS dept_name, u.full_name AS doctor_name FROM visits v
      LEFT JOIN departments dp ON dp.id = v.department_id LEFT JOIN users u ON u.id = v.doctor_id WHERE v.id = ?`).get(inv.visit_id),
    cashier: inv.cashier_id ? db.prepare('SELECT full_name FROM users WHERE id = ?').get(inv.cashier_id) : null,
  };
}

router.get('/:id', requireRole('cashier', 'receptionist', 'doctor', 'pharmacist'), loadInvoice, (req, res) => {
  res.render('invoices/show', { title: `Hóa đơn ${req.invoice.code}`, ...invoiceView(req.invoice) });
});

router.get('/:id/print', requireRole('cashier', 'receptionist', 'doctor', 'pharmacist'), loadInvoice, (req, res) => {
  res.render('invoices/print', { title: `Hóa đơn ${req.invoice.code}`, ...invoiceView(req.invoice) });
});

router.post('/:id/pay', requireRole('cashier'), loadInvoice, (req, res, next) => {
  const method = PAYMENT_METHODS[req.body.payment_method] ? req.body.payment_method : 'cash';
  try {
    clinical.payInvoice(req.invoice.id, { method, discount: int(req.body.discount) || 0, note: str(req.body.note) }, req.user.id);
    req.flash('ok', 'Đã thu tiền và xuất thuốc.');
  } catch (e) {
    if (!(e instanceof clinical.UserError)) return next(e);
    req.flash('error', e.userMessage);
  }
  res.redirect(`/invoices/${req.invoice.id}`);
});

router.post('/:id/cancel', requireRole(), loadInvoice, (req, res, next) => {
  try {
    clinical.cancelInvoice(req.invoice.id, str(req.body.reason), req.user.id);
    req.flash('ok', 'Đã hủy hóa đơn.');
  } catch (e) {
    if (!(e instanceof clinical.UserError)) return next(e);
    req.flash('error', e.userMessage);
  }
  res.redirect(`/invoices/${req.invoice.id}`);
});

module.exports = router;
