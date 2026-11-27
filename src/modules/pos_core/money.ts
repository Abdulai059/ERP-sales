/** All money is whole minor units. Quantities are "milli" units (1000 = 1). Rounding is half-up per line. */
function divRound(n: bigint, d: bigint): bigint { return (2n * n + d) / (2n * d); }   // n >= 0, d > 0

export interface LineAmounts { net: number; tax: number; total: number }

export function lineAmounts(unitMinor: number, qtyMilli: number, rateBp: number, taxInclusive: boolean): LineAmounts {
  const gross = divRound(BigInt(unitMinor) * BigInt(qtyMilli), 1000n);
  let net: bigint, tax: bigint, total: bigint;
  if (taxInclusive) { tax = divRound(gross * BigInt(rateBp), BigInt(10000 + rateBp)); total = gross; net = gross - tax; }
  else { tax = divRound(gross * BigInt(rateBp), 10000n); net = gross; total = gross + tax; }
  const out = { net: Number(net), tax: Number(tax), total: Number(total) };
  for (const v of Object.values(out)) if (!Number.isSafeInteger(v)) throw new Error('amount_overflow');
  return out;
}

/** Parse a quantity into milli units; must be > 0 and fit the product's allowed decimals (0..3). */
export function parseQty(v: unknown, decimals: number): number | undefined {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0 || n > 1_000_000) return undefined;
  const milli = Math.round(n * 1000);
  if (Math.abs(n * 1000 - milli) > 1e-6) return undefined;
  if (milli % 10 ** (3 - decimals) !== 0) return undefined;
  return milli;
}
