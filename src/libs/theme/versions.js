// Version compare for themes ("1.2.3"), without the package reader (format.js loads PostCSS).
const parts = (v) => (/^v?(\d+)\.(\d+)(?:\.(\d+))?$/.exec(String(v ?? '').trim()) || [0, 0, 0, 0]).slice(1).map((n) => Number(n || 0));

/** > 0 when version a is newer than b. */
export function compareVersionsLite(a, b) {
  const x = parts(a);
  const y = parts(b);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}
