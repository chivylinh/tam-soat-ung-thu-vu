'use strict';
const express = require('express');
const { db, audit } = require('../db');
const { requireRole } = require('../auth');
const { int, isDate, today, addDays, fmtDate, fmtTime, nowStr } = require('../helpers');

const router = express.Router();
router.use(requireRole('receptionist', 'doctor'));

const DEFAULT_APPT = 'Kính gửi {ten}: {phongkham} xin nhắc lịch hẹn khám {khoa} lúc {gio} ngày {ngay}. Vui lòng đến sớm 15 phút. Cần đổi lịch xin gọi {sdt}.';
const DEFAULT_FOLLOW = 'Kính gửi {ten}: {phongkham} xin nhắc lịch tái khám {khoa} ngày {ngay}. Cần hỗ trợ xin gọi {sdt}.';

function fill(template, vals) {
  return template.replace(/\{(\w+)\}/g, (m, k) => (vals[k] ?? m));
}

/** 0912 345 678 -> 0912345678 ; +84912... -> 0912... (for Zalo / tel links) */
function normalizePhone(phone) {
  let p = String(phone || '').replace(/[^\d+]/g, '');
  if (p.startsWith('+84')) p = `0${p.slice(3)}`;
  else if (p.startsWith('84') && p.length === 11) p = `0${p.slice(2)}`;
  return /^0\d{9,10}$/.test(p) ? p : '';
}

function load(date) {
  const clinic = process.env.CLINIC_NAME || 'Phòng khám Đa khoa';
  const sdt = process.env.CLINIC_PHONE || '';
  const tplA = process.env.REMINDER_APPOINTMENT || DEFAULT_APPT;
  const tplF = process.env.REMINDER_FOLLOWUP || DEFAULT_FOLLOW;
  const appointments = db.prepare(`SELECT a.*, p.full_name, p.phone, p.code, d.name AS dept_name FROM appointments a
    JOIN patients p ON p.id = a.patient_id LEFT JOIN departments d ON d.id = a.department_id
    WHERE substr(a.scheduled_at,1,10) = ? AND a.status = 'scheduled' ORDER BY a.scheduled_at`).all(date)
    .map((a) => ({ ...a, kind: 'appointment', phoneNorm: normalizePhone(a.phone), reminded: a.reminded_at,
      message: fill(tplA, { ten: a.full_name, phongkham: clinic, khoa: a.dept_name || '', gio: fmtTime(a.scheduled_at), ngay: fmtDate(date), sdt }) }));
  // Follow-ups due on this date, unless the patient already booked an appointment for that day
  const followUps = db.prepare(`SELECT v.*, p.full_name, p.phone, p.code, d.name AS dept_name FROM visits v
    JOIN patients p ON p.id = v.patient_id LEFT JOIN departments d ON d.id = v.department_id
    WHERE v.follow_up_date = ? AND v.status = 'done'
      AND NOT EXISTS (SELECT 1 FROM appointments a WHERE a.patient_id = v.patient_id AND substr(a.scheduled_at,1,10) = v.follow_up_date AND a.status != 'cancelled')
    ORDER BY p.full_name`).all(date)
    .map((v) => ({ ...v, kind: 'followup', phoneNorm: normalizePhone(v.phone), reminded: v.follow_up_reminded_at,
      message: fill(tplF, { ten: v.full_name, phongkham: clinic, khoa: v.dept_name || '', ngay: fmtDate(date), gio: '', sdt }) }));
  return { appointments, followUps };
}

router.get('/', (req, res) => {
  const date = isDate(req.query.date) ? req.query.date : addDays(today(), 1);
  const { appointments, followUps } = load(date);
  res.render('reminders', { title: 'Nhắc lịch hẹn & tái khám', date, appointments, followUps, prev: addDays(date, -1), next: addDays(date, 1) });
});

router.post('/mark', (req, res) => {
  const id = int(req.body.id);
  const date = isDate(req.body.date) ? req.body.date : addDays(today(), 1);
  const value = req.body.undo === '1' ? null : nowStr();
  if (req.body.kind === 'appointment') db.prepare('UPDATE appointments SET reminded_at = ? WHERE id = ?').run(value, id);
  else db.prepare('UPDATE visits SET follow_up_reminded_at = ? WHERE id = ?').run(value, id);
  audit(req.user.id, value ? 'reminded' : 'unremind', req.body.kind === 'appointment' ? 'appointment' : 'visit', id);
  res.redirect(`/reminders?date=${date}`);
});

// CSV for bulk SMS / Zalo ZNS platforms: phone,message
router.get('/export.csv', (req, res) => {
  const date = isDate(req.query.date) ? req.query.date : addDays(today(), 1);
  const { appointments, followUps } = load(date);
  const esc = (v) => {
    let s = String(v ?? '');
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = [...appointments, ...followUps].filter((r) => r.phoneNorm && !r.reminded);
  const csv = [['so_dien_thoai', 'ho_ten', 'loai', 'noi_dung'],
    ...rows.map((r) => [r.phoneNorm, r.full_name, r.kind === 'appointment' ? 'Lịch hẹn' : 'Tái khám', r.message])]
    .map((r) => r.map(esc).join(',')).join('\r\n');
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="nhac-lich-${date}.csv"`);
  res.send(`﻿${csv}`);
});

module.exports = router;
module.exports.normalizePhone = normalizePhone;
module.exports.fill = fill;
