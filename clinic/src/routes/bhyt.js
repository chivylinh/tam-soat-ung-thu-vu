'use strict';
const express = require('express');
const { db, audit } = require('../db');
const { requireRole } = require('../auth');
const { int, isDate, today, addDays, arr } = require('../helpers');
const bhyt = require('../bhyt');

const router = express.Router();
router.use(requireRole('cashier'));

function visitsInRange(from, to) {
  return db.prepare(`SELECT v.id FROM visits v WHERE v.bhyt = 1 AND v.status = 'done' AND v.visit_date BETWEEN ? AND ?
    ORDER BY v.visit_date, v.id`).all(from, to).map((r) => r.id);
}

router.get('/', (req, res) => {
  const to = isDate(req.query.to) ? req.query.to : today();
  const from = isDate(req.query.from) ? req.query.from : addDays(to, -6);
  const rows = visitsInRange(from, to).map((id) => {
    const data = bhyt.loadVisit(id);
    const check = bhyt.validate(data);
    const built = bhyt.buildXml(data);
    return { v: data.v, p: data.p, ...check, totals: built.totals, rate: built.rate };
  });
  const sum = rows.filter((r) => !r.errors.length).reduce((s, r) => ({
    bv: s.bv + r.totals.bv, bhtt: s.bhtt + r.totals.bhtt, bn: s.bn + r.totals.bntt + r.totals.bncct,
  }), { bv: 0, bhtt: 0, bn: 0 });
  res.render('bhyt', { title: 'Xuất XML BHYT', from, to, rows, sum, cfg: bhyt.cfg(), threshold: bhyt.fullCoverageThreshold() });
});

function sendXml(res, ids, filename, userId) {
  const records = [];
  for (const [i, id] of ids.entries()) {
    const data = bhyt.loadVisit(id);
    if (!data || bhyt.validate(data).errors.length) continue;
    records.push(bhyt.buildXml(data, i + 1));
  }
  if (!records.length) return false;
  audit(userId, 'export_xml', 'bhyt', null, `${records.length} hồ sơ: ${ids.join(',')}`);
  res.set('Content-Type', 'application/xml; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(bhyt.wrap(records));
  return true;
}

// One visit: preview the three tables as readable XML
router.get('/visit/:id', (req, res) => {
  const data = bhyt.loadVisit(int(req.params.id));
  if (!data) return res.status(404).render('error', { title: 'Không tìm thấy', message: 'Không tìm thấy lượt khám.' });
  const built = bhyt.buildXml(data);
  const pretty = (x) => x.replace(/></g, '>\n<');
  res.render('bhyt-visit', { title: `XML BHYT — ${data.p.full_name}`, data, check: bhyt.validate(data), built, pretty });
});

router.post('/export', (req, res) => {
  const ids = arr(req.body.visit_id).map(int).filter(Boolean);
  const from = isDate(req.body.from) ? req.body.from : today();
  const to = isDate(req.body.to) ? req.body.to : today();
  const list = ids.length ? ids : visitsInRange(from, to);
  if (!sendXml(res, list, `BHYT_${bhyt.cfg().maCSKCB || 'CSKCB'}_${from}_${to}.xml`, req.user.id)) {
    req.flash('error', 'Không có hồ sơ hợp lệ để xuất. Sửa các lỗi được liệt kê trước.');
    res.redirect(`/bhyt?from=${from}&to=${to}`);
  }
});

module.exports = router;
