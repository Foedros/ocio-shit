// European presentation helpers (comma decimal, dd/mm/yyyy). Storage stays ISO/point.
export function fmtValoracion(v) {
  if (v == null || v === '') return '—';
  return String(v).replace('.', ',');
}

export function fmtFecha(iso) {
  if (!iso) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(iso);
}

export function fmtDuracion(min) {
  if (min == null || min === '') return null;
  const m = Math.trunc(Number(min));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
}

export function todayISO() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
