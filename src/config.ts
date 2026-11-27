const isProd = process.env.NODE_ENV === 'production';

function secret(): string {
  const s = process.env.JWT_SECRET;
  if (s && s.length >= 16) return s;
  if (isProd) throw new Error('JWT_SECRET must be set (16+ chars) in production');
  return 'dev-only-secret-do-not-use';
}

export const config = {
  isProd,
  port: Number(process.env.PORT ?? 3000),
  controlUrl: process.env.CONTROL_DATABASE_URL ?? 'postgres://postgres:dev@localhost:5432/control',
  tenantUrlTemplate:
    process.env.TENANT_DATABASE_URL_TEMPLATE ?? 'postgres://postgres:dev@localhost:5432/{db}',
  baseDomain: process.env.BASE_DOMAIN ?? 'localhost',
  jwtSecret: secret(),
  sessionTtlMinutes: Number(process.env.SESSION_TTL_MINUTES ?? 480),
};
