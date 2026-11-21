'use strict';
const express = require('express');
const { db, tx, audit } = require('../db');
const { requireLogin, requireRole } = require('../auth');
const { str, int, isDate, today, addDays } = require('../helpers');

const router = express.Router();
router.use(requireLogin);

router.get('/', (req, res) => {
  const q = str(req.query.q);
  const filter = req.query.filter;
  const where = ['1=1'];
  const params = [];
  if (q) { where.push('(name LIKE ? OR code LIKE ? OR active_ingredient LIKE ?)'); params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  if (filter === 'low') where.push('stock <= min_stock');
  if (filter === 'expiring') { where.push('expiry_date IS NOT NULL AND expiry_date <= ?'); params.push(addDays(today(), 90)); }
  if (req.query.inactive !== '1') where.push('active = 1');
  const medicines = db.prepare(`SELECT * FROM medicines WHERE ${where.join(' AND ')} ORDER BY name`).all(...params);
  res.render('pharmacy/list', { title: 'Kho thuốc', medicines, q, filter, soon: addDays(today(), 90) });
});

function readMed(body) {
  const m = {
    code: str(body.code), name: str(body.name), active_ingredient: str(body.active_ingredient), unit: str(body.unit) || 'viên',
    price: int(body.price) ?? 0, min_stock: int(body.min_stock) ?? 0, expiry_date: str(body.expiry_date), active: body.active === '0' ? 0 : 1,
  };
  const errors = [];
  if (!m.name) errors.push('Vui lòng nhập tên thuốc.');
  if (m.price < 0) errors.push('Giá không hợp lệ.');
  if (m.expiry_date && !isDate(m.expiry_date)) errors.push('Hạn dùng không hợp lệ.');
  return { m, errors };
}

router.get('/new', requireRole('pharmacist'), (req, res) => {
  res.render('pharmacy/form', { title: 'Thêm thuốc', m: { unit: 'viên', active: 1 }, errors: [], action: '/pharmacy' });
});

router.post('/', requireRole('pharmacist'), (req, res) => {
  const { m, errors } = readMed(req.body);
  const initial = Math.max(0, int(req.body.stock) || 0);
  if (m.code && db.prepare('SELECT 1 FROM medicines WHERE code = ?').get(m.code)) errors.push('Mã thuốc đã tồn tại.');
  if (errors.length) return res.status(400).render('pharmacy/form', { title: 'Thêm thuốc', m: { ...m, stock: initial }, errors, action: '/pharmacy' });
  tx(() => {
    const r = db.prepare(`INSERT INTO medicines (code, name, active_ingredient, unit, price, stock, min_stock, expiry_date, active)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(m.code, m.name, m.active_ingredient, m.unit, m.price, initial, m.min_stock, m.expiry_date, m.active);
    const id = Number(r.lastInsertRowid);
    if (initial) db.prepare('INSERT INTO stock_movements (medicine_id, change, reason, user_id) VALUES (?,?,?,?)').run(id, initial, 'Tồn đầu kỳ', req.user.id);
    audit(req.user.id, 'create', 'medicine', id);
  });
  req.flash('ok', 'Đã thêm thuốc.');
  res.redirect('/pharmacy');
});

function loadMed(req, res, next) {
  const m = db.prepare('SELECT * FROM medicines WHERE id = ?').get(int(req.params.id));
  if (!m) return res.status(404).render('error', { title: 'Không tìm thấy', message: 'Không tìm thấy thuốc.' });
  req.med = m;
  next();
}

router.get('/:id', loadMed, (req, res) => {
  const movements = db.prepare(`SELECT sm.*, u.full_name FROM stock_movements sm LEFT JOIN users u ON u.id = sm.user_id
    WHERE sm.medicine_id = ? ORDER BY sm.id DESC LIMIT 100`).all(req.med.id);
  res.render('pharmacy/show', { title: req.med.name, m: req.med, movements });
});

router.get('/:id/edit', requireRole('pharmacist'), loadMed, (req, res) => {
  res.render('pharmacy/form', { title: 'Sửa thông tin thuốc', m: req.med, errors: [], action: `/pharmacy/${req.med.id}` });
});

router.post('/:id', requireRole('pharmacist'), loadMed, (req, res) => {
  const { m, errors } = readMed(req.body);
  if (m.code && db.prepare('SELECT 1 FROM medicines WHERE code = ? AND id != ?').get(m.code, req.med.id)) errors.push('Mã thuốc đã tồn tại.');
  if (errors.length) return res.status(400).render('pharmacy/form', { title: 'Sửa thông tin thuốc', m: { ...m, id: req.med.id, stock: req.med.stock }, errors, action: `/pharmacy/${req.med.id}` });
  db.prepare(`UPDATE medicines SET code = ?, name = ?, active_ingredient = ?, unit = ?, price = ?, min_stock = ?, expiry_date = ?, active = ? WHERE id = ?`)
    .run(m.code, m.name, m.active_ingredient, m.unit, m.price, m.min_stock, m.expiry_date, m.active, req.med.id);
  audit(req.user.id, 'update', 'medicine', req.med.id);
  req.flash('ok', 'Đã cập nhật thuốc.');
  res.redirect(`/pharmacy/${req.med.id}`);
});

// Stock in / adjustment
router.post('/:id/stock', requireRole('pharmacist'), loadMed, (req, res) => {
  const qty = int(req.body.quantity);
  const type = req.body.type === 'out' ? 'out' : 'in';
  const reason = str(req.body.reason) || (type === 'in' ? 'Nhập kho' : 'Xuất điều chỉnh');
  if (!qty || qty <= 0) {
    req.flash('error', 'Số lượng không hợp lệ.');
    return res.redirect(`/pharmacy/${req.med.id}`);
  }
  const change = type === 'in' ? qty : -qty;
  if (req.med.stock + change < 0) {
    req.flash('error', 'Số lượng xuất lớn hơn tồn kho.');
    return res.redirect(`/pharmacy/${req.med.id}`);
  }
  tx(() => {
    db.prepare('UPDATE medicines SET stock = stock + ? WHERE id = ?').run(change, req.med.id);
    const expiry = str(req.body.expiry_date);
    if (type === 'in' && isDate(expiry)) db.prepare('UPDATE medicines SET expiry_date = ? WHERE id = ?').run(expiry, req.med.id);
    db.prepare('INSERT INTO stock_movements (medicine_id, change, reason, ref, user_id) VALUES (?,?,?,?,?)')
      .run(req.med.id, change, reason, str(req.body.ref), req.user.id);
    audit(req.user.id, `stock_${type}`, 'medicine', req.med.id, String(qty));
  });
  req.flash('ok', type === 'in' ? `Đã nhập ${qty} ${req.med.unit}.` : `Đã xuất ${qty} ${req.med.unit}.`);
  res.redirect(`/pharmacy/${req.med.id}`);
});

module.exports = router;
