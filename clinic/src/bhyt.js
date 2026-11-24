'use strict';
/**
 * BHYT (bảo hiểm y tế): mức hưởng, chia chi phí, và xuất XML giám định theo cấu trúc
 * QĐ 130/QĐ-BYT (sửa đổi bởi QĐ 4750/QĐ-BYT) — bảng XML1 (tổng hợp), XML2 (thuốc), XML3 (DVKT).
 *
 * ⚠ CHƯA ĐỐI CHIẾU VỚI VĂN BẢN GỐC. Tên trường, mã danh mục, định dạng và quy tắc mức hưởng
 * dưới đây được viết theo hiểu biết chung về QĐ 130/4750, chưa kiểm tra với phụ lục chính thức.
 * Trước khi nộp thật: đối chiếu với phụ lục QĐ 130 + 4750 và nộp thử trên cổng kiểm thử của BHXH.
 * Mọi tên trường và mã mặc định tập trung trong file này để dễ sửa.
 */
const { db } = require('./db');
const { today } = require('./helpers');

const cfg = () => ({
  maCSKCB: process.env.BHYT_MA_CSKCB || '',
  luongCoSo: Number(process.env.LUONG_CO_SO) || 2340000,
  maLoaiKCB: process.env.BHYT_MA_LOAI_KCB || '01', // 01: khám bệnh (ngoại trú)
  maDoiTuong: process.env.BHYT_MA_DOITUONG_KCB || '1',
  maQuocTich: process.env.BHYT_MA_QUOCTICH || '000',
  maDanToc: process.env.BHYT_MA_DANTOC || '01',
});

/** Mức hưởng suy ra từ ký tự thứ 3 của mã thẻ BHYT (15 ký tự). Trả về null nếu không xác định. */
function benefitFromCard(card) {
  const c = String(card || '').trim().toUpperCase();
  if (c.length !== 15) return null;
  return { 1: 100, 2: 100, 3: 95, 4: 80, 5: 100 }[c[2]] ?? null;
}

/** Thông tin hưởng BHYT của một lượt khám. */
function coverage(visit, patient) {
  const reasons = [];
  if (!visit?.bhyt) return { eligible: false, rate: 0, reasons: ['Lượt khám không đăng ký BHYT'] };
  if (!patient?.insurance_number) reasons.push('Bệnh nhân chưa có số thẻ BHYT');
  const d = visit.visit_date;
  if (patient?.insurance_valid_from && d < patient.insurance_valid_from) reasons.push('Thẻ BHYT chưa đến hạn sử dụng');
  if (patient?.insurance_valid_to && d > patient.insurance_valid_to) reasons.push('Thẻ BHYT đã hết hạn');
  const rate = patient?.insurance_benefit || benefitFromCard(patient?.insurance_number) || 0;
  if (!rate && patient?.insurance_number) reasons.push('Chưa xác định được mức hưởng từ số thẻ — hãy chọn mức hưởng (80/95/100%) trong hồ sơ bệnh nhân');
  return { eligible: reasons.length === 0, rate: reasons.length ? 0 : rate, reasons };
}

/** Ngưỡng chi phí một lần khám dưới mức này thì BHYT trả 100% (15% lương cơ sở). */
const fullCoverageThreshold = () => Math.round(cfg().luongCoSo * 0.15);

/** Tổng chi phí trong danh mục BHYT của cả lượt khám (để áp ngưỡng 15% lương cơ sở). */
function visitCoveredTotal(visitId) {
  const s = db.prepare(`SELECT COALESCE(SUM(vs.price * vs.quantity),0) AS t FROM visit_services vs
    JOIN services sv ON sv.id = vs.service_id WHERE vs.visit_id = ? AND sv.bhyt_code IS NOT NULL AND sv.bhyt_code != ''`).get(visitId).t;
  const m = db.prepare(`SELECT COALESCE(SUM(pi.price * pi.quantity),0) AS t FROM prescription_items pi
    JOIN medicines md ON md.id = pi.medicine_id WHERE pi.visit_id = ? AND md.bhyt_code IS NOT NULL AND md.bhyt_code != ''`).get(visitId).t;
  return s + m;
}

/** Mức hưởng áp dụng thực tế cho lượt khám (đã xét ngưỡng 15% lương cơ sở). */
function effectiveRate(visit, patient) {
  const c = coverage(visit, patient);
  if (!c.eligible) return { ...c, rate: 0 };
  if (visitCoveredTotal(visit.id) < fullCoverageThreshold()) return { ...c, rate: 100, underThreshold: true };
  return c;
}

/** Chia số tiền một dòng chi phí: BH chi trả, người bệnh cùng chi trả, người bệnh tự trả. */
function split(amount, covered, rate) {
  const bh = covered ? amount : 0;
  const bhtt = Math.round((bh * rate) / 100);
  return { thanhTienBV: amount, thanhTienBH: bh, bhtt, bncct: bh - bhtt, bntt: amount - bh };
}

// ---------------------------------------------------------------- XML

const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const cdata = (v) => `<![CDATA[${String(v ?? '').replace(/]]>/g, ']]]]><![CDATA[>')}]]>`;
/** YYYY-MM-DD[ HH:MM:SS] -> yyyyMMddHHmm */
const dt12 = (s) => {
  if (!s) return '';
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/);
  return m ? `${m[1]}${m[2]}${m[3]}${m[4] || '00'}${m[5] || '00'}` : '';
};
const d8 = (s) => dt12(s).slice(0, 8);
const genderCode = (g) => ({ M: 1, F: 2 }[g] ?? 3);

function el(name, value, { text = false } = {}) {
  return `<${name}>${text ? cdata(value) : esc(value)}</${name}>`;
}

/** Dữ liệu đầy đủ của một lượt khám để xuất XML. */
function loadVisit(visitId) {
  const v = db.prepare(`SELECT v.*, d.bhyt_code AS ma_khoa, u.license_no AS ma_bac_si FROM visits v
    LEFT JOIN departments d ON d.id = v.department_id LEFT JOIN users u ON u.id = v.doctor_id WHERE v.id = ?`).get(visitId);
  if (!v) return null;
  const p = db.prepare('SELECT * FROM patients WHERE id = ?').get(v.patient_id);
  const drugs = db.prepare(`SELECT pi.*, m.name, m.unit, m.bhyt_code, m.strength, m.route, m.reg_no FROM prescription_items pi
    JOIN medicines m ON m.id = pi.medicine_id WHERE pi.visit_id = ? ORDER BY pi.id`).all(visitId);
  const services = db.prepare(`SELECT vs.*, s.name, s.bhyt_code, s.category FROM visit_services vs
    JOIN services s ON s.id = vs.service_id WHERE vs.visit_id = ? ORDER BY vs.id`).all(visitId);
  const lastPaid = db.prepare(`SELECT MAX(paid_at) AS t FROM invoices WHERE visit_id = ? AND status = 'paid'`).get(visitId).t;
  return { v, p, drugs, services, lastPaid };
}

/** Kiểm tra dữ liệu trước khi xuất; trả về danh sách lỗi (chặn) và cảnh báo. */
function validate(data) {
  const { v, p, drugs, services } = data;
  const errors = [];
  const warnings = [];
  const c = coverage(v, p);
  if (!c.eligible) errors.push(...c.reasons);
  if (!cfg().maCSKCB) errors.push('Chưa cấu hình mã cơ sở KCB (BHYT_MA_CSKCB trong config.env)');
  if (v.status !== 'done') errors.push('Lượt khám chưa kết thúc');
  if (!v.icd_code) errors.push('Thiếu mã bệnh chính ICD-10');
  if (!p.dob) errors.push('Thiếu ngày sinh');
  if (!p.insurance_reg_place) warnings.push('Thiếu mã nơi đăng ký KCB ban đầu (MA_DKBD)');
  if (!p.id_number) warnings.push('Thiếu số CCCD');
  if (!v.ma_khoa) warnings.push('Chuyên khoa chưa có mã khoa BHYT');
  if (!v.ma_bac_si) warnings.push('Bác sĩ chưa có số chứng chỉ hành nghề');
  for (const d of drugs) if (!d.bhyt_code) warnings.push(`Thuốc "${d.name}" không có mã BHYT — người bệnh tự trả`);
  for (const s of services) if (!s.bhyt_code) warnings.push(`Dịch vụ "${s.name}" không có mã BHYT — người bệnh tự trả`);
  return { errors, warnings };
}

function buildXml(data, stt = 1) {
  const { v, p, drugs, services, lastPaid } = data;
  const c = cfg();
  const { rate } = effectiveRate(v, p);
  const maLK = `${c.maCSKCB || 'CSKCB'}${String(v.id).padStart(8, '0')}`;
  const tot = { bv: 0, bh: 0, bntt: 0, bncct: 0, bhtt: 0, thuoc: 0, vtyt: 0 };

  const xml2Rows = drugs.map((d, i) => {
    const amount = d.price * d.quantity;
    const s = split(amount, !!d.bhyt_code, rate);
    tot.bv += s.thanhTienBV; tot.bh += s.thanhTienBH; tot.bntt += s.bntt; tot.bncct += s.bncct; tot.bhtt += s.bhtt; tot.thuoc += amount;
    return `<CHI_TIET_THUOC>${[
      el('MA_LK', maLK), el('STT', i + 1), el('MA_THUOC', d.bhyt_code || ''), el('MA_NHOM', 4),
      el('TEN_THUOC', d.name, { text: true }), el('DON_VI_TINH', d.unit, { text: true }), el('HAM_LUONG', d.strength || '', { text: true }),
      el('DUONG_DUNG', d.route || ''), el('LIEU_DUNG', d.dosage || '', { text: true }), el('SO_DANG_KY', d.reg_no || ''),
      el('PHAM_VI', d.bhyt_code ? 1 : 2), el('TYLE_TT_BH', 100), el('SO_LUONG', d.quantity), el('DON_GIA', d.price),
      el('THANH_TIEN_BV', s.thanhTienBV), el('THANH_TIEN_BH', s.thanhTienBH), el('MUC_HUONG', d.bhyt_code ? rate : 0),
      el('T_BNTT', s.bntt), el('T_BNCCT', s.bncct), el('T_BHTT', s.bhtt),
      el('MA_KHOA', v.ma_khoa || ''), el('MA_BAC_SI', v.ma_bac_si || ''), el('NGAY_YL', dt12(v.finished_at || v.created_at)),
    ].join('')}</CHI_TIET_THUOC>`;
  });

  const xml3Rows = services.map((s0, i) => {
    const amount = s0.price * s0.quantity;
    const s = split(amount, !!s0.bhyt_code, rate);
    tot.bv += s.thanhTienBV; tot.bh += s.thanhTienBH; tot.bntt += s.bntt; tot.bncct += s.bncct; tot.bhtt += s.bhtt;
    return `<CHI_TIET_DVKT>${[
      el('MA_LK', maLK), el('STT', i + 1), el('MA_DICH_VU', s0.bhyt_code || ''), el('TEN_DICH_VU', s0.name, { text: true }),
      el('DON_VI_TINH', 'Lần', { text: true }), el('PHAM_VI', s0.bhyt_code ? 1 : 2), el('SO_LUONG', s0.quantity),
      el('DON_GIA_BV', s0.price), el('DON_GIA_BH', s0.bhyt_code ? s0.price : 0), el('TYLE_TT_DV', 100), el('TYLE_TT_BH', 100),
      el('THANH_TIEN_BV', s.thanhTienBV), el('THANH_TIEN_BH', s.thanhTienBH), el('MUC_HUONG', s0.bhyt_code ? rate : 0),
      el('T_BNTT', s.bntt), el('T_BNCCT', s.bncct), el('T_BHTT', s.bhtt),
      el('MA_KHOA', v.ma_khoa || ''), el('MA_BAC_SI', v.ma_bac_si || ''), el('MA_BENH', v.icd_code || ''),
      el('NGAY_YL', dt12(s0.created_at)), el('NGAY_KQ', dt12(s0.result_at)),
    ].join('')}</CHI_TIET_DVKT>`;
  });

  const ngayRa = v.finished_at || v.started_at || v.created_at;
  const xml1 = `<?xml version="1.0" encoding="utf-8"?><TONG_HOP>${[
    el('MA_LK', maLK), el('STT', stt), el('MA_BN', p.code), el('HO_TEN', p.full_name, { text: true }), el('SO_CCCD', p.id_number || ''),
    el('NGAY_SINH', p.dob ? `${d8(p.dob)}0000` : ''), el('GIOI_TINH', genderCode(p.gender)), el('MA_QUOCTICH', c.maQuocTich),
    el('MA_DANTOC', c.maDanToc), el('DIA_CHI', p.address || '', { text: true }), el('DIEN_THOAI', p.phone || ''),
    el('MA_THE_BHYT', (p.insurance_number || '').toUpperCase()), el('MA_DKBD', p.insurance_reg_place || ''),
    el('GT_THE_TU', d8(p.insurance_valid_from)), el('GT_THE_DEN', d8(p.insurance_valid_to)),
    el('LY_DO_VV', v.reason || '', { text: true }), el('CHAN_DOAN_VAO', v.reason || v.diagnosis || '', { text: true }),
    el('CHAN_DOAN_RV', v.diagnosis || '', { text: true }), el('MA_BENH_CHINH', v.icd_code || ''),
    el('MA_DOITUONG_KCB', c.maDoiTuong), el('NGAY_VAO', dt12(v.started_at || v.created_at)), el('NGAY_RA', dt12(ngayRa)),
    el('SO_NGAY_DTRI', 0), el('KET_QUA_DTRI', 1), el('MA_LOAI_RV', 1), el('NGAY_TTOAN', dt12(lastPaid || ngayRa)),
    el('T_THUOC', tot.thuoc), el('T_VTYT', tot.vtyt), el('T_TONGCHI_BV', tot.bv), el('T_TONGCHI_BH', tot.bh),
    el('T_BNTT', tot.bntt), el('T_BNCCT', tot.bncct), el('T_BHTT', tot.bhtt), el('T_NGUONKHAC', 0),
    el('NAM_QT', (ngayRa || today()).slice(0, 4)), el('THANG_QT', (ngayRa || today()).slice(5, 7)),
    el('MA_LOAI_KCB', c.maLoaiKCB), el('MA_KHOA', v.ma_khoa || ''), el('MA_CSKCB', c.maCSKCB),
    el('NGAY_TAI_KHAM', d8(v.follow_up_date)), el('CAN_NANG', v.weight ?? ''),
  ].join('')}</TONG_HOP>`;
  const xml2 = `<?xml version="1.0" encoding="utf-8"?><CHITIEU_CHITIET_THUOC><DSACH_CHI_TIET_THUOC>${xml2Rows.join('')}</DSACH_CHI_TIET_THUOC></CHITIEU_CHITIET_THUOC>`;
  const xml3 = `<?xml version="1.0" encoding="utf-8"?><CHITIEU_CHITIET_DVKT_VTYT><DSACH_CHI_TIET_DVKT>${xml3Rows.join('')}</DSACH_CHI_TIET_DVKT></CHITIEU_CHITIET_DVKT_VTYT>`;
  return { maLK, xml1, xml2, xml3, totals: tot, rate };
}

/** Gói nhiều hồ sơ vào tệp GIAMDINHHS (mỗi bảng mã hóa base64). */
function wrap(records) {
  const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
  const hoso = records.map((r) => `<HOSO>${[['XML1', r.xml1], ['XML2', r.xml2], ['XML3', r.xml3]]
    .map(([t, x]) => `<FILEHOSO><LOAIHOSO>${t}</LOAIHOSO><NOIDUNGFILE>${b64(x)}</NOIDUNGFILE></FILEHOSO>`).join('')}</HOSO>`).join('');
  return `<?xml version="1.0" encoding="utf-8"?><GIAMDINHHS><THONGTINDONVI><MACSKCB>${esc(cfg().maCSKCB)}</MACSKCB></THONGTINDONVI>`
    + `<THONGTINHOSO><NGAYLAP>${today().replace(/-/g, '')}</NGAYLAP><SOLUONGHOSO>${records.length}</SOLUONGHOSO>`
    + `<DANHSACHHOSO>${hoso}</DANHSACHHOSO></THONGTINHOSO><CHUKYDONVI></CHUKYDONVI></GIAMDINHHS>`;
}

module.exports = {
  cfg, benefitFromCard, coverage, effectiveRate, split, fullCoverageThreshold,
  loadVisit, validate, buildXml, wrap,
};
