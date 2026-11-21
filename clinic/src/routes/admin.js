'use strict';
const express = require('express');
const { db, audit } = require('../db');
const { requireRole, hashPassword, ROLES } = require('../auth');
const { str, int } = require('../helpers');

const router = express.Router();
router.use(requireRole()); // admin only

const departments = () => db.prepare('SELECT * FROM departments ORDER BY name').all();

// ---- Users ----
router.get('/users', (req, res) => {
  const users = db.prepare(`SELECT u.*, d.name AS dept_name FROM users u LEFT JOIN departments d ON d.id = u.department_id
    ORDER BY u.active DESC, u.role, u.full_name`).all();
  res.render('admin/users', { title: 'Nhân viên', users });
});

function readUser(body, isNew) {
  const u = {
    username: (str(body.username) || '').toLowerCase(), full_name: str(body.full_name), role: body.role,
    department_id: int(body.department_id), title: str(body.title), active: body.active === '0' ? 0 : 1,
  };
  const errors = [];
  if (!/^[a-z0-9._-]{3,32}$/.test(u.username)) errors.push('Tên đăng nhập 3–32 ký tự: chữ thường, số, dấu . _ -');
  if (!u.full_name) errors.push('Vui lòng nhập họ tên.');
  if (!ROLES[u.role]) errors.push('Vai trò không hợp lệ.');
  const pw = body.password || '';
  if ((isNew || pw) && pw.length < 8) errors.push('Mật khẩu phải có ít nhất 8 ký tự.');
  return { u, pw, errors };
}

router.get('/users/new', (req, res) => {
  res.render('admin/user-form', { title: 'Thêm nhân viên', u: { role: 'doctor', active: 1 }, errors: [], action: '/admin/users', departments: departments() });
});

router.post('/users', (req, res) => {
  const { u, pw, errors } = readUser(req.body, true);
  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(u.username)) errors.push('Tên đăng nhập đã tồn tại.');
  if (errors.length) return res.status(400).render('admin/user-form', { title: 'Thêm nhân viên', u, errors, action: '/admin/users', departments: departments() });
  const r = db.prepare(`INSERT INTO users (username, password_hash, full_name, role, department_id, title, active) VALUES (?,?,?,?,?,?,?)`)
    .run(u.username, hashPassword(pw), u.full_name, u.role, u.department_id, u.title, u.active);
  audit(req.user.id, 'create', 'user', Number(r.lastInsertRowid));
  req.flash('ok', 'Đã thêm nhân viên.');
  res.redirect('/admin/users');
});

router.get('/users/:id/edit', (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(int(req.params.id));
  if (!u) return res.status(404).render('error', { title: 'Không tìm thấy', message: 'Không tìm thấy nhân viên.' });
  res.render('admin/user-form', { title: 'Sửa nhân viên', u, errors: [], action: `/admin/users/${u.id}`, departments: departments() });
});

router.post('/users/:id', (req, res) => {
  const id = int(req.params.id);
  const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!existing) return res.status(404).render('error', { title: 'Không tìm thấy', message: 'Không tìm thấy nhân viên.' });
  const { u, pw, errors } = readUser(req.body, false);
  if (db.prepare('SELECT 1 FROM users WHERE username = ? AND id != ?').get(u.username, id)) errors.push('Tên đăng nhập đã tồn tại.');
  if (id === req.user.id && (u.role !== 'admin' || !u.active)) errors.push('Không thể tự bỏ quyền quản trị hoặc khóa tài khoản của chính mình.');
  if (errors.length) return res.status(400).render('admin/user-form', { title: 'Sửa nhân viên', u: { ...u, id }, errors, action: `/admin/users/${id}`, departments: departments() });
  db.prepare(`UPDATE users SET username = ?, full_name = ?, role = ?, department_id = ?, title = ?, active = ? WHERE id = ?`)
    .run(u.username, u.full_name, u.role, u.department_id, u.title, u.active, id);
  if (pw) db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(pw), id);
  if (!u.active || pw) db.prepare(`DELETE FROM sessions WHERE json_extract(data, '$.userId') = ?`).run(id);
  audit(req.user.id, 'update', 'user', id, pw ? 'password reset' : null);
  req.flash('ok', 'Đã cập nhật nhân viên.');
  res.redirect('/admin/users');
});

// ---- Departments ----
router.get('/departments', (req, res) => {
  const list = db.prepare(`SELECT d.*, s.name AS service_name FROM departments d LEFT JOIN services s ON s.id = d.default_service_id ORDER BY d.name`).all();
  const examServices = db.prepare(`SELECT * FROM services WHERE active = 1 ORDER BY category, name`).all();
  res.render('admin/departments', { title: 'Chuyên khoa / phòng khám', list, examServices });
});

router.post('/departments', (req, res) => {
  const name = str(req.body.name);
  const id = int(req.body.id);
  if (!name) { req.flash('error', 'Vui lòng nhập tên chuyên khoa.'); return res.redirect('/admin/departments'); }
  const dup = db.prepare('SELECT 1 FROM departments WHERE name = ? AND id != ?').get(name, id || 0);
  if (dup) { req.flash('error', 'Tên chuyên khoa đã tồn tại.'); return res.redirect('/admin/departments'); }
  const vals = [name, str(req.body.room), int(req.body.default_service_id), req.body.active === '0' ? 0 : 1];
  if (id) db.prepare('UPDATE departments SET name = ?, room = ?, default_service_id = ?, active = ? WHERE id = ?').run(...vals, id);
  else db.prepare('INSERT INTO departments (name, room, default_service_id, active) VALUES (?,?,?,?)').run(...vals);
  audit(req.user.id, id ? 'update' : 'create', 'department', id || null, name);
  req.flash('ok', 'Đã lưu chuyên khoa.');
  res.redirect('/admin/departments');
});

// ---- Services / price list ----
router.get('/services', (req, res) => {
  const list = db.prepare('SELECT * FROM services ORDER BY active DESC, category, code').all();
  const categories = db.prepare('SELECT DISTINCT category FROM services ORDER BY category').all().map((r) => r.category);
  res.render('admin/services', { title: 'Danh mục dịch vụ & bảng giá', list, categories });
});

router.post('/services', (req, res) => {
  const id = int(req.body.id);
  const s = {
    code: str(req.body.code), name: str(req.body.name), category: str(req.body.category) || 'Khác',
    price: int(req.body.price), active: req.body.active === '0' ? 0 : 1,
  };
  if (!s.name || s.price === null || s.price < 0) { req.flash('error', 'Vui lòng nhập tên và giá hợp lệ.'); return res.redirect('/admin/services'); }
  if (s.code && db.prepare('SELECT 1 FROM services WHERE code = ? AND id != ?').get(s.code, id || 0)) {
    req.flash('error', 'Mã dịch vụ đã tồn tại.'); return res.redirect('/admin/services');
  }
  if (id) db.prepare('UPDATE services SET code = ?, name = ?, category = ?, price = ?, active = ? WHERE id = ?').run(s.code, s.name, s.category, s.price, s.active, id);
  else db.prepare('INSERT INTO services (code, name, category, price, active) VALUES (?,?,?,?,?)').run(s.code, s.name, s.category, s.price, s.active);
  audit(req.user.id, id ? 'update' : 'create', 'service', id || null, s.name);
  req.flash('ok', 'Đã lưu dịch vụ.');
  res.redirect('/admin/services');
});

// ---- Audit log ----
router.get('/audit', (req, res) => {
  const page = Math.max(1, int(req.query.page) || 1);
  const rows = db.prepare(`SELECT a.*, u.full_name FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
    ORDER BY a.id DESC LIMIT 100 OFFSET ?`).all((page - 1) * 100);
  res.render('admin/audit', { title: 'Nhật ký hoạt động', rows, page });
});

module.exports = router;
