'use strict';
const express = require('express');
const { db } = require('../db');
const { requireLogin } = require('../auth');
const { today, addDays } = require('../helpers');

const router = express.Router();

router.get('/', requireLogin, (req, res) => {
  const d = today();
  const visitCounts = db.prepare(`SELECT status, COUNT(*) AS n FROM visits WHERE visit_date = ? GROUP BY status`).all(d);
  const counts = { waiting: 0, in_progress: 0, done: 0, cancelled: 0 };
  for (const r of visitCounts) counts[r.status] = r.n;

  const apptToday = db.prepare(`SELECT COUNT(*) AS n FROM appointments
    WHERE substr(scheduled_at,1,10) = ? AND status = 'scheduled'`).get(d).n;
  const revenue = db.prepare(`SELECT COALESCE(SUM(total),0) AS s, COUNT(*) AS n FROM invoices
    WHERE status = 'paid' AND substr(paid_at,1,10) = ?`).get(d);
  const unpaid = db.prepare(`SELECT COUNT(*) AS n FROM invoices WHERE status = 'unpaid'`).get().n;
  const newPatients = db.prepare(`SELECT COUNT(*) AS n FROM patients WHERE substr(created_at,1,10) = ?`).get(d).n;

  const doctorFilter = req.user.role === 'doctor' ? 'AND (v.doctor_id = ? OR v.doctor_id IS NULL)' : '';
  const queueParams = req.user.role === 'doctor' ? [d, req.user.id] : [d];
  const queue = db.prepare(`SELECT v.*, p.full_name, p.code, p.gender, p.dob, dp.name AS dept_name, u.full_name AS doctor_name
    FROM visits v JOIN patients p ON p.id = v.patient_id
    LEFT JOIN departments dp ON dp.id = v.department_id
    LEFT JOIN users u ON u.id = v.doctor_id
    WHERE v.visit_date = ? AND v.status IN ('waiting','in_progress') ${doctorFilter}
    ORDER BY v.status = 'in_progress' DESC, v.queue_number LIMIT 15`).all(...queueParams);

  const upcoming = db.prepare(`SELECT a.*, p.full_name, p.phone, dp.name AS dept_name
    FROM appointments a JOIN patients p ON p.id = a.patient_id
    LEFT JOIN departments dp ON dp.id = a.department_id
    WHERE substr(a.scheduled_at,1,10) = ? AND a.status = 'scheduled'
    ORDER BY a.scheduled_at LIMIT 10`).all(d);

  const lowStock = db.prepare(`SELECT * FROM medicines WHERE active = 1 AND stock <= min_stock ORDER BY stock LIMIT 8`).all();
  const followUps = db.prepare(`SELECT v.id, v.follow_up_date, v.diagnosis, p.id AS patient_id, p.full_name, p.phone
    FROM visits v JOIN patients p ON p.id = v.patient_id
    WHERE v.follow_up_date BETWEEN ? AND ? ORDER BY v.follow_up_date LIMIT 10`).all(d, addDays(d, 7));

  const rooms = db.prepare(`SELECT d.id, d.name, d.room,
      COUNT(v.id) AS registered,
      COALESCE(SUM(v.status = 'waiting'),0) AS waiting,
      COALESCE(SUM(v.status = 'in_progress'),0) AS in_progress,
      COALESCE(SUM(v.status = 'done'),0) AS done
    FROM departments d LEFT JOIN visits v ON v.department_id = d.id AND v.visit_date = ? AND v.status != 'cancelled'
    WHERE d.active = 1 GROUP BY d.id ORDER BY d.room, d.name`).all(d);
  const labPending = db.prepare(`SELECT COUNT(*) AS n FROM visit_services vs JOIN services s ON s.id = vs.service_id
    JOIN visits v ON v.id = vs.visit_id WHERE s.category != 'Khám' AND vs.result IS NULL AND v.visit_date = ? AND v.status != 'cancelled'`).get(d).n;

  res.render('dashboard', {
    title: 'Tổng quan', rooms, labPending, counts, apptToday, revenue, unpaid, newPatients, queue, upcoming, lowStock, followUps,
  });
});

module.exports = router;
