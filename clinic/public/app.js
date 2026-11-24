// Confirm dangerous actions: <form data-confirm="...">
document.addEventListener('submit', (e) => {
  const msg = e.target.getAttribute('data-confirm');
  if (msg && !window.confirm(msg)) e.preventDefault();
});

// Print buttons
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-print]')) window.print();
});

// Live clock + auto refresh on the waiting-room display
const clock = document.querySelector('[data-clock]');
if (clock) {
  const tick = () => { clock.textContent = new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }); };
  tick();
  setInterval(tick, 10000);
}
const refresh = document.querySelector('[data-refresh]');
if (refresh) setTimeout(() => window.location.reload(), Number(refresh.getAttribute('data-refresh')) * 1000);

// Quick fill dosage text in prescription form
const dosageHelper = document.querySelector('[data-dosage-helper]');
if (dosageHelper) {
  dosageHelper.addEventListener('change', () => {
    const target = document.querySelector(dosageHelper.getAttribute('data-dosage-helper'));
    if (target && dosageHelper.value) target.value = dosageHelper.value;
  });
}

// Copy text of an element: <button data-copy="#selector">
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-copy]');
  if (!btn) return;
  const el = document.querySelector(btn.getAttribute('data-copy'));
  if (!el) return;
  const text = el.textContent.trim();
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch { /* ignore */ }
    ta.remove();
  }
  const old = btn.textContent;
  btn.textContent = 'Đã chép ✓';
  setTimeout(() => { btn.textContent = old; }, 1500);
});
