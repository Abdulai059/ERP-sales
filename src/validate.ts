export type Rule<T = unknown> = (v: unknown) => T | undefined;   // undefined = invalid

export const str = (min = 1, max = 200): Rule<string> => (v) =>
  typeof v === 'string' && v.trim().length >= min && v.length <= max ? v.trim() : undefined;
export const optStr = (max = 200): Rule<string | null> => (v) =>
  v === null || v === '' ? null : typeof v === 'string' && v.length <= max ? v.trim() : undefined;
export const int = (min: number, max = Number.MAX_SAFE_INTEGER): Rule<number> => (v) =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= min && v <= max ? v : undefined;
export const bool: Rule<boolean> = (v) => (typeof v === 'boolean' ? v : undefined);
export const oneOf = <T extends string>(...o: T[]): Rule<T> => (v) =>
  typeof v === 'string' && (o as string[]).includes(v) ? (v as T) : undefined;
export const regex = (re: RegExp): Rule<string> => (v) => (typeof v === 'string' && re.test(v) ? v : undefined);
export const uuidOrNull: Rule<string | null> = (v) =>
  v === null ? null : typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v) ? v : undefined;

/** Validate body against a whitelist of rules. Only known fields are ever returned. */
export function parseBody(body: unknown, rules: Record<string, Rule>, requireAll: string[] = []) {
  const b = (body ?? {}) as Record<string, unknown>;
  const values: Record<string, unknown> = {};
  const errors: string[] = [];
  for (const [k, rule] of Object.entries(rules)) {
    if (b[k] === undefined) { if (requireAll.includes(k)) errors.push(`${k} is required`); continue; }
    const v = rule(b[k]);
    if (v === undefined) errors.push(`${k} is invalid`); else values[k] = v;
  }
  return { values, errors };
}
