'use strict';
const express = require('express');
const { db } = require('../db');
const { requireLogin } = require('../auth');
const { int, today } = require('../helpers');

const router = express.Router();
router.use(requireLogin);

/** Hide most of a patient's name on the public waiting-room screen: "Nguyễn Văn An" -> "N. V. AN". */
function maskName(name) {
  const parts = String(name || '').trim().split(/\s+/);
  if (parts.length === 0 || !parts[0]) return '';
  const last = parts.pop();
  return [...parts.map((p) => `${p[0]}.`), last].join(' ').toUpperCase();
}

router.get('/', (req, res) => {
  const departmentId = int(req.query.department_id);
  const d = today();
  const depts = db.prepare(`SELECT * FROM departments WHERE active = 1 ${departmentId ? 'AND id = ?' : ''} ORDER BY room, name`)
    .all(...(departmentId ? [departmentId] : []));
  const rooms = depts.map((dept) => {
    const visits = db.prepare(`SELECT v.queue_number, v.status, p.full_name FROM visits v JOIN patients p ON p.id = v.patient_id
      WHERE v.visit_date = ? AND v.department_id = ? AND v.status IN ('waiting','in_progress') ORDER BY v.queue_number`).all(d, dept.id);
    const current = visits.filter((v) => v.status === 'in_progress').map((v) => ({ n: v.queue_number, name: maskName(v.full_name) }));
    const next = visits.filter((v) => v.status === 'waiting').slice(0, 5).map((v) => ({ n: v.queue_number, name: maskName(v.full_name) }));
    return { ...dept, current, next, waiting: visits.filter((v) => v.status === 'waiting').length };
  }).filter((r) => departmentId || r.current.length || r.next.length);
  res.render('display', { title: 'Màn hình phòng chờ', rooms, departmentId });
});

module.exports = router;
module.exports.maskName = maskName;
