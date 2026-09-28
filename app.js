/* Vethi Verify v1.0 — ระบบรับ–ส่งและตรวจสอบวุฒิการศึกษา (Prototype, เก็บข้อมูลในเบราว์เซอร์) */
'use strict';

/* ---------- ค่าคงที่ ---------- */
const KEY = 'vethi-verify-v1';
const TH_M = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];
const TH_MS = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
const PREFIX_RE = /^(เด็กชาย|เด็กหญิง|นางสาว|นาย|นาง|ด\.ช\.|ด\.ญ\.|น\.ส\.)\s*/;
const RESULT = {
  pending:  { t: 'รอตรวจสอบ',          c: 'warn' },
  found:    { t: 'สำเร็จการศึกษาจริง',  c: 'ok' },
  mismatch: { t: 'ข้อมูลไม่ตรงกัน',     c: 'info' },
  notfound: { t: 'ไม่พบข้อมูล',        c: 'danger' }
};
const LETTER_RESULT = {
  found: 'สำเร็จการศึกษาจริง',
  mismatch: 'ข้อมูลไม่ตรงกับหลักฐานของโรงเรียน',
  notfound: 'ไม่พบหลักฐานการสำเร็จการศึกษา',
  pending: 'อยู่ระหว่างตรวจสอบ'
};
const STATUS = {
  received: { t: 'รับหนังสือแล้ว',      c: 'info', step: 0 },
  checking: { t: 'กำลังตรวจสอบ',       c: 'warn', step: 1 },
  done:     { t: 'ตรวจสอบเสร็จ',        c: 'ok',   step: 2 },
  replied:  { t: 'ส่งหนังสือตอบแล้ว',    c: 'ok',   step: 3 }
};
const STEPS = ['รับหนังสือ', 'กำลังตรวจสอบ', 'ตรวจสอบเสร็จ', 'ส่งหนังสือตอบ'];
const VIEWS = [
  ['dash', '📊 Dashboard'], ['receive', '📥 รับหนังสือ'], ['outgoing', '📤 หนังสือส่งออก'],
  ['verify', '🔍 ตรวจสอบ'], ['grads', '🎓 ฐานข้อมูลผู้สำเร็จการศึกษา'], ['fees', '💳 ค่าบำรุงการศึกษา'],
  ['track', '🧭 ติดตามสถานะ'], ['reports', '📈 รายงาน'], ['settings', '⚙️ ตั้งค่า']
];
const OTP_TTL = 5 * 60 * 1000;
const OTP_MAX_TRIES = 5;

let inFrame = true;
try { inFrame = window.self !== window.top; } catch (e) { inFrame = true; }
const canPrint = !inFrame;

/* ---------- ตัวช่วย ---------- */
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const uid = p => p + Math.random().toString(36).slice(2, 9);
const thaiDigits = s => String(s ?? '').replace(/[๐-๙]/g, d => '๐๑๒๓๔๕๖๗๘๙'.indexOf(d));
const digits = s => thaiDigits(s).replace(/\D/g, '');
const money = n => Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const isoOf = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const todayISO = () => isoOf(new Date());
const beYear = () => new Date().getFullYear() + 543;
function fmtBE(iso) { if (!iso) return '-'; const [y, m, d] = iso.split('-'); return `${d}/${m}/${+y + 543}`; }
function fmtLong(iso) { if (!iso) return '-'; const [y, m, d] = iso.split('-'); return `${+d} ${TH_M[+m - 1]} ${+y + 543}`; }
function fmtDT(ts) { const d = new Date(ts); return `${d.getDate()} ${TH_MS[d.getMonth()]} ${d.getFullYear() + 543} · ${pad(d.getHours())}:${pad(d.getMinutes())} น.`; }
const reEsc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const MONTH_RE = new RegExp('(\\d{1,2})\\s*(' + [...TH_M, ...TH_MS].map(reEsc).join('|') + ')\\s*(?:พ\\.ศ\\.\\s*)?(\\d{4})');
function mkISO(y, m, d) {
  y = +y; m = +m; d = +d;
  if (y > 2400) y -= 543;
  if (!(y > 1900 && y < 2200 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return '';
  return `${y}-${pad(m)}-${pad(d)}`;
}
function findDate(str) {
  const s = thaiDigits(str);
  let m = s.match(MONTH_RE);
  if (m) { let i = TH_M.indexOf(m[2]); if (i < 0) i = TH_MS.indexOf(m[2]); return mkISO(m[3], i + 1, m[1]); }
  m = s.match(/(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})/);
  if (m) return mkISO(m[3], m[2], m[1]);
  m = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return mkISO(m[1], m[2], m[3]);
  return '';
}
function parseDateAny(v) {
  const s = thaiDigits(v).trim();
  if (/^\d{5}(\.\d+)?$/.test(s)) { const d = new Date(Math.round((+s - 25569) * 864e5)); return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); }
  return findDate(s);
}
function splitName(full) {
  let s = String(full || '').trim().replace(/\s+/g, ' ');
  let prefix = '';
  const m = s.match(PREFIX_RE);
  if (m) { prefix = m[1]; s = s.slice(m[0].length).trim(); }
  const i = s.indexOf(' ');
  return { prefix, fname: i < 0 ? s : s.slice(0, i), lname: i < 0 ? '' : s.slice(i + 1) };
}
const CID_RE = /\d[-\s]?\d{4}[-\s]?\d{5}[-\s]?\d{2}[-\s]?\d/;
function splitIds(str) {
  const s = thaiDigits(str);
  let cid = '', rest = s;
  const m = s.match(CID_RE);
  if (m) { cid = digits(m[0]); rest = s.replace(m[0], ' '); }
  const sm = rest.match(/\d{3,7}/);
  return { cid, sid: sm ? sm[0] : '' };
}
function normLevel(s) {
  const t = thaiDigits(s);
  const d = t.match(/[1-6]/);
  return d ? 'ม.' + d[0] : String(s || '').trim();
}
const normName = s => String(s || '').replace(PREFIX_RE, '').replace(/\s+/g, '');
const sidKey = s => digits(s).replace(/^0+/, '');
function maskCid(c) { c = digits(c); if (c.length !== 13) return c || '-'; return `${c[0]}-${c.slice(1, 5)}-xxxxx-${c.slice(10, 12)}-${c[12]}`; }
const fullName = s => `${s.prefix || ''}${s.fname} ${s.lname}`.trim();

function parseCSV(text) {
  text = String(text || '').replace(/^﻿/, '');
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n') { row.push(f); rows.push(row); row = []; f = ''; }
    else if (c !== '\r') f += c;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  return rows.filter(r => r.some(x => String(x).trim()));
}

/* ---------- ข้อมูล ---------- */
let storageOK = true;
function load() { try { const t = localStorage.getItem(KEY); return t ? JSON.parse(t) : null; } catch (e) { storageOK = false; return null; } }
function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); storageOK = true; } catch (e) { storageOK = false; } }

function defaultSettings() {
  return {
    school: 'โรงเรียนวรราชาทินัดดามาตุวิทยา',
    address: 'จังหวัดนนทบุรี',
    docPrefix: 'ศธ 04xxx.xx/',
    director: '',
    directorTitle: 'ผู้อำนวยการโรงเรียนวรราชาทินัดดามาตุวิทยา',
    office: 'กลุ่มบริหารวิชาการ งานทะเบียนและวัดผล',
    phone: '',
    email: '',
    nextReg: 50,
    nextOut: 121
  };
}

function seed() {
  const st = [
    ['10231', '1129900123451', 'นาย', 'ธนกฤต', 'ศรีสมบูรณ์', 'ม.6', '2026-03-31', '3.45'],
    ['10232', '1129900123462', 'นางสาว', 'พิมพ์ชนก', 'แก้วประเสริฐ', 'ม.6', '2026-03-31', '3.82'],
    ['10245', '1129900123473', 'นาย', 'ภูมิพัฒน์', 'วงศ์ทอง', 'ม.6', '2026-03-31', '2.97'],
    ['10250', '1129900123484', 'นางสาว', 'ณัฐธิดา', 'บุญมา', 'ม.6', '2026-03-31', '3.21'],
    ['09812', '1129900123495', 'นาย', 'กิตติภพ', 'จันทร์หอม', 'ม.6', '2025-03-31', '3.05'],
    ['09820', '1129900123506', 'นางสาว', 'ศิริญา', 'ทองดี', 'ม.6', '2025-03-31', '3.67'],
    ['09833', '1129900123517', 'นาย', 'อนุชา', 'พรหมมา', 'ม.6', '2025-03-31', '2.54'],
    ['11402', '1129900123528', 'เด็กหญิง', 'ปาณิสรา', 'สุขเจริญ', 'ม.3', '2026-03-31', '3.90'],
    ['11415', '1129900123539', 'เด็กชาย', 'วรเมธ', 'นาคสวัสดิ์', 'ม.3', '2026-03-31', '2.88'],
    ['11420', '1129900123540', 'เด็กหญิง', 'กัญญาณัฐ', 'ศรีสุข', 'ม.3', '2026-03-31', '3.12'],
    ['09104', '1129900123551', 'นางสาว', 'มณีรัตน์', 'อินทร์แก้ว', 'ม.6', '2024-03-31', '3.40'],
    ['09117', '1129900123562', 'นาย', 'ชยพล', 'ประเสริฐสุข', 'ม.6', '2024-03-31', '2.76']
  ];
  const students = st.map(a => ({ id: uid('s'), sid: a[0], cid: a[1], prefix: a[2], fname: a[3], lname: a[4], level: a[5], gradDate: a[6], gpa: a[7], dob: '', father: '', mother: '', source: 'ตัวอย่าง' }));
  const bySid = sid => students.find(s => s.sid === sid);
  const fees = [
    { id: uid('f'), studentId: bySid('10245').id, term: '2/2568', item: 'ค่าบำรุงการศึกษา', amount: 3500, paid: 1500, note: '' },
    { id: uid('f'), studentId: bySid('09833').id, term: '2/2567', item: 'ค่าบำรุงการศึกษา', amount: 3500, paid: 0, note: '' },
    { id: uid('f'), studentId: bySid('09833').id, term: '2/2567', item: 'ค่ากิจกรรมพัฒนาผู้เรียน', amount: 800, paid: 0, note: '' },
    { id: uid('f'), studentId: bySid('10250').id, term: '2/2568', item: 'ค่าบำรุงการศึกษา', amount: 3500, paid: 3500, note: 'ชำระครบ' }
  ];
  const P = (sid, fname, lname, gradDate, level) => ({ id: uid('p'), sid, fname, lname, gradDate, gradText: gradDate ? fmtBE(gradDate) : '', level, result: 'pending', matchedId: null, auto: '', note: '', manual: false });
  const ts = (iso, hh) => new Date(iso + 'T' + (hh || '09:30') + ':00').getTime();
  const requests = [
    { id: uid('r'), regNo: '41/2569', recvDate: '2026-08-18', agency: 'บริษัท ไทยสมาร์ท โลจิสติกส์ จำกัด', to: 'ผู้จัดการฝ่ายทรัพยากรบุคคล บริษัท ไทยสมาร์ท โลจิสติกส์ จำกัด', docNo: 'TSL-HR 045/2569', docDate: '2026-08-12', email: 'hr@thaismart.example.com', form: 2, file: '',
      persons: [P('09820', 'ศิริญา', 'ทองดี', '2025-03-31', 'ม.6'), P('09833', 'อนุชา', 'พรหมมา', '2025-03-31', 'ม.6')],
      status: 'replied', outNo: '118/2569', outDate: '2026-08-22', sentDate: '2026-08-22',
      timeline: [{ t: ts('2026-08-18'), text: 'รับหนังสือ เลขทะเบียนรับ 41/2569', pub: true }, { t: ts('2026-08-19', '10:15'), text: 'ตรวจสอบกับฐานข้อมูลผู้สำเร็จการศึกษา', pub: true }, { t: ts('2026-08-19', '10:20'), text: 'ตรวจสอบครบทุกรายแล้ว', pub: true }, { t: ts('2026-08-22', '14:00'), text: 'ออกเลขหนังสือส่ง ที่ 118/2569', pub: true }, { t: ts('2026-08-22', '14:05'), text: 'ส่งหนังสือแจ้งผลการตรวจสอบถึงหน่วยงานแล้ว', pub: true }] },
    { id: uid('r'), regNo: '44/2569', recvDate: '2026-09-02', agency: 'โรงพยาบาลตัวอย่างนนทเวช', to: 'ผู้อำนวยการโรงพยาบาลตัวอย่างนนทเวช', docNo: 'รพ.นว 512/2569', docDate: '2026-08-28', email: 'hr@hospital.example.com', form: 2, file: '',
      persons: [P('09104', 'มณีรัตน์', 'อินทร์แก้ว', '2024-03-31', 'ม.6'), P('09150', 'ปวีณา', 'ใจงาม', '2024-03-31', 'ม.6')],
      status: 'done', outNo: '', outDate: '', sentDate: '',
      timeline: [{ t: ts('2026-09-02'), text: 'รับหนังสือ เลขทะเบียนรับ 44/2569', pub: true }, { t: ts('2026-09-03', '11:00'), text: 'ตรวจสอบครบทุกรายแล้ว', pub: true }] },
    { id: uid('r'), regNo: '47/2569', recvDate: '2026-09-10', agency: 'กองทะเบียนและประมวลผล มหาวิทยาลัยตัวอย่าง', to: 'ผู้อำนวยการกองทะเบียนและประมวลผล มหาวิทยาลัยตัวอย่าง', docNo: 'REG 2231/2569', docDate: '2026-09-05', email: 'registrar@univ.example.ac.th', form: 1, file: 'รายชื่อผู้สมัคร_รอบ2.xlsx',
      persons: [P('10231', 'ธนกฤต', 'ศรีสมบูรณ์', '2026-03-31', 'ม.6'), P('10232', 'พิมพ์ชนก', 'แก้วประเสริฐ', '2026-03-31', 'ม.6'), P('10245', 'ภูมิพัฒน์', 'วงศ์ทอง', '2026-03-15', 'ม.6'), P('10299', 'สุดารัตน์', 'มีสุข', '2026-03-31', 'ม.6')],
      status: 'checking', outNo: '', outDate: '', sentDate: '',
      timeline: [{ t: ts('2026-09-10'), text: 'รับหนังสือ เลขทะเบียนรับ 47/2569', pub: true }, { t: ts('2026-09-11', '13:40'), text: 'เริ่มตรวจสอบรายชื่อ', pub: true }] },
    { id: uid('r'), regNo: '49/2569', recvDate: '2026-09-24', agency: 'บริษัท เอ็นบีเอ็ม การ์เมนท์ จำกัด', to: 'ผู้จัดการฝ่ายบุคคล บริษัท เอ็นบีเอ็ม การ์เมนท์ จำกัด', docNo: 'NBM 0192/2569', docDate: '2026-09-20', email: 'recruit@nbm.example.co.th', form: 2, file: '',
      persons: [P('09117', 'ชยพล', 'ประเสริฐสุข', '2024-03-31', 'ม.6'), P('11420', 'กัญญาณัฐ', 'ศรีสุข', '2026-03-31', 'ม.3')],
      status: 'received', outNo: '', outDate: '', sentDate: '',
      timeline: [{ t: ts('2026-09-24'), text: 'รับหนังสือ เลขทะเบียนรับ 49/2569', pub: true }] }
  ];
  const data = { v: 1, settings: defaultSettings(), students, fees, requests };
  // จับคู่ผลตัวอย่าง (ยกเว้นรายสุดท้ายของหนังสือ 47 และหนังสือ 49 ที่ยังรอตรวจ)
  requests.forEach((r, ri) => r.persons.forEach((p, i) => {
    if (ri === 3 || (ri === 2 && i === 3)) return;
    Object.assign(p, matchPerson(p, students));
  }));
  return data;
}

let S = load();
if (!S || !S.v) { S = seed(); save(); }

/* ---------- สถานะหน้าจอ ---------- */
const U = {
  mode: location.hash === '#portal' ? 'portal' : 'staff',
  view: 'dash', reqId: null, trackId: null, letterId: null,
  gq: '', glevel: '', fq: '', fOnly: true, tq: '', vq: '', showAdd: false,
  draft: newDraft(), portal: { step: 'form' }, otp: null, lastImport: ''
};
function newDraft() { return { form: 2, file: '', date: todayISO(), email: '', agency: '', to: '', docno: '', docdate: '', persons: [blankP(), blankP()] }; }
function blankP() { return { sid: '', fname: '', lname: '', gradText: '', level: '' }; }

const getReq = id => S.requests.find(r => r.id === id);
const getStu = id => S.students.find(s => s.id === id);
const byRecv = (a, b) => (b.recvDate || '').localeCompare(a.recvDate || '') || b.regNo.localeCompare(a.regNo);
const outstanding = sid => S.fees.filter(f => f.studentId === sid).reduce((a, f) => a + Math.max(0, f.amount - f.paid), 0);
const totalOutstanding = () => S.fees.reduce((a, f) => a + Math.max(0, f.amount - f.paid), 0);
const nextRegNo = () => `${S.settings.nextReg}/${beYear()}`;
const statusBadge = r => `<span class="badge ${STATUS[r.status].c}">${STATUS[r.status].t}</span>`;
const resultBadge = k => `<span class="badge ${RESULT[k].c}">${RESULT[k].t}</span>`;
function addTL(r, text, pub) { r.timeline.push({ t: Date.now(), text, pub: !!pub }); }

/* ---------- การจับคู่กับฐานข้อมูล ---------- */
function matchPerson(p, students = S.students) {
  const cid = digits(p.cid);
  let best = null, bestScore = 0;
  for (const s of students) {
    const bySid = !!(sidKey(p.sid) && sidKey(p.sid) === sidKey(s.sid));
    const byCid = !!(cid && cid === s.cid);
    const byName = !!(p.fname && normName(p.fname) === normName(s.fname) && normName(p.lname) === normName(s.lname));
    const sc = (bySid ? 2 : 0) + (byCid ? 3 : 0) + (byName ? 2 : 0);
    if (sc > bestScore) { best = { s, bySid, byCid, byName }; bestScore = sc; }
  }
  if (!best) return { result: 'notfound', matchedId: null, auto: 'ไม่พบในฐานข้อมูลผู้สำเร็จการศึกษา' };
  const issues = [];
  if (!best.byName) issues.push('ชื่อ-สกุลไม่ตรง');
  if (p.sid && !best.bySid) issues.push('เลขประจำตัวไม่ตรง');
  if (p.gradDate && best.s.gradDate && p.gradDate !== best.s.gradDate) issues.push(`วันที่จบไม่ตรง (ฐานข้อมูล ${fmtBE(best.s.gradDate)})`);
  if (p.level && best.s.level && normLevel(p.level) !== best.s.level) issues.push(`ระดับชั้นไม่ตรง (ฐานข้อมูล ${best.s.level})`);
  return issues.length
    ? { result: 'mismatch', matchedId: best.s.id, auto: issues.join(' · ') }
    : { result: 'found', matchedId: best.s.id, auto: 'ข้อมูลตรงกับฐานข้อมูล' };
}
function refreshStatus(r) {
  if (r.status === 'replied') return;
  const pend = r.persons.filter(p => p.result === 'pending').length;
  const ns = pend === 0 ? 'done' : (pend < r.persons.length ? 'checking' : 'received');
  if (ns !== r.status) {
    if (ns === 'checking') addTL(r, 'เริ่มตรวจสอบรายชื่อ', true);
    if (ns === 'done') addTL(r, 'ตรวจสอบครบทุกรายแล้ว', true);
    r.status = ns;
  }
}

/* ---------- การนำเข้าไฟล์ ---------- */
function readText(file) { return file.text ? file.text() : new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsText(file); }); }
async function fileToMatrix(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith('.csv') || name.endsWith('.txt')) return parseCSV(await readText(file));
  if (typeof XLSX === 'undefined') throw new Error('ยังโหลดตัวอ่านไฟล์ Excel ไม่สำเร็จ ตรวจสอบการเชื่อมต่ออินเทอร์เน็ตแล้วลองอีกครั้ง');
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  const out = [];
  wb.SheetNames.forEach(n => out.push(...XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: false, defval: '' })));
  return out;
}

/* ปพ.3: อ่านทุกแถวในทุกชีต ดึงข้อมูลจากแถวที่มีคำนำหน้าชื่อ + รหัส/เลขบัตร */
function parsePP3Row(r) {
  const cells = r.map(c => thaiDigits(String(c ?? '')).trim()).filter(Boolean);
  let name = '', cid = '', sid = '', dob = '', gpa = '';
  const names = [], evals = [];
  for (const c of cells) {
    if (PREFIX_RE.test(c) && /[ก-๙]/.test(c) && c.length < 80) { names.push(c.replace(/\s+/g, ' ')); continue; }
    const ids = splitIds(c);
    if (ids.cid && !cid) { cid = ids.cid; if (ids.sid && !sid) sid = ids.sid; continue; }
    if (!sid && /^\d{4,7}$/.test(c)) { sid = c; continue; }
    if (!gpa && /^[0-4]\.\d{2}$/.test(c)) { gpa = c; continue; }
    if (!dob) { const d = findDate(c); if (d) { dob = d; continue; } }
    if (/^(ดีเยี่ยม|ดี|ผ่าน|ไม่ผ่าน)$/.test(c)) evals.push(c);
  }
  name = names[0] || '';
  if (!name || (!sid && !cid)) return null;
  const n = splitName(name);
  return { sid, cid, ...n, dob, gpa, father: names[1] || '', mother: names[2] || '', evals };
}
async function importPP3(file, level, fallbackISO) {
  const rows = await fileToMatrix(file);
  let approval = '';
  rows.forEach((r, i) => {
    const line = r.join(' ');
    if (/อนุมัติ/.test(line)) {
      for (let k = i; k < Math.min(rows.length, i + 8); k++) { const d = findDate(rows[k].join(' ')); if (d) { approval = d; break; } }
    }
  });
  const gradDate = approval || fallbackISO;
  const seen = new Set(), recs = [];
  for (const r of rows) {
    const rec = parsePP3Row(r);
    if (!rec) continue;
    const k = rec.sid || rec.cid;
    if (seen.has(k)) continue;
    seen.add(k); recs.push(rec);
  }
  let added = 0, updated = 0;
  recs.forEach(rec => {
    const ex = S.students.find(s => (rec.cid && s.cid === rec.cid) || (rec.sid && sidKey(s.sid) === sidKey(rec.sid) && s.level === level));
    const obj = { sid: rec.sid, cid: rec.cid, prefix: rec.prefix, fname: rec.fname, lname: rec.lname, level, gradDate, dob: rec.dob, gpa: rec.gpa, father: rec.father, mother: rec.mother, evals: rec.evals, source: 'ปพ.3 ' + file.name };
    if (ex) { Object.assign(ex, obj); updated++; } else { S.students.push({ id: uid('s'), ...obj }); added++; }
  });
  save();
  return { total: recs.length, added, updated, approval, gradDate };
}
function importGradCSV(text) {
  const rows = parseCSV(text);
  if (!rows.length) return { added: 0, updated: 0, skipped: 0 };
  const h = rows[0].map(x => String(x).trim());
  const find = re => h.findIndex(x => re.test(x));
  let iSid = find(/รหัส|เลขประจำตัว(?!ประชาชน)/), iCid = find(/ประชาชน|บัตร/), iName = find(/ชื่อ/), iLv = find(/ระดับ|ชั้น/), iDate = find(/วันที่|จบ/), iGpa = find(/GPA|เกรด|เฉลี่ย/i);
  let start = 1;
  if (iName < 0) { iSid = 0; iName = 1; iLv = 2; iDate = 3; iCid = -1; iGpa = -1; start = 0; }
  if (iDate === iLv) iDate = find(/วันที่/);
  let added = 0, updated = 0, skipped = 0;
  rows.slice(start).forEach(r => {
    const ids = splitIds(r[iSid] || '');
    const cid = iCid >= 0 ? digits(r[iCid]) : ids.cid;
    const n = splitName(r[iName]);
    if (!n.fname) { skipped++; return; }
    const obj = { sid: ids.sid || String(r[iSid] || '').trim(), cid, ...n, level: normLevel(r[iLv]), gradDate: parseDateAny(r[iDate] || ''), gpa: iGpa >= 0 ? String(r[iGpa] || '').trim() : '', source: 'CSV' };
    const ex = S.students.find(s => (obj.cid && s.cid === obj.cid) || (obj.sid && sidKey(s.sid) === sidKey(obj.sid) && s.level === obj.level));
    if (ex) { Object.assign(ex, obj); updated++; } else { S.students.push({ id: uid('s'), dob: '', father: '', mother: '', ...obj }); added++; }
  });
  save();
  return { added, updated, skipped };
}
function personsFromMatrix(rows) {
  let hi = rows.findIndex(r => r.some(c => /ชื่อ/.test(String(c))));
  const h = hi >= 0 ? rows[hi].map(c => String(c).trim()) : [];
  const find = re => h.findIndex(x => re.test(x));
  let iSid = find(/เลขประจำตัว(?!ประชาชน)|รหัส/), iFull = find(/ชื่อ\s*-?\s*(ชื่อ)?\s*สกุล/), iF = find(/^ชื่อ$|^ชื่อ\s|ชื่อ(?!.*สกุล)/), iL = find(/^สกุล|นามสกุล|^สกุล$/), iDate = find(/จบ|วันที่/), iLv = find(/ระดับ|ชั้น/);
  if (hi < 0) { iSid = 0; iF = 1; iL = 2; iDate = 3; iLv = 4; iFull = -1; }
  const body = rows.slice(hi + 1);
  return body.map(r => {
    let fname = '', lname = '';
    if (iFull >= 0) { const n = splitName(r[iFull]); fname = n.fname; lname = n.lname; }
    else { fname = splitName(r[iF]).fname; lname = String(r[iL] ?? '').trim(); if (!lname) { const n = splitName(r[iF]); fname = n.fname; lname = n.lname; } }
    const gd = parseDateAny(r[iDate] ?? '');
    return { sid: iSid >= 0 ? splitIds(r[iSid] ?? '').sid || String(r[iSid] ?? '').trim() : '', fname, lname, gradText: gd ? fmtBE(gd) : String(r[iDate] ?? '').trim(), level: iLv >= 0 && r[iLv] ? normLevel(r[iLv]) : '' };
  }).filter(p => p.fname);
}

/* ---------- ส่วนประกอบ ---------- */
function stat(label, n, unit, color) {
  return `<div class="card stat" style="--accent:${color}"><span class="muted">${label}</span><div class="num">${n}<span class="unit">${unit}</span></div></div>`;
}
function bar(label, v, max, k) {
  return `<div class="barrow"><span>${label}</span><div class="bartrack"><div class="barfill b-${k}" style="width:${(v / max) * 100}%"></div></div><b>${v}</b></div>`;
}
function resultSummary(r) {
  const c = k => r.persons.filter(p => p.result === k).length;
  const parts = [];
  if (c('found')) parts.push(`<span class="badge ok">ตรง ${c('found')}</span>`);
  if (c('mismatch')) parts.push(`<span class="badge info">ไม่ตรง ${c('mismatch')}</span>`);
  if (c('notfound')) parts.push(`<span class="badge danger">ไม่พบ ${c('notfound')}</span>`);
  if (c('pending')) parts.push(`<span class="badge warn">รอ ${c('pending')}</span>`);
  return `<div class="row" style="gap:4px">${parts.join('')}</div>`;
}
function reqTable(list, ctx) {
  if (!list.length) return `<p class="muted">ยังไม่มีหนังสือ</p>`;
  return `<div class="tablewrap"><table><thead><tr><th>เลขรับ</th><th>วันที่รับ</th><th>หน่วยงาน / เลขที่หนังสือ</th><th>แบบ</th><th class="num">ราย</th><th>สถานะ</th><th></th></tr></thead><tbody>
  ${list.map(r => `<tr><td><b>${esc(r.regNo)}</b></td><td>${fmtBE(r.recvDate)}</td><td>${esc(r.agency)}<div class="sub">ที่ ${esc(r.docNo)}</div></td><td>${r.form == 1 ? 'แบบที่ 1' : 'แบบที่ 2'}</td><td class="num">${r.persons.length}</td><td>${statusBadge(r)}</td>
  <td class="tdact"><button type="button" class="btn btn-outline sm" data-act="openverify" data-id="${r.id}">ตรวจสอบ</button> <button type="button" class="btn btn-outline sm" data-act="opentrack" data-id="${r.id}">ติดตาม</button>${ctx === 'receive' ? ` <button type="button" class="btn btn-outline sm" data-act="delreq" data-id="${r.id}">ลบ</button>` : ''}</td></tr>`).join('')}
  </tbody></table></div>`;
}
function stepper(r) {
  const cur = STATUS[r.status].step;
  return `<ol class="stepper">${STEPS.map((s, i) => `<li class="${i <= cur ? 'done' : ''} ${i === cur ? 'cur' : ''}"><span>${i + 1}</span>${s}</li>`).join('')}</ol>`;
}

/* ---------- หน้าจอเจ้าหน้าที่ ---------- */
function vDash() {
  const R = S.requests, pend = R.filter(r => r.status !== 'replied').length;
  const persons = R.flatMap(r => r.persons), cnt = k => persons.filter(p => p.result === k).length, max = Math.max(1, persons.length);
  const debtors = new Set(S.fees.filter(f => f.amount - f.paid > 0).map(f => f.studentId)).size;
  const todo = R.filter(r => r.status === 'done' && !r.outNo).length;
  return `
  <section class="hero"><div class="between wrap"><div><span class="eyebrow">ระบบรับ–ส่งและตรวจสอบวุฒิการศึกษา</span><h1>Vethi Verify</h1><p>${esc(S.settings.school)} · ข้อมูล ณ ${fmtLong(todayISO())}</p></div>
  <div class="row"><button type="button" class="btn btn-pink" data-act="go" data-v="receive">📥 รับหนังสือใหม่</button><button type="button" class="btn btn-outline" data-act="mode" data-m="portal">🌐 หน้าหน่วยงานภายนอก</button></div></div></section>
  <div class="grid g4">${stat('หนังสือรับทั้งหมด', R.length, 'ฉบับ', 'var(--blue)')}${stat('รอดำเนินการ', pend, 'ฉบับ', 'var(--yellow)')}${stat('ส่งหนังสือตอบแล้ว', R.length - pend, 'ฉบับ', 'var(--green)')}${stat('ผู้สำเร็จในฐานข้อมูล', S.students.length.toLocaleString('th-TH'), 'ราย', 'var(--pink)')}</div>
  ${todo ? `<div class="notice ok">มีหนังสือที่ตรวจสอบเสร็จแล้ว ${todo} ฉบับ รอสร้างหนังสือตอบ <button type="button" class="btn btn-green sm" data-act="go" data-v="outgoing">ไปที่หนังสือส่งออก</button></div>` : ''}
  <div class="grid g-main">
    <div class="card"><div class="between"><h2>หนังสือล่าสุด</h2><button type="button" class="btn btn-outline sm" data-act="go" data-v="track">ดูทั้งหมด</button></div>${reqTable(R.slice().sort(byRecv).slice(0, 6), 'dash')}</div>
    <div class="stack">
      <div class="card"><h2>ผลการตรวจสอบรายบุคคล</h2><div class="bars">${['found', 'mismatch', 'notfound', 'pending'].map(k => bar(RESULT[k].t, cnt(k), max, k)).join('')}</div><p class="muted small" style="margin:0">รวม ${persons.length} ราย จาก ${R.length} หนังสือ</p></div>
      <div class="card stat" style="--accent:var(--red)"><span class="muted small">ค่าบำรุงการศึกษาค้างชำระ · เฉพาะเจ้าหน้าที่</span><div class="num">฿${money(totalOutstanding())}</div><div class="between"><span class="muted small">${debtors} ราย · ไม่แสดงต่อหน่วยงานภายนอก</span><button type="button" class="btn btn-outline sm" data-act="go" data-v="fees">จัดการ</button></div></div>
    </div>
  </div>`;
}

function vReceive() {
  const d = U.draft;
  const opt = v => ['', 'ม.3', 'ม.6'].map(o => `<option value="${o}" ${v === o ? 'selected' : ''}>${o || '–'}</option>`).join('');
  return `<div class="pagehead"><h1>📥 รับหนังสือขอตรวจสอบวุฒิ</h1><p class="muted">ลงทะเบียนรับหนังสือจากหน่วยงาน แล้วระบุรายชื่อผู้ที่ขอให้ตรวจสอบ</p></div>
  <form class="card form" data-form="receive" id="rc-form" novalidate>
    <div class="grid g3">
      <div><label for="rc-reg">เลขทะเบียนรับ</label><input id="rc-reg" value="${nextRegNo()}" readonly></div>
      <div><label for="rc-date">วันที่รับ</label><input id="rc-date" type="date" data-in="df" data-f="date" value="${esc(d.date)}"></div>
      <div><label for="rc-email">E-mail หน่วยงาน (ใช้รับ OTP)</label><input id="rc-email" type="email" data-in="df" data-f="email" value="${esc(d.email)}" placeholder="hr@company.co.th"></div>
      <div class="span2"><label for="rc-agency">หน่วยงานที่ขอตรวจสอบ</label><input id="rc-agency" data-in="df" data-f="agency" value="${esc(d.agency)}" placeholder="เช่น บริษัท ตัวอย่าง จำกัด"></div>
      <div><label for="rc-docno">เลขที่หนังสือของหน่วยงาน</label><input id="rc-docno" data-in="df" data-f="docno" value="${esc(d.docno)}" placeholder="เช่น ABC 123/2569"></div>
      <div class="span2"><label for="rc-to">เรียน (ผู้รับหนังสือตอบ)</label><input id="rc-to" data-in="df" data-f="to" value="${esc(d.to)}" placeholder="เช่น ผู้จัดการฝ่ายทรัพยากรบุคคล บริษัท ตัวอย่าง จำกัด"></div>
      <div><label for="rc-docdate">หนังสือลงวันที่</label><input id="rc-docdate" type="date" data-in="df" data-f="docdate" value="${esc(d.docdate)}"></div>
    </div>
    <div class="formsel" role="radiogroup" aria-label="รูปแบบหนังสือ">
      <label class="opt ${d.form == 1 ? 'on' : ''}"><input type="radio" name="rc-form" value="1" data-ch="dform" ${d.form == 1 ? 'checked' : ''}><b>📄 แบบที่ 1 แนบใบรายชื่อ</b><span>หน่วยงานแนบไฟล์หรือเอกสารรายชื่อมาพร้อมหนังสือ</span></label>
      <label class="opt ${d.form == 2 ? 'on' : ''}"><input type="radio" name="rc-form" value="2" data-ch="dform" ${d.form == 2 ? 'checked' : ''}><b>📄 แบบที่ 2 ระบุรายชื่อ</b><span>กรณีไม่แนบใบรายชื่อ รายชื่อระบุอยู่ในเนื้อหนังสือ</span></label>
    </div>
    ${d.form == 1 ? `<div class="attach"><label for="rc-file" style="margin:0">ใบรายชื่อที่แนบมา (CSV / Excel / PDF / รูปภาพ)</label><input type="file" id="rc-file" data-ch="dfile" accept=".csv,.txt,.xls,.xlsx,.pdf,image/*"><p class="muted small">${d.file ? '✅ แนบแล้ว: <b>' + esc(d.file) + '</b> · ' : ''}ไฟล์ CSV/Excel ระบบดึงรายชื่อลงตารางให้ ถ้าเป็น PDF หรือรูปภาพ ให้พิมพ์รายชื่อลงตารางด้านล่าง</p></div>` : ''}
    <div class="between"><h3>รายชื่อผู้ขอตรวจสอบ (${d.persons.length} ราย)</h3><button type="button" class="btn btn-outline sm" data-act="addp">+ เพิ่มรายชื่อ</button></div>
    <div class="tablewrap"><table class="edit"><thead><tr><th>#</th><th>เลขประจำตัวนักเรียนเดิม</th><th>ชื่อ</th><th>สกุล</th><th>วันเดือนปีที่จบ</th><th>ระดับชั้น</th><th></th></tr></thead><tbody>
    ${d.persons.map((p, i) => `<tr><td>${i + 1}</td>
      <td><input id="dp-${i}-sid" aria-label="เลขประจำตัว แถว ${i + 1}" data-in="dp" data-i="${i}" data-f="sid" value="${esc(p.sid)}" inputmode="numeric"></td>
      <td><input id="dp-${i}-fname" aria-label="ชื่อ แถว ${i + 1}" data-in="dp" data-i="${i}" data-f="fname" value="${esc(p.fname)}"></td>
      <td><input id="dp-${i}-lname" aria-label="สกุล แถว ${i + 1}" data-in="dp" data-i="${i}" data-f="lname" value="${esc(p.lname)}"></td>
      <td><input id="dp-${i}-grad" aria-label="วันที่จบ แถว ${i + 1}" data-in="dp" data-i="${i}" data-f="gradText" value="${esc(p.gradText)}" placeholder="31/03/2568"></td>
      <td><select id="dp-${i}-level" aria-label="ระดับชั้น แถว ${i + 1}" data-ch="dp" data-i="${i}" data-f="level">${opt(p.level)}</select></td>
      <td><button type="button" class="icon-btn" data-act="delp" data-i="${i}" aria-label="ลบแถว ${i + 1}">✕</button></td></tr>`).join('')}
    </tbody></table></div>
    <div class="row end"><button type="button" class="btn btn-outline" data-act="resetdraft">ล้างฟอร์ม</button><button class="btn btn-pink" type="submit">บันทึกรับหนังสือ</button></div>
  </form>
  <div class="card"><h2>ทะเบียนหนังสือรับ</h2>${reqTable(S.requests.slice().sort(byRecv), 'receive')}</div>`;
}

function quickResults() {
  const q = U.vq.trim();
  if (!q) return '';
  const qd = digits(q), qn = normName(q);
  const hits = S.students.filter(s => (qd.length >= 3 && (sidKey(s.sid).includes(sidKey(qd)) || s.cid.includes(qd))) || (qn && normName(fullName(s)).includes(qn))).slice(0, 8);
  if (!hits.length) return `<p class="muted small" style="margin:12px 0 0">ไม่พบ "${esc(q)}" ในฐานข้อมูลผู้สำเร็จการศึกษา</p>`;
  return `<div class="tablewrap" style="margin-top:12px"><table><thead><tr><th>รหัส</th><th>ชื่อ-สกุล</th><th>ระดับ</th><th>วันที่จบ</th><th>GPA</th><th>ค้างชำระ</th></tr></thead><tbody>
  ${hits.map(s => { const o = outstanding(s.id); return `<tr><td>${esc(s.sid)}</td><td>${esc(fullName(s))}</td><td>${esc(s.level)}</td><td>${fmtBE(s.gradDate)}</td><td>${esc(s.gpa || '-')}</td><td>${o > 0 ? `<span class="badge danger">฿${money(o)}</span>` : '<span class="badge ok">ไม่มี</span>'}</td></tr>`; }).join('')}</tbody></table></div>`;
}
function vVerify() {
  const opts = S.requests.slice().sort(byRecv).map(r => `<option value="${r.id}" ${r.id === U.reqId ? 'selected' : ''}>${esc(r.regNo)} · ${esc(r.agency)} (${r.persons.length} ราย · ${STATUS[r.status].t})</option>`).join('');
  const r = getReq(U.reqId);
  return `<div class="pagehead"><h1>🔍 ตรวจสอบและบันทึกผลรายบุคคล</h1><p class="muted">เทียบรายชื่อในหนังสือกับฐานข้อมูลผู้สำเร็จการศึกษา แล้วยืนยันผลทีละราย</p></div>
  <div class="card"><div class="grid g-2-1"><div><label for="vf-req">เลือกหนังสือที่จะตรวจสอบ</label><select id="vf-req" data-ch="vfreq"><option value="">— เลือกหนังสือ —</option>${opts}</select></div>
  <div><label for="vf-q">ค้นหาผู้สำเร็จการศึกษารายบุคคล</label><input id="vf-q" data-in="vfq" value="${esc(U.vq)}" placeholder="รหัส / เลขบัตร / ชื่อ-สกุล"></div></div><div id="vf-quick">${quickResults()}</div></div>
  ${r ? verifyPanel(r) : `<div class="card empty">เลือกหนังสือจากรายการด้านบนเพื่อเริ่มตรวจสอบ</div>`}`;
}
function verifyPanel(r) {
  const pend = r.persons.filter(p => p.result === 'pending').length;
  return `<div class="card"><div class="between wrap"><div><span class="eyebrow">เลขรับ ${esc(r.regNo)} · ${r.form == 1 ? 'แบบที่ 1 แนบใบรายชื่อ' : 'แบบที่ 2 ระบุรายชื่อ'}</span><h2 style="margin:4px 0">${esc(r.agency)}</h2><p class="muted small" style="margin:0">หนังสือที่ ${esc(r.docNo)} ลงวันที่ ${fmtLong(r.docDate)} · รับเมื่อ ${fmtLong(r.recvDate)}${r.file ? ' · ไฟล์แนบ ' + esc(r.file) : ''}</p></div>
  <div class="row">${statusBadge(r)}${r.status !== 'replied' ? `<button type="button" class="btn btn-blue" data-act="automatch" data-id="${r.id}">⚡ ตรวจอัตโนมัติ</button>` : ''}<button type="button" class="btn btn-green" data-act="letter" data-id="${r.id}" ${pend ? 'disabled' : ''}>📝 หนังสือตอบ</button></div></div>
  ${pend && r.status !== 'replied' ? `<p class="notice warn" style="margin-top:14px">ยังมี ${pend} รายที่รอผล กด "ตรวจอัตโนมัติ" แล้วตรวจทานผลก่อนสร้างหนังสือตอบ</p>` : ''}
  <div class="tablewrap" style="margin-top:14px"><table><thead><tr><th>#</th><th>ข้อมูลตามหนังสือ</th><th>ข้อมูลในฐานข้อมูลโรงเรียน</th><th>ค่าบำรุงค้างชำระ</th><th>ผลการตรวจสอบ</th><th>หมายเหตุ (แสดงในหนังสือตอบ)</th></tr></thead><tbody>
  ${r.persons.map((p, i) => {
    const s = getStu(p.matchedId), o = s ? outstanding(s.id) : 0;
    return `<tr><td>${i + 1}</td>
    <td><b>${esc(p.fname)} ${esc(p.lname)}</b><div class="sub">เลขประจำตัว ${esc(p.sid || '-')} · จบ ${p.gradDate ? fmtBE(p.gradDate) : esc(p.gradText || '-')} · ${esc(p.level || '-')}</div></td>
    <td>${s ? `<b>${esc(fullName(s))}</b><div class="sub">รหัส ${esc(s.sid)} · ${esc(s.level)} · จบ ${fmtBE(s.gradDate)}${s.gpa ? ' · GPA ' + esc(s.gpa) : ''}</div>` : '<span class="muted">—</span>'}${p.auto ? `<div class="small auto">${esc(p.auto)}</div>` : ''}</td>
    <td>${s ? (o > 0 ? `<span class="badge danger">฿${money(o)}</span>` : '<span class="badge ok">ไม่มี</span>') : '<span class="muted">—</span>'}</td>
    <td><select id="res-${p.id}" aria-label="ผลการตรวจสอบ ${esc(p.fname)}" class="res r-${p.result}" data-ch="res" data-r="${r.id}" data-i="${i}" ${r.status === 'replied' ? 'disabled' : ''}>${Object.entries(RESULT).map(([k, v]) => `<option value="${k}" ${p.result === k ? 'selected' : ''}>${v.t}</option>`).join('')}</select></td>
    <td><input id="note-${p.id}" aria-label="หมายเหตุ ${esc(p.fname)}" data-ch="note" data-r="${r.id}" data-i="${i}" value="${esc(p.note)}" placeholder="เช่น จบ ม.6 ภาคเรียนที่ 1" ${r.status === 'replied' ? 'disabled' : ''}></td></tr>`;
  }).join('')}
  </tbody></table></div><p class="muted small" style="margin:10px 0 0">🔒 คอลัมน์ค่าบำรุงค้างชำระแสดงเฉพาะเจ้าหน้าที่ ไม่ปรากฏในหนังสือตอบและหน้าหน่วยงานภายนอก</p></div>`;
}

function vOutgoing() {
  const R = S.requests.slice().sort(byRecv);
  const waitLetter = R.filter(r => r.status === 'done' && !r.outNo).length, waitSend = R.filter(r => r.outNo && r.status !== 'replied').length, sent = R.filter(r => r.status === 'replied').length;
  return `<div class="pagehead"><h1>📤 หนังสือส่งออกตรวจสอบวุฒิ</h1><p class="muted">สร้างหนังสือแจ้งผล ออกเลขหนังสือส่ง และบันทึกการส่งถึงหน่วยงาน</p></div>
  <div class="grid g3">${stat('รอสร้างหนังสือตอบ', waitLetter, 'ฉบับ', 'var(--yellow)')}${stat('ออกเลขแล้ว รอส่ง', waitSend, 'ฉบับ', 'var(--blue)')}${stat('ส่งแล้ว', sent, 'ฉบับ', 'var(--green)')}</div>
  <div class="card"><h2>ทะเบียนหนังสือส่ง</h2><div class="tablewrap"><table><thead><tr><th>เลขรับ</th><th>หน่วยงาน</th><th>สรุปผล</th><th>เลขหนังสือส่ง</th><th>วันที่ส่ง</th><th>สถานะ</th><th></th></tr></thead><tbody>
  ${R.map(r => { const pend = r.persons.some(p => p.result === 'pending'); return `<tr><td><b>${esc(r.regNo)}</b></td><td>${esc(r.agency)}<div class="sub">อ้างถึง ${esc(r.docNo)}</div></td><td>${resultSummary(r)}</td><td>${r.outNo ? esc(S.settings.docPrefix + r.outNo) : '<span class="muted">—</span>'}</td><td>${r.sentDate ? fmtBE(r.sentDate) : '<span class="muted">—</span>'}</td><td>${statusBadge(r)}</td>
  <td class="tdact">${pend ? `<button type="button" class="btn btn-outline sm" data-act="openverify" data-id="${r.id}">ตรวจให้ครบก่อน</button>` : `<button type="button" class="btn btn-outline sm" data-act="letter" data-id="${r.id}">📝 ${r.outNo ? 'ดูหนังสือ' : 'สร้างหนังสือ'}</button>`}${r.outNo && r.status !== 'replied' ? ` <button type="button" class="btn btn-green sm" data-act="sent" data-id="${r.id}">บันทึกส่งแล้ว</button>` : ''}</td></tr>`; }).join('')}
  </tbody></table></div></div>`;
}

function trackList() {
  const q = U.tq.trim().toLowerCase();
  const list = S.requests.slice().sort(byRecv).filter(r => !q || [r.regNo, r.docNo, r.agency, r.outNo].join(' ').toLowerCase().includes(q));
  if (!list.length) return `<p class="muted small">ไม่พบหนังสือที่ตรงกับคำค้น</p>`;
  return list.map(r => `<button type="button" class="titem ${r.id === U.trackId ? 'on' : ''}" data-act="trsel" data-id="${r.id}"><b>${esc(r.regNo)} · ${esc(r.agency)}</b><span class="sub">ที่ ${esc(r.docNo)}</span><span>${statusBadge(r)}</span></button>`).join('');
}
function trackDetail(r) {
  if (!r) return `<p class="muted">เลือกหนังสือจากรายการ</p>`;
  return `<span class="eyebrow">เลขรับ ${esc(r.regNo)}</span><h2 style="margin:4px 0">${esc(r.agency)}</h2><p class="muted small" style="margin:0">หนังสือที่ ${esc(r.docNo)} · E-mail ${esc(r.email)} · ${r.persons.length} ราย</p>
  ${stepper(r)}
  <div class="row" style="margin-bottom:14px"><button type="button" class="btn btn-outline sm" data-act="openverify" data-id="${r.id}">🔍 ผลการตรวจสอบ</button>${r.persons.every(p => p.result !== 'pending') ? `<button type="button" class="btn btn-outline sm" data-act="letter" data-id="${r.id}">📝 หนังสือตอบ</button>` : ''}</div>
  <h3 style="margin-bottom:10px">ประวัติการดำเนินการ</h3>
  <ul class="timeline">${r.timeline.slice().sort((a, b) => b.t - a.t).map(e => `<li class="${e.pub ? '' : 'priv'}"><time>${fmtDT(e.t)}</time>${esc(e.text)}${e.pub ? '' : ' <span class="badge info">🔒 ภายใน</span>'}</li>`).join('')}</ul>`;
}
function vTrack() {
  if (!getReq(U.trackId)) U.trackId = (S.requests.slice().sort(byRecv)[0] || {}).id || null;
  return `<div class="pagehead"><h1>🧭 ติดตามสถานะหนังสือ</h1><p class="muted">ดูขั้นตอนและประวัติการดำเนินการของหนังสือแต่ละฉบับ รายการที่มี 🔒 ไม่แสดงต่อหน่วยงานภายนอก</p></div>
  <div class="grid g-1-2"><div class="card"><label for="tr-q">ค้นหาหนังสือ</label><input id="tr-q" data-in="trq" value="${esc(U.tq)}" placeholder="เลขรับ / เลขที่หนังสือ / หน่วยงาน"><div class="tlist" id="tr-list">${trackList()}</div></div>
  <div class="card" id="tr-detail">${trackDetail(getReq(U.trackId))}</div></div>`;
}

function gradsTable() {
  const q = U.gq.trim(), qd = digits(q), qn = normName(q);
  const list = S.students.filter(s => (!U.glevel || s.level === U.glevel) && (!q || (qd.length >= 2 && (sidKey(s.sid).includes(sidKey(qd)) || s.cid.includes(qd))) || (qn && normName(fullName(s)).includes(qn))))
    .sort((a, b) => (b.gradDate || '').localeCompare(a.gradDate || '') || a.sid.localeCompare(b.sid));
  const shown = list.slice(0, 300);
  return `<p class="muted small">แสดง ${shown.length.toLocaleString('th-TH')} จาก ${list.length.toLocaleString('th-TH')} ราย${list.length > 300 ? ' (พิมพ์ค้นหาเพื่อกรอง)' : ''}</p>
  <div class="tablewrap"><table><thead><tr><th>รหัสประจำตัว</th><th>เลขบัตรประชาชน</th><th>ชื่อ-สกุล</th><th>ระดับชั้น</th><th>วันที่จบ</th><th>GPA</th><th>ค้างชำระ</th><th></th></tr></thead><tbody>
  ${shown.map(s => { const o = outstanding(s.id); return `<tr><td><b>${esc(s.sid || '-')}</b></td><td>${esc(maskCid(s.cid))}</td><td>${esc(fullName(s))}${s.father || s.mother ? `<div class="sub">${s.father ? 'บิดา ' + esc(s.father) : ''}${s.father && s.mother ? ' · ' : ''}${s.mother ? 'มารดา ' + esc(s.mother) : ''}</div>` : ''}</td><td>${esc(s.level)}</td><td>${fmtBE(s.gradDate)}</td><td>${esc(s.gpa || '-')}</td><td>${o > 0 ? `<span class="badge danger">฿${money(o)}</span>` : '<span class="muted">—</span>'}</td>
  <td><button type="button" class="btn btn-outline sm" data-act="delstu" data-id="${s.id}">ลบ</button></td></tr>`; }).join('') || `<tr><td colspan="8" class="muted">ไม่พบข้อมูล</td></tr>`}
  </tbody></table></div>`;
}
function vGrads() {
  const lv = ['', 'ม.3', 'ม.6'];
  return `<div class="pagehead"><h1>🎓 ฐานข้อมูลผู้สำเร็จการศึกษา</h1><p class="muted">ข้อมูลอ้างอิงสำหรับตรวจสอบวุฒิ นำเข้าจากไฟล์ ปพ.3 ต้นฉบับ หรือไฟล์ CSV แบบย่อ</p></div>
  <div class="grid g2">
    <div class="card"><h2>นำเข้าจากไฟล์ ปพ.3</h2><p class="muted small" style="margin-top:-6px">รองรับ .xls / .xlsx ต้นฉบับ อ่านทุกหน้าในไฟล์เดียว ดึงรหัสประจำตัว เลขบัตรประชาชน ชื่อ-สกุล วันเกิด ชื่อบิดา-มารดา GPA และวันที่อนุมัติจบจากท้ายเอกสาร</p>
      <div class="stack"><div><label for="gd-pp3">ไฟล์ ปพ.3</label><input type="file" id="gd-pp3" accept=".xls,.xlsx" data-ch="pp3file"></div>
      <div class="grid g2"><div><label for="gd-level">ระดับชั้นที่จบ</label><select id="gd-level"><option value="">— เลือก —</option><option>ม.3</option><option>ม.6</option></select></div>
      <div><label for="gd-date">วันที่จบ (ใช้เมื่อไม่พบในไฟล์)</label><input id="gd-date" placeholder="31/03/2569"></div></div>
      <button type="button" class="btn btn-pink" data-act="pp3">นำเข้าจากไฟล์ ปพ.3</button><div id="gd-msg">${U.lastImport}</div></div></div>
    <div class="card"><h2>นำเข้าจาก CSV</h2><p class="muted small" style="margin-top:-6px">คอลัมน์: รหัสประจำตัว, ชื่อ-สกุล, ระดับชั้นที่จบ, วันที่จบ (เพิ่มคอลัมน์ เลขบัตรประชาชน / GPA ได้)</p>
      <div class="stack"><div><label for="gd-csv">ไฟล์ CSV</label><input type="file" id="gd-csv" accept=".csv,.txt" data-ch="csvfile"></div>
      <div><label for="gd-csvtext">หรือวางข้อความ CSV</label><textarea id="gd-csvtext" rows="4" placeholder="รหัสประจำตัว,ชื่อ-สกุล,ระดับชั้นที่จบ,วันที่จบ&#10;10301,นางสาวตัวอย่าง ใจดี,ม.6,31/03/2569"></textarea></div>
      <button type="button" class="btn btn-blue" data-act="csvimp">นำเข้า CSV</button></div></div>
  </div>
  <div class="card"><div class="between wrap"><h2 style="margin:0">รายชื่อผู้สำเร็จการศึกษา</h2><div class="row"><input id="gd-q" data-in="gdq" value="${esc(U.gq)}" placeholder="ค้นหา รหัส / เลขบัตร / ชื่อ" style="width:220px"><select id="gd-flevel" data-ch="gdlevel" aria-label="กรองระดับชั้น" style="width:auto">${lv.map(o => `<option value="${o}" ${U.glevel === o ? 'selected' : ''}>${o || 'ทุกระดับ'}</option>`).join('')}</select><button type="button" class="btn btn-outline sm" data-act="toggleadd">${U.showAdd ? 'ปิดฟอร์ม' : '+ เพิ่มรายบุคคล'}</button></div></div>
  <form class="addform" data-form="addstu" ${U.showAdd ? '' : 'hidden'} novalidate>
    <div><label for="as-sid">รหัสประจำตัว</label><input id="as-sid" required></div>
    <div><label for="as-cid">เลขบัตรประชาชน</label><input id="as-cid" inputmode="numeric"></div>
    <div class="span2"><label for="as-name">ชื่อ-สกุล (มีคำนำหน้า)</label><input id="as-name" required placeholder="นางสาวตัวอย่าง ใจดี"></div>
    <div><label for="as-level">ระดับชั้น</label><select id="as-level"><option>ม.6</option><option>ม.3</option></select></div>
    <div><label for="as-date">วันที่จบ</label><input id="as-date" placeholder="31/03/2569"></div>
    <div><label for="as-gpa">GPA</label><input id="as-gpa" inputmode="decimal"></div>
    <div><button class="btn btn-pink" type="submit">เพิ่ม</button></div>
  </form>
  <div id="gd-table" style="margin-top:12px">${gradsTable()}</div></div>`;
}

function feesTable() {
  const q = U.fq.trim(), qn = normName(q), qd = digits(q);
  const list = S.fees.map(f => ({ f, s: getStu(f.studentId) })).filter(x => x.s && (!U.fOnly || x.f.amount - x.f.paid > 0) && (!q || (qd.length >= 2 && sidKey(x.s.sid).includes(sidKey(qd))) || (qn && normName(fullName(x.s)).includes(qn))));
  return `<div class="tablewrap"><table><thead><tr><th>รหัส</th><th>ชื่อ-สกุล</th><th>ภาค/ปีการศึกษา</th><th>รายการ</th><th class="num">จำนวนเงิน</th><th class="num">ชำระแล้ว</th><th class="num">ค้างชำระ</th><th>สถานะ</th><th></th></tr></thead><tbody>
  ${list.map(({ f, s }) => { const o = Math.max(0, f.amount - f.paid); return `<tr><td>${esc(s.sid)}</td><td>${esc(fullName(s))}</td><td>${esc(f.term)}</td><td>${esc(f.item)}</td><td class="num">${money(f.amount)}</td><td class="num">${money(f.paid)}</td><td class="num"><b>${money(o)}</b></td><td>${o > 0 ? '<span class="badge danger">ค้างชำระ</span>' : '<span class="badge ok">ชำระครบ</span>'}</td>
  <td class="tdact">${o > 0 ? `<button type="button" class="btn btn-green sm" data-act="payfull" data-id="${f.id}">รับชำระครบ</button> ` : ''}<button type="button" class="btn btn-outline sm" data-act="delfee" data-id="${f.id}">ลบ</button></td></tr>`; }).join('') || `<tr><td colspan="9" class="muted">ไม่มีรายการ</td></tr>`}
  </tbody></table></div>`;
}
function vFees() {
  const debtors = new Set(S.fees.filter(f => f.amount - f.paid > 0).map(f => f.studentId)).size;
  return `<div class="pagehead"><h1>💳 ค่าบำรุงการศึกษา</h1><p class="muted">บันทึกรายการค่าบำรุงและยอดค้างชำระรายรายการ ใช้ประกอบการพิจารณาภายในเท่านั้น</p></div>
  <p class="notice info" style="margin:0">🔒 ข้อมูลหน้านี้แสดงเฉพาะเจ้าหน้าที่ ไม่แสดงในหน้าหน่วยงานภายนอกและไม่ปรากฏในหนังสือตอบ</p>
  <div class="grid g3">${stat('ยอดค้างชำระรวม', '฿' + money(totalOutstanding()), '', 'var(--red)')}${stat('นักเรียนที่มียอดค้าง', debtors, 'ราย', 'var(--yellow)')}${stat('รายการทั้งหมด', S.fees.length, 'รายการ', 'var(--blue)')}</div>
  <div class="card"><h2>บันทึกรายการ</h2><form class="addform" style="margin:0" data-form="addfee" novalidate>
    <div class="span2"><label for="fe-stu">นักเรียน (พิมพ์รหัสหรือชื่อ)</label><input id="fe-stu" list="fe-list" required placeholder="เช่น 10245"><datalist id="fe-list">${S.students.slice(0, 2000).map(s => `<option value="${esc(s.sid)} ${esc(fullName(s))}"></option>`).join('')}</datalist></div>
    <div><label for="fe-term">ภาค/ปีการศึกษา</label><input id="fe-term" value="2/2568"></div>
    <div><label for="fe-item">รายการ</label><input id="fe-item" value="ค่าบำรุงการศึกษา"></div>
    <div><label for="fe-amt">จำนวนเงิน (บาท)</label><input id="fe-amt" inputmode="decimal" value="3500"></div>
    <div><label for="fe-paid">ชำระแล้ว (บาท)</label><input id="fe-paid" inputmode="decimal" value="0"></div>
    <div><button class="btn btn-pink" type="submit">บันทึก</button></div>
  </form></div>
  <div class="card"><div class="between wrap"><h2 style="margin:0">รายการค่าบำรุง</h2><div class="row"><input id="fe-q" data-in="feq" value="${esc(U.fq)}" placeholder="ค้นหา รหัส / ชื่อ" style="width:200px"><label class="row" style="margin:0;gap:8px;font-weight:600"><span class="switch"><input type="checkbox" id="fe-only" data-ch="feonly" ${U.fOnly ? 'checked' : ''}><span class="slider"></span></span>เฉพาะที่ค้างชำระ</label></div></div>
  <div id="fe-table" style="margin-top:12px">${feesTable()}</div></div>`;
}

function vReports() {
  const R = S.requests, persons = R.flatMap(r => r.persons), cnt = k => persons.filter(p => p.result === k).length;
  const now = new Date(), months = [];
  for (let i = 5; i >= 0; i--) { const d = new Date(now.getFullYear(), now.getMonth() - i, 1); months.push({ key: d.getFullYear() + '-' + pad(d.getMonth() + 1), label: TH_MS[d.getMonth()] + ' ' + String(d.getFullYear() + 543).slice(2) }); }
  months.forEach(m => { m.n = R.filter(r => (r.recvDate || '').startsWith(m.key)).length; });
  const mmax = Math.max(1, ...months.map(m => m.n));
  const agencies = {}; R.forEach(r => { agencies[r.agency] = agencies[r.agency] || { n: 0, p: 0 }; agencies[r.agency].n++; agencies[r.agency].p += r.persons.length; });
  const doneR = R.filter(r => r.sentDate && r.recvDate);
  const avg = doneR.length ? (doneR.reduce((a, r) => a + (new Date(r.sentDate) - new Date(r.recvDate)) / 864e5, 0) / doneR.length).toFixed(1) : '-';
  const debt = S.students.map(s => ({ s, o: outstanding(s.id) })).filter(x => x.o > 0).sort((a, b) => b.o - a.o);
  const pmax = Math.max(1, persons.length);
  return `<div class="pagehead between wrap"><div><h1>📈 รายงาน</h1><p class="muted">สรุปงานรับ–ส่งและผลการตรวจสอบวุฒิ ปีการศึกษาปัจจุบัน</p></div><button type="button" class="btn btn-outline" data-act="copycsv">คัดลอกรายงานเป็น CSV</button></div>
  <div class="grid g4">${stat('หนังสือรับ', R.length, 'ฉบับ', 'var(--blue)')}${stat('บุคคลที่ขอตรวจ', persons.length, 'ราย', 'var(--pink)')}${stat('ยืนยันสำเร็จการศึกษา', cnt('found'), 'ราย', 'var(--green)')}${stat('เวลาดำเนินการเฉลี่ย', avg, 'วัน', 'var(--yellow)')}</div>
  <div class="grid g2">
    <div class="card"><h2>หนังสือรับรายเดือน (6 เดือนล่าสุด)</h2><div class="bars">${months.map(m => `<div class="barrow"><span>${m.label}</span><div class="bartrack"><div class="barfill" style="width:${(m.n / mmax) * 100}%"></div></div><b>${m.n}</b></div>`).join('')}</div></div>
    <div class="card"><h2>ผลการตรวจสอบรายบุคคล</h2><div class="bars">${['found', 'mismatch', 'notfound', 'pending'].map(k => bar(RESULT[k].t, cnt(k), pmax, k)).join('')}</div></div>
  </div>
  <div class="grid g2">
    <div class="card"><h2>หน่วยงานที่ขอตรวจสอบ</h2><div class="tablewrap"><table style="min-width:0"><thead><tr><th>หน่วยงาน</th><th class="num">หนังสือ</th><th class="num">ราย</th></tr></thead><tbody>${Object.entries(agencies).sort((a, b) => b[1].p - a[1].p).map(([a, v]) => `<tr><td>${esc(a)}</td><td class="num">${v.n}</td><td class="num">${v.p}</td></tr>`).join('')}</tbody></table></div></div>
    <div class="card"><h2>ยอดค้างชำระรายบุคคล 🔒</h2><div class="tablewrap"><table style="min-width:0"><thead><tr><th>รหัส</th><th>ชื่อ-สกุล</th><th class="num">ค้างชำระ</th></tr></thead><tbody>${debt.map(x => `<tr><td>${esc(x.s.sid)}</td><td>${esc(fullName(x.s))}</td><td class="num">${money(x.o)}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">ไม่มียอดค้าง</td></tr>'}</tbody></table></div></div>
  </div>`;
}

function vSettings() {
  const st = S.settings;
  const f = (id, label, v, ph = '') => `<div><label for="st-${id}">${label}</label><input id="st-${id}" value="${esc(v)}" placeholder="${esc(ph)}"></div>`;
  return `<div class="pagehead"><h1>⚙️ ตั้งค่า</h1><p class="muted">ข้อมูลโรงเรียนที่ใช้ในหนังสือราชการ และการจัดการข้อมูลตัวอย่าง</p></div>
  <form class="card form" data-form="settings" novalidate><h2 style="margin:0">ข้อมูลในหนังสือตอบ</h2>
  <div class="grid g2">${f('school', 'ชื่อโรงเรียน', st.school)}${f('address', 'ที่อยู่ (หัวหนังสือ)', st.address, 'เลขที่ ถนน ตำบล อำเภอ จังหวัด รหัสไปรษณีย์')}
  ${f('docPrefix', 'รหัสหนังสือออก (นำหน้าเลขหนังสือ)', st.docPrefix, 'ศธ 04xxx.xx/')}${f('office', 'ส่วนราชการเจ้าของเรื่อง (ท้ายหนังสือ)', st.office)}
  ${f('director', 'ชื่อผู้ลงนาม', st.director, 'นาย/นาง/นางสาว ...')}${f('directorTitle', 'ตำแหน่งผู้ลงนาม', st.directorTitle)}
  ${f('phone', 'โทรศัพท์', st.phone)}${f('email', 'E-mail งานทะเบียน', st.email)}
  <div><label for="st-nextReg">เลขทะเบียนรับถัดไป</label><input id="st-nextReg" inputmode="numeric" value="${st.nextReg}"></div><div><label for="st-nextOut">เลขหนังสือส่งถัดไป</label><input id="st-nextOut" inputmode="numeric" value="${st.nextOut}"></div></div>
  <div class="row end"><button class="btn btn-pink" type="submit">บันทึกการตั้งค่า</button></div></form>
  <div class="card"><h2>💾 ข้อมูล Demo ในเบราว์เซอร์</h2><p class="muted" style="margin-top:0">${storageOK ? 'ข้อมูลทั้งหมดบันทึกไว้ในเบราว์เซอร์เครื่องนี้ (localStorage) เปิดครั้งหน้าข้อมูลยังอยู่ แต่ไม่ซิงก์ไปเครื่องอื่น' : 'เบราว์เซอร์นี้ไม่อนุญาตให้บันทึกข้อมูล ข้อมูลจะหายเมื่อปิดหน้า'} · ผู้สำเร็จการศึกษา ${S.students.length.toLocaleString('th-TH')} ราย · หนังสือ ${S.requests.length} ฉบับ</p>
  <div class="row"><button type="button" class="btn btn-outline" data-act="resetdemo">โหลดข้อมูลตัวอย่างใหม่</button><button type="button" class="btn btn-outline" data-act="clearall">ล้างข้อมูลทั้งหมด</button></div></div>`;
}

/* ---------- หน้าหน่วยงานภายนอก ---------- */
function vPortal() {
  const P = U.portal, st = ['กรอกข้อมูล', 'ยืนยัน OTP', 'ดูสถานะ/ผลตรวจ'], idx = { form: 0, otp: 1, view: 2 }[P.step];
  const steps = `<div class="mini-steps">${st.map((s, i) => `<span class="${i === idx ? 'on' : ''}">${i + 1}. ${s}</span>`).join('')}</div>`;
  let body = '';
  if (P.step === 'form') {
    const demo = S.requests.find(r => r.status === 'replied') || S.requests[0];
    body = `<div class="grid g-main"><form class="card form" data-form="portal" novalidate>${steps}<h2 style="margin:0">ขอรหัส OTP เพื่อดูสถานะหนังสือ</h2>
      <div><label for="pt-doc">เลขที่หนังสือของหน่วยงาน</label><input id="pt-doc" value="${esc(P.doc || '')}" placeholder="เลขที่หนังสือที่ส่งมายังโรงเรียน" autocomplete="off"></div>
      <div><label for="pt-email">E-mail ที่ระบุในหนังสือ</label><input id="pt-email" type="email" value="${esc(P.email || '')}" placeholder="name@company.co.th"></div>
      ${P.err ? `<p class="notice danger">${esc(P.err)}</p>` : ''}
      <button class="btn btn-pink" type="submit">ขอรหัส OTP</button>
      ${demo ? `<div class="hint"><span>ข้อมูลทดลอง: ${esc(demo.docNo)} · ${esc(demo.email)}</span><button type="button" class="btn btn-outline sm" data-act="ptdemo" data-id="${demo.id}">กรอกให้</button></div>` : ''}</form>
      <div class="card stack"><h3>เกี่ยวกับการตรวจสอบสถานะ</h3><p class="muted small" style="margin:0">ระบบส่งรหัส OTP 6 หลักไปยัง E-mail ที่หน่วยงานระบุไว้ในหนังสือ รหัสใช้ได้ 5 นาทีและใช้ได้ครั้งเดียว ทุกครั้งที่เข้าตรวจสอบต้องขอรหัสใหม่</p><p class="muted small" style="margin:0">หน้านี้แสดงเฉพาะสถานะหนังสือและผลการตรวจสอบวุฒิการศึกษาเท่านั้น</p></div></div>`;
  } else if (P.step === 'otp') {
    const o = U.otp, r = o && getReq(o.reqId);
    body = `<div class="grid g2"><form class="card form" data-form="otp" novalidate>${steps}<h2 style="margin:0">กรอกรหัส OTP</h2><p class="muted small" style="margin:0">ส่งรหัสไปที่ <b>${esc(P.email)}</b> แล้ว · หมดอายุใน <b id="pt-count">5:00</b></p>
      <div><label for="pt-otp">รหัส OTP 6 หลัก</label><input id="pt-otp" class="otp-input" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="••••••"></div>
      ${P.err ? `<p class="notice danger">${esc(P.err)}</p>` : ''}
      <div class="row"><button class="btn btn-pink" type="submit">ยืนยัน</button><button type="button" class="btn btn-outline" data-act="ptresend">ขอรหัสใหม่</button><button type="button" class="btn btn-outline" data-act="ptlogout">ยกเลิก</button></div></form>
      <div class="card mailbox"><span class="eyebrow">กล่องอีเมลจำลอง (Demo)</span><div class="mailhead" style="margin-top:8px">ถึง: ${esc(P.email)}<br>เรื่อง: รหัส OTP ตรวจสอบสถานะหนังสือ ${esc(r ? r.docNo : '')}</div>
      <p style="margin:0">รหัส OTP ของท่านคือ</p><div class="code">${o ? o.code : '------'}</div><p class="muted small" style="margin:0">ใช้ได้ภายใน 5 นาที และใช้ได้ครั้งเดียว<br>${esc(S.settings.school)}</p>
      <p class="notice warn small" style="margin:12px 0 0">ในระบบจริง รหัสนี้ส่งเข้าอีเมลของหน่วยงานผ่านเซิร์ฟเวอร์ ไม่แสดงบนหน้าเว็บ</p></div></div>`;
  } else {
    const r = getReq(P.reqId);
    const ready = r && (r.status === 'done' || r.status === 'replied');
    body = !r ? '' : `<div class="card">${steps}<div class="between wrap"><div><span class="eyebrow">หนังสือที่ ${esc(r.docNo)}</span><h2 style="margin:4px 0">${esc(r.agency)}</h2><p class="muted small" style="margin:0">โรงเรียนรับหนังสือเมื่อ ${fmtLong(r.recvDate)} · เลขทะเบียนรับ ${esc(r.regNo)}${r.outNo ? ` · หนังสือตอบที่ ${esc(S.settings.docPrefix + r.outNo)}` : ''}</p></div><div class="row">${statusBadge(r)}<button type="button" class="btn btn-dark sm" data-act="ptlogout">ออกจากระบบ</button></div></div>
      ${stepper(r)}</div>
      <div class="grid g-main"><div class="card"><h2>ผลการตรวจสอบวุฒิการศึกษา</h2>${ready ? `<div class="tablewrap"><table style="min-width:0"><thead><tr><th>#</th><th>ชื่อ-สกุล</th><th>ผลการตรวจสอบ</th></tr></thead><tbody>${r.persons.map((p, i) => `<tr><td>${i + 1}</td><td>${esc(p.fname)} ${esc(p.lname)}</td><td>${resultBadge(p.result)}${p.note ? `<div class="sub">${esc(p.note)}</div>` : ''}</td></tr>`).join('')}</tbody></table></div>` : `<p class="notice warn" style="margin:0">อยู่ระหว่างตรวจสอบ ${r.persons.length} ราย ผลจะแสดงเมื่อตรวจสอบครบทุกราย</p>`}</div>
      <div class="card"><h2>ความคืบหน้า</h2><ul class="timeline">${r.timeline.filter(e => e.pub).sort((a, b) => b.t - a.t).map(e => `<li><time>${fmtDT(e.t)}</time>${esc(e.text)}</li>`).join('')}</ul></div></div>
      <p class="muted small" style="text-align:center;margin:0">การเข้าดูครั้งนี้สิ้นสุดเมื่อออกจากระบบหรือปิดหน้า การเข้าครั้งถัดไปต้องขอรหัส OTP ใหม่</p>`;
  }
  return `<div class="portal"><section class="hero"><span class="eyebrow">🌐 สำหรับหน่วยงานภายนอก</span><h1>ตรวจสอบสถานะหนังสือขอตรวจสอบวุฒิ</h1><p>${esc(S.settings.school)}</p></section>${body}</div>`;
}
function issueOTP(reqId) {
  const a = new Uint32Array(1);
  (window.crypto || window.msCrypto).getRandomValues(a);
  U.otp = { code: String(a[0] % 1000000).padStart(6, '0'), exp: Date.now() + OTP_TTL, reqId, tries: 0 };
  const r = getReq(reqId); if (r) { addTL(r, `หน่วยงานขอรหัส OTP (${U.portal.email})`, false); save(); }
}
let otpTimer = null;
function tickOTP() {
  const el = $('#pt-count');
  if (!el || !U.otp) { clearInterval(otpTimer); otpTimer = null; return; }
  const left = Math.max(0, U.otp.exp - Date.now());
  el.textContent = left ? `${Math.floor(left / 60000)}:${pad(Math.floor(left / 1000) % 60)}` : 'หมดอายุแล้ว';
}

/* ---------- หนังสือราชการ ---------- */
function letterHTML(r) {
  const st = S.settings, date = r.outDate || todayISO(), n = r.persons.length;
  const rows = r.persons.map((p, i) => {
    const s = getStu(p.matchedId), useS = s && p.result !== 'notfound';
    const gd = useS && s.gradDate ? s.gradDate : p.gradDate;
    return `<tr><td class="c">${i + 1}</td><td>${esc(p.fname + ' ' + p.lname)}</td><td class="c">${esc((useS ? s.sid : p.sid) || '-')}</td><td class="c">${esc((useS ? s.level : p.level) || '-')}</td><td class="c">${gd ? fmtLong(gd) : '-'}</td><td>${LETTER_RESULT[p.result]}${p.note ? ` (${esc(p.note)})` : ''}</td></tr>`;
  }).join('');
  const addr = [st.school, ...String(st.address || '').split('\n')].filter(Boolean).map(esc).join('<br>');
  return `${r.outNo ? '' : '<div class="draftmark">ร่าง</div>'}
  <div class="garuda" aria-hidden="true">พื้นที่ตราครุฑ</div>
  <div class="lt-head"><div>ที่ ${esc(st.docPrefix)}${esc(r.outNo || '..........')}</div><div class="lt-addr">${addr}</div></div>
  <div class="lt-date">${fmtLong(date)}</div>
  <p class="lt-f"><span>เรื่อง</span>แจ้งผลการตรวจสอบวุฒิการศึกษา</p>
  <p class="lt-f"><span>เรียน</span>${esc(r.to || r.agency)}</p>
  <p class="lt-f"><span>อ้างถึง</span>หนังสือ${esc(r.agency)} ที่ ${esc(r.docNo)} ลงวันที่ ${fmtLong(r.docDate)}</p>
  ${r.form == 1 ? `<p class="lt-f"><span>สิ่งที่ส่งมาด้วย</span>สำเนาใบรายชื่อที่ผ่านการตรวจสอบแล้ว จำนวน 1 ชุด</p>` : ''}
  <p class="lt-p">ตามหนังสือที่อ้างถึง ${esc(r.agency)} ขอให้โรงเรียนตรวจสอบวุฒิการศึกษาของบุคคล จำนวน ${n} ราย ${r.form == 1 ? 'ตามใบรายชื่อที่แนบมาพร้อมหนังสือ' : 'ตามรายชื่อที่ระบุในหนังสือ'} ความละเอียดแจ้งแล้ว นั้น</p>
  <p class="lt-p">${esc(st.school)} ได้ตรวจสอบกับหลักฐานทางการศึกษาของโรงเรียนแล้ว ปรากฏผลดังนี้</p>
  <table class="lt-table"><thead><tr><th>ที่</th><th class="w-name">ชื่อ-สกุล</th><th>เลขประจำตัวนักเรียน</th><th>ระดับชั้น</th><th>วันที่สำเร็จการศึกษา</th><th class="w-res">ผลการตรวจสอบ</th></tr></thead><tbody>${rows}</tbody></table>
  <p class="lt-p">จึงเรียนมาเพื่อโปรดทราบ</p>
  <div class="lt-sign"><p>ขอแสดงความนับถือ</p><div class="sp"></div><p>(${esc(st.director || '..................................................')})</p><p>${esc(st.directorTitle)}</p></div>
  <div class="lt-foot">${esc(st.office)}${st.phone ? '<br>โทร. ' + esc(st.phone) : ''}${st.email ? '<br>E-mail ' + esc(st.email) : ''}</div>`;
}
function renderModal() {
  const m = $('#modal'), r = getReq(U.letterId);
  if (!r) { m.hidden = true; m.innerHTML = ''; document.body.style.overflow = ''; return; }
  m.hidden = false; document.body.style.overflow = 'hidden';
  m.innerHTML = `<div class="modal-bar"><div><b>หนังสือแจ้งผลการตรวจสอบวุฒิ</b> <span class="muted small">· ${esc(r.agency)} · ${statusBadge(r)}</span></div>
  <div class="row">${!r.outNo ? `<button type="button" class="btn btn-yellow sm" data-act="issue" data-id="${r.id}">ออกเลขหนังสือส่ง</button>` : ''}${r.outNo && r.status !== 'replied' ? `<button type="button" class="btn btn-green sm" data-act="sent" data-id="${r.id}">บันทึกส่งแล้ว</button>` : ''}${canPrint ? `<button type="button" class="btn btn-pink sm" data-act="print">🖨️ พิมพ์ / บันทึก PDF</button>` : ''}<button type="button" class="btn btn-outline sm" data-act="copyletter">คัดลอกข้อความ</button><button type="button" class="btn btn-dark sm" data-act="closemodal">ปิด</button></div></div>
  ${!canPrint ? `<p class="notice info modal-note">หน้าตัวอย่างออนไลน์นี้สั่งพิมพ์ไม่ได้ ให้เปิดไฟล์ index.html จากชุดดาวน์โหลดในเบราว์เซอร์ แล้วกด "พิมพ์ / บันทึก PDF" จะได้หนังสือขนาด A4</p>` : ''}
  <div class="paperwrap"><article class="letter" id="letter">${letterHTML(r)}</article></div>`;
}
function issueNumber(r) {
  if (r.outNo) return;
  r.outNo = `${S.settings.nextOut}/${beYear()}`; S.settings.nextOut++;
  r.outDate = todayISO();
  addTL(r, `ออกเลขหนังสือส่ง ที่ ${r.outNo}`, true);
}

/* ---------- เรนเดอร์ ---------- */
const VIEW_FN = { dash: vDash, receive: vReceive, outgoing: vOutgoing, verify: vVerify, grads: vGrads, fees: vFees, track: vTrack, reports: vReports, settings: vSettings };
function render() {
  $('#modeSeg').innerHTML = `<button type="button" class="${U.mode === 'staff' ? 'on' : ''}" data-act="mode" data-m="staff">เจ้าหน้าที่</button><button type="button" class="${U.mode === 'portal' ? 'on' : ''}" data-act="mode" data-m="portal">หน่วยงานภายนอก</button>`;
  $('#brandSchool').textContent = S.settings.school;
  const nav = $('#nav');
  nav.hidden = U.mode !== 'staff';
  nav.innerHTML = VIEWS.map(([k, t]) => `<button type="button" class="${U.view === k ? 'on' : ''}" data-act="go" data-v="${k}">${t}</button>`).join('');
  $('#app').innerHTML = U.mode === 'portal' ? vPortal() : VIEW_FN[U.view]();
  if (U.mode === 'portal' && U.portal.step === 'otp') { tickOTP(); if (!otpTimer) otpTimer = setInterval(tickOTP, 1000); }
  renderModal();
}
function go(view) { U.view = view; U.mode = 'staff'; render(); window.scrollTo(0, 0); }

let toastT = null;
function toast(msg, kind) {
  const t = $('#toast'); t.textContent = msg; t.className = 'toast' + (kind === 'err' ? ' err' : ''); t.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 3200);
}
/* ยืนยันสองจังหวะ (หน้านี้ใช้ confirm() ไม่ได้) */
function armed(btn, label) {
  if (btn.dataset.armed) return true;
  const old = btn.textContent; btn.dataset.armed = '1'; btn.textContent = label || 'กดอีกครั้งเพื่อยืนยัน';
  setTimeout(() => { if (btn.isConnected) { delete btn.dataset.armed; btn.textContent = old; } }, 3000);
  return false;
}
async function copyText(text, okMsg) {
  try { await navigator.clipboard.writeText(text); toast(okMsg || 'คัดลอกแล้ว'); }
  catch (e) {
    const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch (er) { ok = false; }
    ta.remove(); toast(ok ? (okMsg || 'คัดลอกแล้ว') : 'คัดลอกอัตโนมัติไม่ได้ ให้เลือกข้อความแล้วกด Ctrl+C', ok ? '' : 'err');
  }
}

/* ---------- การกระทำ ---------- */
const ACT = {
  go: b => go(b.dataset.v),
  mode: b => { U.mode = b.dataset.m; U.portal = { step: 'form' }; U.otp = null; U.letterId = null; render(); window.scrollTo(0, 0); },
  openverify: b => { U.reqId = b.dataset.id; U.letterId = null; go('verify'); },
  opentrack: b => { U.trackId = b.dataset.id; go('track'); },
  trsel: b => { U.trackId = b.dataset.id; $('#tr-list').innerHTML = trackList(); $('#tr-detail').innerHTML = trackDetail(getReq(U.trackId)); },
  addp: () => { U.draft.persons.push(blankP()); render(); $(`#dp-${U.draft.persons.length - 1}-sid`)?.focus(); },
  delp: b => { U.draft.persons.splice(+b.dataset.i, 1); if (!U.draft.persons.length) U.draft.persons.push(blankP()); render(); },
  resetdraft: () => { U.draft = newDraft(); render(); },
  delreq: b => { if (!armed(b, 'ยืนยันลบ?')) return; S.requests = S.requests.filter(r => r.id !== b.dataset.id); save(); render(); toast('ลบหนังสือแล้ว'); },
  automatch: b => {
    const r = getReq(b.dataset.id); let n = 0;
    r.persons.forEach(p => { if (!p.manual) { Object.assign(p, matchPerson(p)); n++; } });
    addTL(r, `ตรวจเทียบฐานข้อมูลอัตโนมัติ ${n} ราย`, false);
    refreshStatus(r); save(); render(); toast(`ตรวจอัตโนมัติ ${n} ราย กรุณาตรวจทานผล`);
  },
  letter: b => { U.letterId = b.dataset.id; renderModal(); },
  closemodal: () => { U.letterId = null; renderModal(); render(); },
  issue: b => { const r = getReq(b.dataset.id); issueNumber(r); save(); renderModal(); toast(`ออกเลขหนังสือส่ง ${S.settings.docPrefix}${r.outNo}`); },
  sent: b => {
    const r = getReq(b.dataset.id); issueNumber(r);
    r.status = 'replied'; r.sentDate = todayISO();
    addTL(r, 'ส่งหนังสือแจ้งผลการตรวจสอบถึงหน่วยงานแล้ว', true);
    addTL(r, `แจ้งเตือนทาง E-mail ${r.email} (จำลอง)`, false);
    save(); render(); toast('บันทึกการส่งหนังสือแล้ว');
  },
  print: () => window.print(),
  copyletter: () => copyText($('#letter').innerText, 'คัดลอกข้อความหนังสือแล้ว'),
  toggleadd: () => { U.showAdd = !U.showAdd; render(); if (U.showAdd) $('#as-sid')?.focus(); },
  delstu: b => { if (!armed(b, 'ยืนยัน?')) return; S.students = S.students.filter(s => s.id !== b.dataset.id); S.fees = S.fees.filter(f => f.studentId !== b.dataset.id); save(); $('#gd-table').innerHTML = gradsTable(); toast('ลบรายชื่อแล้ว'); },
  pp3: async b => {
    const file = $('#gd-pp3').files[0], level = $('#gd-level').value, fb = parseDateAny($('#gd-date').value);
    if (!file) return toast('เลือกไฟล์ ปพ.3 ก่อน', 'err');
    if (!level) return toast('เลือกระดับชั้นที่จบ (ไฟล์ ปพ.3 ไม่ระบุ ม.3/ม.6 ไว้ในตัว)', 'err');
    b.disabled = true; b.textContent = 'กำลังอ่านไฟล์...';
    try {
      const res = await importPP3(file, level, fb);
      if (!res.total) U.lastImport = `<p class="notice danger">ไม่พบแถวข้อมูลนักเรียนใน ${esc(file.name)} ตรวจสอบว่าเป็นไฟล์ ปพ.3 ที่มีคอลัมน์เลขประจำตัวและชื่อ-สกุล</p>`;
      else U.lastImport = `<p class="notice ok">นำเข้า ${esc(file.name)} สำเร็จ ${res.total} ราย (${level}) · เพิ่มใหม่ ${res.added} · อัปเดต ${res.updated}<br>วันที่จบ: ${res.gradDate ? fmtLong(res.gradDate) + (res.approval ? ' (จากบล็อกอนุมัติการจบในไฟล์)' : ' (จากช่องที่กรอก)') : '<b>ไม่พบ</b> กรอกวันที่จบแล้วนำเข้าซ้ำเพื่ออัปเดต'}</p>`;
    } catch (e) { U.lastImport = `<p class="notice danger">อ่านไฟล์ไม่สำเร็จ: ${esc(e.message)}</p>`; }
    render();
  },
  csvimp: async () => {
    const f = $('#gd-csv').files[0];
    const text = f ? await readText(f) : $('#gd-csvtext').value;
    if (!String(text).trim()) return toast('เลือกไฟล์ CSV หรือวางข้อความก่อน', 'err');
    const r = importGradCSV(text);
    U.lastImport = `<p class="notice ok">นำเข้า CSV · เพิ่มใหม่ ${r.added} · อัปเดต ${r.updated}${r.skipped ? ' · ข้าม ' + r.skipped + ' แถว (ไม่มีชื่อ)' : ''}</p>`;
    render();
  },
  payfull: b => { const f = S.fees.find(x => x.id === b.dataset.id); f.paid = f.amount; save(); render(); toast('บันทึกรับชำระครบแล้ว'); },
  delfee: b => { if (!armed(b, 'ยืนยัน?')) return; S.fees = S.fees.filter(f => f.id !== b.dataset.id); save(); render(); },
  copycsv: () => {
    const lines = [['เลขรับ', 'วันที่รับ', 'หน่วยงาน', 'เลขที่หนังสือ', 'แบบ', 'ชื่อ', 'สกุล', 'เลขประจำตัว', 'ผลการตรวจสอบ', 'หมายเหตุ', 'สถานะหนังสือ', 'เลขหนังสือส่ง', 'วันที่ส่ง']];
    S.requests.slice().sort(byRecv).forEach(r => r.persons.forEach(p => lines.push([r.regNo, fmtBE(r.recvDate), r.agency, r.docNo, 'แบบที่ ' + r.form, p.fname, p.lname, p.sid, RESULT[p.result].t, p.note, STATUS[r.status].t, r.outNo, r.sentDate ? fmtBE(r.sentDate) : ''])));
    copyText(lines.map(l => l.map(v => /[",\n]/.test(String(v ?? '')) ? `"${String(v).replace(/"/g, '""')}"` : (v ?? '')).join(',')).join('\n'), 'คัดลอกรายงาน CSV แล้ว วางใน Excel/Google Sheets ได้');
  },
  resetdemo: b => { if (!armed(b, 'กดอีกครั้ง: แทนที่ข้อมูลทั้งหมด')) return; S = seed(); save(); U.reqId = null; U.trackId = null; U.lastImport = ''; render(); toast('โหลดข้อมูลตัวอย่างใหม่แล้ว'); },
  clearall: b => { if (!armed(b, 'กดอีกครั้ง: ลบทุกอย่าง')) return; S = { v: 1, settings: S.settings, students: [], fees: [], requests: [] }; save(); U.reqId = null; U.trackId = null; render(); toast('ล้างข้อมูลแล้ว'); },
  ptdemo: b => { const r = getReq(b.dataset.id); $('#pt-doc').value = r.docNo; $('#pt-email').value = r.email; },
  ptresend: () => { issueOTP(U.otp ? U.otp.reqId : U.portal.reqId); U.portal.err = ''; render(); toast('ส่งรหัส OTP ใหม่แล้ว รหัสเดิมใช้ไม่ได้'); },
  ptlogout: () => { U.portal = { step: 'form' }; U.otp = null; render(); toast('ออกจากระบบแล้ว'); }
};
const IN = {
  df: el => { U.draft[el.dataset.f] = el.value; },
  dp: el => { U.draft.persons[+el.dataset.i][el.dataset.f] = el.value; },
  vfq: el => { U.vq = el.value; $('#vf-quick').innerHTML = quickResults(); },
  trq: el => { U.tq = el.value; $('#tr-list').innerHTML = trackList(); },
  gdq: el => { U.gq = el.value; $('#gd-table').innerHTML = gradsTable(); },
  feq: el => { U.fq = el.value; $('#fe-table').innerHTML = feesTable(); }
};
const CH = {
  dform: el => { U.draft.form = +el.value; render(); },
  dp: el => { U.draft.persons[+el.dataset.i][el.dataset.f] = el.value; },
  dfile: async el => {
    const f = el.files[0]; if (!f) return;
    U.draft.file = f.name;
    if (/\.(csv|txt|xlsx?)$/i.test(f.name)) {
      try {
        const ps = personsFromMatrix(await fileToMatrix(f));
        if (ps.length) { const kept = U.draft.persons.filter(p => p.fname || p.sid); U.draft.persons = [...kept, ...ps]; toast(`ดึงรายชื่อจากไฟล์ ${ps.length} ราย`); }
        else toast('ไม่พบรายชื่อในไฟล์ พิมพ์รายชื่อลงตารางแทน', 'err');
      } catch (e) { toast('อ่านไฟล์ไม่สำเร็จ: ' + e.message, 'err'); }
    }
    render();
  },
  vfreq: el => { U.reqId = el.value || null; render(); },
  res: el => {
    const r = getReq(el.dataset.r), p = r.persons[+el.dataset.i];
    p.result = el.value; p.manual = true;
    addTL(r, `บันทึกผล ${p.fname} ${p.lname}: ${RESULT[p.result].t}`, false);
    refreshStatus(r); save(); render();
  },
  note: el => { const r = getReq(el.dataset.r); r.persons[+el.dataset.i].note = el.value.trim(); save(); },
  gdlevel: el => { U.glevel = el.value; $('#gd-table').innerHTML = gradsTable(); },
  feonly: el => { U.fOnly = el.checked; $('#fe-table').innerHTML = feesTable(); },
  pp3file: el => { const f = el.files[0]; const m = f && f.name.match(/PP3-\d{4}-(\d)/i); if (m && (m[1] === '3' || m[1] === '6')) $('#gd-level').value = 'ม.' + m[1]; },
  csvfile: () => {}
};
const FORMS = {
  receive: () => {
    const d = U.draft, miss = [];
    if (!d.agency.trim()) miss.push('หน่วยงาน');
    if (!d.docno.trim()) miss.push('เลขที่หนังสือ');
    if (!/^\S+@\S+\.\S+$/.test(d.email.trim())) miss.push('E-mail');
    if (!d.docdate) miss.push('วันที่ของหนังสือ');
    const persons = d.persons.filter(p => p.fname.trim() || p.sid.trim()).map(p => ({ id: uid('p'), sid: p.sid.trim(), fname: p.fname.trim(), lname: p.lname.trim(), gradDate: parseDateAny(p.gradText), gradText: p.gradText.trim(), level: p.level, result: 'pending', matchedId: null, auto: '', note: '', manual: false }));
    if (!persons.length) miss.push('รายชื่ออย่างน้อย 1 ราย');
    if (miss.length) return toast('กรอกให้ครบ: ' + miss.join(', '), 'err');
    const reg = nextRegNo();
    const r = { id: uid('r'), regNo: reg, recvDate: d.date || todayISO(), agency: d.agency.trim(), to: d.to.trim(), docNo: d.docno.trim(), docDate: d.docdate, email: d.email.trim().toLowerCase(), form: d.form, file: d.form == 1 ? d.file : '', persons, status: 'received', outNo: '', outDate: '', sentDate: '', timeline: [] };
    addTL(r, `รับหนังสือ เลขทะเบียนรับ ${reg}`, true);
    S.settings.nextReg++; S.requests.push(r); save();
    U.draft = newDraft(); U.reqId = r.id; go('verify'); toast(`บันทึกรับหนังสือ ${reg} แล้ว`);
  },
  addstu: () => {
    const n = splitName($('#as-name').value), sid = $('#as-sid').value.trim();
    if (!sid || !n.fname) return toast('กรอกรหัสประจำตัวและชื่อ-สกุล', 'err');
    S.students.push({ id: uid('s'), sid, cid: digits($('#as-cid').value), ...n, level: $('#as-level').value, gradDate: parseDateAny($('#as-date').value), gpa: $('#as-gpa').value.trim(), dob: '', father: '', mother: '', source: 'เพิ่มเอง' });
    save(); render(); toast('เพิ่มรายชื่อแล้ว');
  },
  addfee: () => {
    const v = $('#fe-stu').value.trim(), key = sidKey(v.split(' ')[0]);
    const s = S.students.find(x => key && sidKey(x.sid) === key) || S.students.find(x => normName(fullName(x)) && normName(v).includes(normName(x.fname + x.lname)));
    if (!s) return toast('ไม่พบนักเรียนนี้ในฐานข้อมูล', 'err');
    const amount = parseFloat($('#fe-amt').value) || 0, paid = parseFloat($('#fe-paid').value) || 0;
    if (amount <= 0) return toast('ระบุจำนวนเงินมากกว่า 0', 'err');
    S.fees.push({ id: uid('f'), studentId: s.id, term: $('#fe-term').value.trim(), item: $('#fe-item').value.trim() || 'ค่าบำรุงการศึกษา', amount, paid: Math.min(paid, amount), note: '' });
    save(); render(); toast(`บันทึกรายการของ ${fullName(s)} แล้ว`);
  },
  settings: () => {
    const st = S.settings;
    ['school', 'address', 'docPrefix', 'office', 'director', 'directorTitle', 'phone', 'email'].forEach(k => { st[k] = $('#st-' + k).value.trim(); });
    st.nextReg = parseInt($('#st-nextReg').value, 10) || st.nextReg;
    st.nextOut = parseInt($('#st-nextOut').value, 10) || st.nextOut;
    save(); render(); toast('บันทึกการตั้งค่าแล้ว');
  },
  portal: () => {
    const doc = $('#pt-doc').value.trim(), email = $('#pt-email').value.trim().toLowerCase();
    const nd = s => thaiDigits(s).replace(/\s+/g, '').toLowerCase();
    U.portal.doc = doc; U.portal.email = email;
    const r = S.requests.find(x => nd(x.docNo) === nd(doc) && x.email === email);
    if (!doc || !email || !r) { U.portal.err = 'ไม่พบหนังสือที่ตรงกับเลขที่หนังสือและ E-mail นี้ ตรวจสอบให้ตรงกับที่ระบุในหนังสือ'; render(); return; }
    U.portal = { step: 'otp', email, reqId: r.id, err: '' };
    issueOTP(r.id); render(); $('#pt-otp')?.focus();
  },
  otp: () => {
    const code = digits($('#pt-otp').value), o = U.otp;
    if (!o) { U.portal = { step: 'form', err: 'รหัสถูกยกเลิกแล้ว กรุณาขอรหัสใหม่' }; render(); return; }
    if (Date.now() > o.exp) { U.portal.err = 'รหัสหมดอายุแล้ว กด "ขอรหัสใหม่"'; render(); return; }
    if (code !== o.code) {
      o.tries++;
      if (o.tries >= OTP_MAX_TRIES) { U.otp = null; U.portal = { step: 'form', err: 'กรอกรหัสผิดเกิน 5 ครั้ง กรุณาขอรหัสใหม่' }; }
      else U.portal.err = `รหัสไม่ถูกต้อง (เหลือ ${OTP_MAX_TRIES - o.tries} ครั้ง)`;
      render(); return;
    }
    const r = getReq(o.reqId); U.otp = null;
    if (r) { addTL(r, 'หน่วยงานเข้าดูสถานะด้วย OTP', false); save(); }
    U.portal = { step: 'view', reqId: o.reqId }; render();
  }
};

document.addEventListener('click', e => { const el = e.target.closest('[data-act]'); if (!el || el.disabled) return; const fn = ACT[el.dataset.act]; if (fn) fn(el, e); });
document.addEventListener('input', e => { const k = e.target.dataset && e.target.dataset.in; if (k && IN[k]) IN[k](e.target); });
document.addEventListener('change', e => { const k = e.target.dataset && e.target.dataset.ch; if (k && CH[k]) CH[k](e.target); });
document.addEventListener('submit', e => { e.preventDefault(); const k = e.target.dataset.form; if (FORMS[k]) FORMS[k](e.target); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && U.letterId) { U.letterId = null; renderModal(); } });

render();
