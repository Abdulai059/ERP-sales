const IDENT = /^[a-z][a-z0-9_]{0,40}$/;
export function assertIdent(s: string, what = 'identifier'): string {
  if (!IDENT.test(s)) throw new Error(`Invalid ${what}: "${s}" (use a-z, 0-9, _ ; start with a letter)`);
  return s;
}
export const SLUG = /^[a-z][a-z0-9-]{1,40}$/;
