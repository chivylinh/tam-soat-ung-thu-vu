'use strict';
require('./config');

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const session = require('express-session');
const { db, DB_PATH } = require('./db');
const SqliteStore = require('./session-store');
const helpers = require('./helpers');
const { ROLES, hasRole } = require('./auth');

/** SESSION_SECRET from env, else a random one persisted next to the database so restarts keep users logged in. */
function sessionSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  if (DB_PATH === ':memory:') return crypto.randomBytes(32).toString('hex');
  const file = path.join(path.dirname(DB_PATH), '.session-secret');
  try {
    const s = fs.readFileSync(file, 'utf8').trim();
    if (s.length >= 32) return s;
  } catch { /* create below */ }
  const s = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(file, s, { mode: 0o600 });
  return s;
}

function createApp() {
  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '..', 'views'));
  app.set('trust proxy', process.env.TRUST_PROXY === '1' ? 1 : false);
  app.disable('x-powered-by');

  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'same-origin',
      'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:",
    });
    next();
  });

  app.use('/static', express.static(path.join(__dirname, '..', 'public'), { maxAge: '1h' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  app.use(session({
    store: new SqliteStore(db),
    secret: sessionSecret(),
    name: 'pk.sid',
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.COOKIE_SECURE === '1',
      maxAge: 12 * 60 * 60 * 1000,
    },
  }));

  // Current user + CSRF token + view helpers
  app.use((req, res, next) => {
    if (req.session.userId) {
      req.user = db.prepare(`SELECT u.id, u.username, u.full_name, u.role, u.department_id, u.title
                             FROM users u WHERE u.id = ? AND u.active = 1`).get(req.session.userId);
      if (!req.user) delete req.session.userId;
    }
    if (!req.session.csrf) req.session.csrf = crypto.randomBytes(24).toString('hex');
    Object.assign(res.locals, helpers, {
      user: req.user,
      csrf: req.session.csrf,
      ROLES,
      benefitFromCard: require('./bhyt').benefitFromCard,
      can: (...roles) => hasRole(req.user, ...roles),
      path: req.path,
      query: req.query,
      flash: req.session.flash,
      weakPassword: !!req.session.weakPassword,
      title: 'Phòng khám',
      clinicName: process.env.CLINIC_NAME || 'Phòng khám Đa khoa',
    });
    delete req.session.flash;
    next();
  });

  // CSRF check for all state-changing requests
  app.use((req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD') return next();
    const token = req.body?._csrf;
    const expected = req.session.csrf;
    if (token && expected && token.length === expected.length &&
        crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected))) return next();
    res.status(403).render('error', { title: 'Lỗi bảo mật', message: 'Phiên làm việc không hợp lệ hoặc đã hết hạn. Vui lòng tải lại trang và thử lại.' });
  });

  // req.flash(type, message) -> shown on next page
  app.use((req, res, next) => {
    req.flash = (type, message) => { req.session.flash = { type, message }; };
    next();
  });

  app.use(require('./routes/auth'));
  app.use(require('./routes/dashboard'));
  app.use('/patients', require('./routes/patients'));
  app.use('/appointments', require('./routes/appointments'));
  app.use('/visits', require('./routes/visits'));
  app.use('/lab', require('./routes/lab'));
  app.use('/display', require('./routes/display'));
  app.use('/invoices', require('./routes/invoices'));
  app.use('/pharmacy', require('./routes/pharmacy'));
  app.use('/reports', require('./routes/reports'));
  app.use('/bhyt', require('./routes/bhyt'));
  app.use('/reminders', require('./routes/reminders'));
  app.use('/admin', require('./routes/admin'));

  app.use((req, res) => {
    res.status(404).render('error', { title: 'Không tìm thấy', message: 'Trang bạn tìm không tồn tại.' });
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error(err);
    const message = err.userMessage || 'Đã xảy ra lỗi hệ thống. Vui lòng thử lại.';
    res.status(err.status || 500).render('error', { title: 'Lỗi', message });
  });

  return app;
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  const host = process.env.HOST || '0.0.0.0';
  const server = createApp().listen(port, host, () => {
    console.log(`Phần mềm quản lý phòng khám đang chạy tại http://localhost:${port}`);
    require('./backup').scheduleBackups();
  });
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`Cổng ${port} đang được dùng — có thể phần mềm đã chạy sẵn. Mở http://localhost:${port} hoặc đổi PORT trong config.env.`);
      process.exit(1);
    }
    throw err;
  });
}

module.exports = { createApp };
