'use strict';
/**
 * Shared business logic for visits and billing.
 *
 * Billing model: every ordered service / prescribed medicine is a billable item.
 * Items not yet on a paid invoice are collected into the visit's single *unpaid*
 * invoice. Once that invoice is paid its items are locked; anything ordered later
 * (e.g. lab tests after the consultation fee was paid) goes onto a new invoice.
 */
const { db, tx, audit } = require('./db');
const { today, nowStr } = require('./helpers');

class UserError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.userMessage = message;
    this.status = status;
  }
}

/** Create a visit (lượt khám) and assign the next queue number for the day/department. */
function createVisit({ patientId, departmentId, doctorId, reason, serviceId, userId, date = today() }) {
  return tx(() => {
    const patient = db.prepare('SELECT id FROM patients WHERE id = ?').get(patientId);
    if (!patient) throw new UserError('Không tìm thấy bệnh nhân.');
    const q = db.prepare(`SELECT COALESCE(MAX(queue_number),0) + 1 AS n FROM visits
      WHERE visit_date = ? AND COALESCE(department_id,0) = COALESCE(?,0)`).get(date, departmentId ?? null).n;
    const r = db.prepare(`INSERT INTO visits (patient_id, department_id, doctor_id, visit_date, queue_number, reason, created_by)
      VALUES (?,?,?,?,?,?,?)`).run(patientId, departmentId ?? null, doctorId ?? null, date, q, reason ?? null, userId);
    const visitId = Number(r.lastInsertRowid);
    if (serviceId) addService(visitId, serviceId, userId, 1);
    audit(userId, 'create', 'visit', visitId);
    return visitId;
  });
}

function hasPaidInvoice(visitId) {
  return !!db.prepare(`SELECT 1 FROM invoices WHERE visit_id = ? AND status = 'paid'`).get(visitId);
}

function assertVisitOpen(visitId) {
  const v = db.prepare('SELECT status FROM visits WHERE id = ?').get(visitId);
  if (!v) throw new UserError('Không tìm thấy lượt khám.', 404);
  if (v.status === 'cancelled') throw new UserError('Lượt khám đã bị hủy.');
}

/** True when the item sits on a paid invoice and therefore can't be changed. */
function itemLocked(invoiceId) {
  if (!invoiceId) return false;
  return db.prepare('SELECT status FROM invoices WHERE id = ?').get(invoiceId)?.status === 'paid';
}

function addService(visitId, serviceId, userId, quantity = 1) {
  assertVisitOpen(visitId);
  const s = db.prepare('SELECT * FROM services WHERE id = ? AND active = 1').get(serviceId);
  if (!s) throw new UserError('Dịch vụ không hợp lệ.');
  const qty = Math.max(1, Math.min(100, quantity || 1));
  db.prepare(`INSERT INTO visit_services (visit_id, service_id, price, quantity, ordered_by) VALUES (?,?,?,?,?)`)
    .run(visitId, s.id, s.price, qty, userId);
}

function removeService(visitId, itemId) {
  assertVisitOpen(visitId);
  const it = db.prepare('SELECT * FROM visit_services WHERE id = ? AND visit_id = ?').get(itemId, visitId);
  if (!it) throw new UserError('Không tìm thấy chỉ định.');
  if (itemLocked(it.invoice_id)) throw new UserError('Dịch vụ đã thanh toán, không thể xóa. Cần hủy hóa đơn trước.');
  db.prepare('DELETE FROM visit_services WHERE id = ?').run(itemId);
}

function addPrescription(visitId, { medicineId, quantity, dosage, days }) {
  assertVisitOpen(visitId);
  const m = db.prepare('SELECT * FROM medicines WHERE id = ? AND active = 1').get(medicineId);
  if (!m) throw new UserError('Thuốc không hợp lệ.');
  if (!quantity || quantity < 1 || quantity > 10000) throw new UserError('Số lượng thuốc không hợp lệ.');
  db.prepare(`INSERT INTO prescription_items (visit_id, medicine_id, quantity, price, dosage, days) VALUES (?,?,?,?,?,?)`)
    .run(visitId, m.id, quantity, m.price, dosage ?? null, days ?? null);
  return m;
}

function removePrescription(visitId, itemId) {
  assertVisitOpen(visitId);
  const it = db.prepare('SELECT * FROM prescription_items WHERE id = ? AND visit_id = ?').get(itemId, visitId);
  if (!it) throw new UserError('Không tìm thấy thuốc trong đơn.');
  if (itemLocked(it.invoice_id)) throw new UserError('Thuốc đã thanh toán và xuất kho, không thể xóa. Cần hủy hóa đơn trước.');
  db.prepare('DELETE FROM prescription_items WHERE id = ?').run(itemId);
}

/** Items on this visit that are not on a paid invoice. */
function unbilledCount(visitId) {
  const q = (t) => db.prepare(`SELECT COUNT(*) AS n FROM ${t} x LEFT JOIN invoices i ON i.id = x.invoice_id
    WHERE x.visit_id = ? AND (x.invoice_id IS NULL OR i.status != 'paid')`).get(visitId).n;
  return q('visit_services') + q('prescription_items');
}

/**
 * Create or refresh the unpaid invoice for a visit, pulling in every item not yet paid.
 * Returns the invoice id, or null when there is nothing to bill.
 */
function syncInvoice(visitId, userId) {
  return tx(() => {
    const visit = db.prepare('SELECT * FROM visits WHERE id = ?').get(visitId);
    if (!visit) throw new UserError('Không tìm thấy lượt khám.', 404);
    let inv = db.prepare(`SELECT * FROM invoices WHERE visit_id = ? AND status = 'unpaid'`).get(visitId);
    if (!inv) {
      if (visit.status === 'cancelled') throw new UserError('Lượt khám đã bị hủy.');
      if (unbilledCount(visitId) === 0) return null;
      const r = db.prepare('INSERT INTO invoices (visit_id, patient_id) VALUES (?,?)').run(visitId, visit.patient_id);
      const id = Number(r.lastInsertRowid);
      db.prepare('UPDATE invoices SET code = ? WHERE id = ?').run(`HD${String(id).padStart(6, '0')}`, id);
      audit(userId, 'create', 'invoice', id);
      inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(id);
    }
    // Attach every item not on a paid invoice to this one.
    for (const t of ['visit_services', 'prescription_items']) {
      db.prepare(`UPDATE ${t} SET invoice_id = ? WHERE visit_id = ? AND (invoice_id IS NULL OR invoice_id IN
        (SELECT id FROM invoices WHERE status != 'paid'))`).run(inv.id, visitId);
    }
    db.prepare('DELETE FROM invoice_items WHERE invoice_id = ?').run(inv.id);
    const ins = db.prepare(`INSERT INTO invoice_items (invoice_id, item_type, ref_id, description, quantity, unit_price, amount)
                            VALUES (?,?,?,?,?,?,?)`);
    let subtotal = 0;
    for (const s of db.prepare(`SELECT vs.*, s.name FROM visit_services vs JOIN services s ON s.id = vs.service_id
                                 WHERE vs.invoice_id = ? ORDER BY vs.id`).all(inv.id)) {
      ins.run(inv.id, 'service', s.service_id, s.name, s.quantity, s.price, s.price * s.quantity);
      subtotal += s.price * s.quantity;
    }
    for (const m of db.prepare(`SELECT pi.*, m.name, m.unit FROM prescription_items pi JOIN medicines m ON m.id = pi.medicine_id
                                 WHERE pi.invoice_id = ? ORDER BY pi.id`).all(inv.id)) {
      ins.run(inv.id, 'medicine', m.medicine_id, `${m.name} (${m.unit})`, m.quantity, m.price, m.price * m.quantity);
      subtotal += m.price * m.quantity;
    }
    const discount = Math.min(inv.discount, subtotal);
    db.prepare('UPDATE invoices SET subtotal = ?, discount = ?, total = ? WHERE id = ?').run(subtotal, discount, subtotal - discount, inv.id);
    return inv.id;
  });
}

/** Mark invoice paid and dispense medicines (decrement stock). */
function payInvoice(invoiceId, { method, discount, note }, userId) {
  const inv0 = db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId);
  if (!inv0) throw new UserError('Không tìm thấy hóa đơn.', 404);
  if (inv0.status !== 'unpaid') throw new UserError('Hóa đơn này đã được xử lý.');
  syncInvoice(inv0.visit_id, userId);
  return tx(() => {
    const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId);
    if (inv.status !== 'unpaid') throw new UserError('Hóa đơn này đã được xử lý.');
    const nItems = db.prepare('SELECT COUNT(*) AS n FROM invoice_items WHERE invoice_id = ?').get(inv.id).n;
    if (nItems === 0) throw new UserError('Hóa đơn không có khoản nào để thanh toán.');
    const disc = Math.max(0, Math.min(discount || 0, inv.subtotal));
    const meds = db.prepare(`SELECT ref_id, SUM(quantity) AS qty FROM invoice_items
      WHERE invoice_id = ? AND item_type = 'medicine' GROUP BY ref_id`).all(inv.id);
    for (const m of meds) {
      const med = db.prepare('SELECT name, stock FROM medicines WHERE id = ?').get(m.ref_id);
      if (!med || med.stock < m.qty) {
        throw new UserError(`Không đủ tồn kho: ${med ? med.name : 'thuốc'} (còn ${med ? med.stock : 0}, cần ${m.qty}).`);
      }
    }
    for (const m of meds) {
      db.prepare('UPDATE medicines SET stock = stock - ? WHERE id = ?').run(m.qty, m.ref_id);
      db.prepare(`INSERT INTO stock_movements (medicine_id, change, reason, ref, user_id) VALUES (?,?,?,?,?)`)
        .run(m.ref_id, -m.qty, 'Xuất theo đơn', inv.code, userId);
    }
    db.prepare(`UPDATE invoices SET status = 'paid', discount = ?, total = ?, payment_method = ?, note = ?, paid_at = ?, cashier_id = ?
                WHERE id = ?`).run(disc, inv.subtotal - disc, method, note ?? null, nowStr(), userId, inv.id);
    audit(userId, 'pay', 'invoice', inv.id, `total=${inv.subtotal - disc}`);
  });
}

/** Cancel an invoice. A paid one returns medicines to stock; its items become billable again. */
function cancelInvoice(invoiceId, reason, userId) {
  return tx(() => {
    const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId);
    if (!inv) throw new UserError('Không tìm thấy hóa đơn.', 404);
    if (inv.status === 'cancelled') throw new UserError('Hóa đơn đã bị hủy.');
    if (inv.status === 'paid') {
      const meds = db.prepare(`SELECT ref_id, SUM(quantity) AS qty FROM invoice_items
        WHERE invoice_id = ? AND item_type = 'medicine' GROUP BY ref_id`).all(inv.id);
      for (const m of meds) {
        db.prepare('UPDATE medicines SET stock = stock + ? WHERE id = ?').run(m.qty, m.ref_id);
        db.prepare(`INSERT INTO stock_movements (medicine_id, change, reason, ref, user_id) VALUES (?,?,?,?,?)`)
          .run(m.ref_id, m.qty, 'Hoàn kho do hủy hóa đơn', inv.code, userId);
      }
    }
    for (const t of ['visit_services', 'prescription_items']) {
      db.prepare(`UPDATE ${t} SET invoice_id = NULL WHERE invoice_id = ?`).run(inv.id);
    }
    const note = [inv.note, reason ? `Hủy: ${reason}` : 'Đã hủy'].filter(Boolean).join(' | ');
    db.prepare(`UPDATE invoices SET status = 'cancelled', note = ? WHERE id = ?`).run(note, inv.id);
    audit(userId, 'cancel', 'invoice', inv.id, reason);
  });
}

module.exports = {
  UserError, createVisit, addService, removeService, addPrescription, removePrescription,
  syncInvoice, payInvoice, cancelInvoice, hasPaidInvoice, unbilledCount, itemLocked,
};
