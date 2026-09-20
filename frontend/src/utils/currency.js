// Centralized Philippine Peso formatter — single source of truth for money.
// ALWAYS use formatCurrencyPHP() for monetary values in the UI so receipts,
// fuel totals and summaries consistently render as ₱2,000.00 (never $ or
// bare "PHP 2000" / "P2000") unless a different currency is explicitly
// configured.
//
//   formatCurrencyPHP(82.8)    -> "₱82.80"
//   formatCurrencyPHP(2000)    -> "₱2,000.00"
//   formatCurrencyPHP(null)    -> "—"

export const DEFAULT_CURRENCY = 'PHP';

export const PHP_SYMBOL = '₱';

export function formatCurrencyPHP(amount, opts = {}) {
  const { fallback = '—', decimals = 2 } = opts;
  if (amount === null || amount === undefined || amount === '') return fallback;
  const n = Number(String(amount).replace(/[₱PHPp,\s]/g, ''));
  if (!Number.isFinite(n)) return fallback;
  try {
    const grouped = n.toLocaleString('en-PH', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
    return `${PHP_SYMBOL}${grouped}`;
  } catch {
    return `${PHP_SYMBOL}${n.toFixed(decimals)}`;
  }
}

// Compact variant for tight table cells (₱2k style is NOT used — full
// precision is kept; this only drops trailing .00).
export function formatCurrencyPHPShort(amount, opts = {}) {
  const full = formatCurrencyPHP(amount, opts);
  if (full === (opts.fallback ?? '—')) return full;
  return full.replace(/\.00$/, '');
}

export default formatCurrencyPHP;
