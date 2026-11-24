'use strict';
const express = require('express');
const { db, audit } = require('../db');
const { verifyPassword, hashPassword, requireLogin } = require('../auth');
const { str } = require('../helpers');

const router = express.Router();

// Simple in-memory brute-force protection: 10 failed attempts / 15 minutes per IP+username.
const attempts = new Map();
const WINDOW_MS = 15 * 60 * 1000;
function tooMany(key) {
  const a = attempts.get(key);
  if (!a) return false;
  if (Date.now() - a.first > WINDOW_MS) { attempts.delete(key); return false; }
  return a.count >= 10;
}
function fail(key) {
  const a = attempts.get(key);
  if (!a || Date.now() - a.first > WINDOW_MS) attempts.set(key, { first: Date.now(), count: 1 });
  else a.count++;
}

router.get('/login', (req, res) => {
  if (req.user) return res.redirect('/');
  res.render('login', { title: 'Đăng nhập', error: null, username: '' });
});

router.post('/login', (req, res, next) => {
  const username = (str(req.body.username) || '').toLowerCase();
  const password = req.body.password || '';
  const key = `${req.ip}|${username}`;
  if (tooMany(key)) {
    return res.status(429).render('login', { title: 'Đăng nhập', error: 'Đăng nhập sai quá nhiều lần. Vui lòng thử lại sau 15 phút.', username });
  }
  const u = db.prepare('SELECT * FROM users WHERE username = ? AND active = 1').get(username);
  if (!u || !verifyPassword(password, u.password_hash)) {
    fail(key);
    return res.status(401).render('login', { title: 'Đăng nhập', error: 'Tên đăng nhập hoặc mật khẩu không đúng.', username });
  }
  attempts.delete(key);
  const returnTo = req.session.returnTo;
  req.session.regenerate((err) => {
    if (err) return next(err);
    req.session.userId = u.id;
    req.session.weakPassword = password === 'admin123' || password.length < 8;
    audit(u.id, 'login', 'user', u.id);
    const safe = typeof returnTo === 'string' && returnTo.startsWith('/') && !returnTo.startsWith('//');
    res.redirect(safe ? returnTo : '/');
  });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

router.get('/account/password', requireLogin, (req, res) => {
  res.render('password', { title: 'Đổi mật khẩu', error: null });
});

router.post('/account/password', requireLogin, (req, res) => {
  const { current, password, confirm } = req.body;
  const u = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
  let error = null;
  if (!verifyPassword(current || '', u.password_hash)) error = 'Mật khẩu hiện tại không đúng.';
  else if (!password || password.length < 8) error = 'Mật khẩu mới phải có ít nhất 8 ký tự.';
  else if (password !== confirm) error = 'Xác nhận mật khẩu không khớp.';
  if (error) return res.status(400).render('password', { title: 'Đổi mật khẩu', error });
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), req.user.id);
  req.session.weakPassword = false;
  audit(req.user.id, 'change_password', 'user', req.user.id);
  req.flash('ok', 'Đã đổi mật khẩu.');
  res.redirect('/');
});

module.exports = router;
