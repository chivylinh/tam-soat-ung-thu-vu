'use strict';

const pad = (n) => String(n).padStart(2, '0');

/** Local date as YYYY-MM-DD. */
function today(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Local datetime as YYYY-MM-DD HH:MM:SS. */
function nowStr(d = new Date()) {
  return `${today(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + days);
  return today(d);
}

/** YYYY-MM-DD[...] -> DD/MM/YYYY [HH:MM] */
function fmtDate(s) {
  if (!s) return '';
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : s;
}
function fmtDateTime(s) {
  if (!s) return '';
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}` : fmtDate(s);
}
function fmtTime(s) {
  const m = String(s || '').match(/[ T](\d{2}):(\d{2})/);
  return m ? `${m[1]}:${m[2]}` : '';
}

function money(n) {
  return `${Number(n || 0).toLocaleString('vi-VN')} ₫`;
}

function age(dob) {
  if (!dob) return '';
  const b = new Date(`${String(dob).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(b.getTime())) return '';
  const t = new Date();
  let a = t.getFullYear() - b.getFullYear();
  if (t.getMonth() < b.getMonth() || (t.getMonth() === b.getMonth() && t.getDate() < b.getDate())) a--;
  if (a < 1) {
    const months = (t.getFullYear() - b.getFullYear()) * 12 + t.getMonth() - b.getMonth() - (t.getDate() < b.getDate() ? 1 : 0);
    return `${Math.max(months, 0)} tháng`;
  }
  return `${a} tuổi`;
}

const GENDERS = { M: 'Nam', F: 'Nữ', O: 'Khác' };

const VISIT_STATUS = {
  waiting: ['Chờ khám', 'warn'],
  in_progress: ['Đang khám', 'info'],
  done: ['Đã khám', 'ok'],
  cancelled: ['Đã hủy', 'muted'],
};
const APPT_STATUS = {
  scheduled: ['Đã đặt', 'info'],
  checked_in: ['Đã tiếp đón', 'ok'],
  cancelled: ['Đã hủy', 'muted'],
  no_show: ['Không đến', 'danger'],
};
const INVOICE_STATUS = {
  unpaid: ['Chưa thanh toán', 'warn'],
  paid: ['Đã thanh toán', 'ok'],
  cancelled: ['Đã hủy', 'muted'],
};
const PAYMENT_METHODS = { cash: 'Tiền mặt', transfer: 'Chuyển khoản', card: 'Thẻ' };

/** Trim string, return null when empty. */
function str(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}
/** Parse integer, null when empty/invalid. */
function int(v) {
  const s = str(v);
  if (s === null) return null;
  const n = Number.parseInt(s.replace(/[.,\s]/g, ''), 10);
  return Number.isFinite(n) ? n : null;
}
function num(v) {
  const s = str(v);
  if (s === null) return null;
  const n = Number.parseFloat(s.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}
function isDate(v) {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(new Date(`${v}T00:00:00`).getTime());
}
/** Normalize to an array (for repeated form fields). */
function arr(v) {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

function bmi(weight, height) {
  if (!weight || !height) return '';
  const h = height / 100;
  return (weight / (h * h)).toFixed(1);
}

module.exports = {
  today, nowStr, addDays, fmtDate, fmtDateTime, fmtTime, money, age, bmi,
  GENDERS, VISIT_STATUS, APPT_STATUS, INVOICE_STATUS, PAYMENT_METHODS,
  str, int, num, isDate, arr,
};
