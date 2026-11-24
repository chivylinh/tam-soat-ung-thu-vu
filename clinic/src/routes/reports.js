'use strict';
const express = require('express');
const { db } = require('../db');
const { requireRole } = require('../auth');
const { isDate, today, addDays } = require('../helpers');

const router = express.Router();
router.use(requireRole('cashier'));

router.get('/', (req, res) => {
  const to = isDate(req.query.to) ? req.query.to : today();
  const from = isDate(req.query.from) ? req.query.from : addDays(to, -29);

  const revenueByDay = db.prepare(`SELECT substr(paid_at,1,10) AS day, SUM(total) AS total, COUNT(*) AS n
    FROM invoices WHERE status = 'paid' AND substr(paid_at,1,10) BETWEEN ? AND ? GROUP BY day ORDER BY day`).all(from, to);
  const revenueTotal = revenueByDay.reduce((s, r) => s + r.total, 0);

  const revenueByType = db.prepare(`SELECT ii.item_type, SUM(ii.amount) AS total FROM invoice_items ii
    JOIN invoices i ON i.id = ii.invoice_id WHERE i.status = 'paid' AND substr(i.paid_at,1,10) BETWEEN ? AND ?
    GROUP BY ii.item_type`).all(from, to);
  const insurance = db.prepare(`SELECT COALESCE(SUM(insurance_amount),0) AS s, COUNT(*) AS n FROM invoices
    WHERE status = 'paid' AND insurance_amount > 0 AND substr(paid_at,1,10) BETWEEN ? AND ?`).get(from, to);
  const discounts = db.prepare(`SELECT COALESCE(SUM(discount),0) AS s FROM invoices
    WHERE status = 'paid' AND substr(paid_at,1,10) BETWEEN ? AND ?`).get(from, to).s;

  const visitsByDept = db.prepare(`SELECT COALESCE(dp.name,'(Chưa phân khoa)') AS name, COUNT(*) AS n,
      SUM(v.status = 'done') AS done
    FROM visits v LEFT JOIN departments dp ON dp.id = v.department_id
    WHERE v.visit_date BETWEEN ? AND ? AND v.status != 'cancelled' GROUP BY v.department_id ORDER BY n DESC`).all(from, to);
  const visitTotal = visitsByDept.reduce((s, r) => s + r.n, 0);

  const byDoctor = db.prepare(`SELECT u.full_name, COUNT(*) AS n FROM visits v JOIN users u ON u.id = v.doctor_id
    WHERE v.visit_date BETWEEN ? AND ? AND v.status = 'done' GROUP BY v.doctor_id ORDER BY n DESC`).all(from, to);

  const topDiagnoses = db.prepare(`SELECT COALESCE(icd_code,'') AS icd, diagnosis, COUNT(*) AS n FROM visits
    WHERE visit_date BETWEEN ? AND ? AND status = 'done' AND diagnosis IS NOT NULL
    GROUP BY COALESCE(icd_code, lower(diagnosis)) ORDER BY n DESC LIMIT 10`).all(from, to);

  const topServices = db.prepare(`SELECT ii.description, SUM(ii.quantity) AS qty, SUM(ii.amount) AS total FROM invoice_items ii
    JOIN invoices i ON i.id = ii.invoice_id WHERE i.status = 'paid' AND ii.item_type = 'service'
      AND substr(i.paid_at,1,10) BETWEEN ? AND ? GROUP BY ii.ref_id ORDER BY total DESC LIMIT 10`).all(from, to);
  const topMedicines = db.prepare(`SELECT ii.description, SUM(ii.quantity) AS qty, SUM(ii.amount) AS total FROM invoice_items ii
    JOIN invoices i ON i.id = ii.invoice_id WHERE i.status = 'paid' AND ii.item_type = 'medicine'
      AND substr(i.paid_at,1,10) BETWEEN ? AND ? GROUP BY ii.ref_id ORDER BY qty DESC LIMIT 10`).all(from, to);

  const newPatients = db.prepare(`SELECT COUNT(*) AS n FROM patients WHERE substr(created_at,1,10) BETWEEN ? AND ?`).get(from, to).n;

  res.render('reports', {
    title: 'Báo cáo thống kê', from, to, revenueByDay, revenueTotal, revenueByType, discounts, insurance,
    visitsByDept, visitTotal, byDoctor, topDiagnoses, topServices, topMedicines, newPatients,
  });
});

// CSV export of paid invoices
router.get('/invoices.csv', (req, res) => {
  const to = isDate(req.query.to) ? req.query.to : today();
  const from = isDate(req.query.from) ? req.query.from : addDays(to, -29);
  const rows = db.prepare(`SELECT i.code, i.paid_at, p.code AS patient_code, p.full_name, i.subtotal, i.discount, i.total, i.payment_method, u.full_name AS cashier
    FROM invoices i JOIN patients p ON p.id = i.patient_id LEFT JOIN users u ON u.id = i.cashier_id
    WHERE i.status = 'paid' AND substr(i.paid_at,1,10) BETWEEN ? AND ? ORDER BY i.paid_at`).all(from, to);
  const esc = (v) => {
    let s = v === null || v === undefined ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // prevent spreadsheet formula injection
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = ['Mã HĐ', 'Thời gian thu', 'Mã BN', 'Họ tên', 'Tạm tính', 'Giảm giá', 'Thành tiền', 'Hình thức', 'Thu ngân'];
  const csv = [header, ...rows.map((r) => Object.values(r))].map((r) => r.map(esc).join(',')).join('\r\n');
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="doanh-thu-${from}-${to}.csv"`);
  res.send(`﻿${csv}`);
});

module.exports = router;
