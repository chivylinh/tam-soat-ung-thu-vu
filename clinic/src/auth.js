'use strict';
const crypto = require('node:crypto');

const ROLES = {
  admin: 'Quản trị',
  doctor: 'Bác sĩ',
  technician: 'Kỹ thuật viên CLS',
  receptionist: 'Lễ tân',
  cashier: 'Thu ngân',
  pharmacist: 'Dược sĩ',
};

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifyPassword(password, stored) {
  const [scheme, saltHex, hashHex] = String(stored).split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

function requireLogin(req, res, next) {
  if (req.user) return next();
  if (req.method === 'GET') req.session.returnTo = req.originalUrl;
  res.redirect('/login');
}

/** Allow only the given roles (admin always allowed). */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.redirect('/login');
    if (req.user.role === 'admin' || roles.includes(req.user.role)) return next();
    res.status(403).render('error', { title: 'Không có quyền', message: 'Bạn không có quyền truy cập chức năng này.' });
  };
}

function hasRole(user, ...roles) {
  return !!user && (user.role === 'admin' || roles.includes(user.role));
}

module.exports = { ROLES, hashPassword, verifyPassword, requireLogin, requireRole, hasRole };
