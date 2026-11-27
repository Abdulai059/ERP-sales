import { bootstrapControl, closeAll, createBusiness, findBusiness, tenantPool } from './db.js';
import { discoverModules, installModules, upgradeBusiness } from './loader.js';
import { hashPassword } from './auth.js';
import { audit } from './audit.js';

function parse(argv: string[]) {
  const pos: string[] = []; const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith('--')) flags[a.slice(2)] = argv[++i] ?? '';
    else pos.push(a);
  }
  return { pos, flags };
}

async function biz(slug?: string) {
  if (!slug) throw new Error('--business <slug> is required');
  const b = await findBusiness(slug);
  if (!b) throw new Error(`No such business: ${slug}`);
  return { b, db: tenantPool(b.dbName) };
}

const HELP = `kernel <command>
  create-business <slug> [--name "Hotel D"] [--type hotel|restaurant|shop|blank]
  install <module> --business <slug>
  modules --business <slug>
  upgrade --business <slug>
  create-user --business <slug> --email <e> --name <n> --password <p> --role <role>`;

async function main() {
  const { pos, flags } = parse(process.argv.slice(2));
  const [cmd, arg] = pos;
  await bootstrapControl();
  const reg = await discoverModules();

  switch (cmd) {
    case 'create-business': {
      if (!arg) throw new Error('usage: create-business <slug>');
      const b = await createBusiness(arg, flags.name ?? arg, flags.type ?? 'blank');
      const done = await installModules(reg, tenantPool(b.dbName), ['core_base']);
      console.log(`Created business "${b.slug}" (database ${b.dbName}). Installed: ${done.join(', ')}`);
      break;
    }
    case 'install': {
      if (!arg) throw new Error('usage: install <module> --business <slug>');
      const { db } = await biz(flags.business);
      const done = await installModules(reg, db, [arg]);
      console.log(done.length ? `Installed: ${done.join(' -> ')}` : 'Already installed.');
      break;
    }
    case 'modules': {
      const { db } = await biz(flags.business);
      const { rows } = await db.query('select name, version, installed_at from kernel_module order by name');
      console.table(rows);
      break;
    }
    case 'upgrade': {
      const { db } = await biz(flags.business);
      const res = await upgradeBusiness(reg, db);
      for (const [m, files] of Object.entries(res)) console.log(`${m}: ${files.length ? files.join(', ') : 'up to date'}`);
      break;
    }
    case 'create-user': {
      const { db } = await biz(flags.business);
      const { email, name, password, role } = flags;
      if (!email || !name || !password || !role) throw new Error('need --email --name --password --role');
      if (password.length < 10) throw new Error('password must be at least 10 characters');
      const r = await db.query('select id from role where name=$1', [role]);
      if (!r.rows[0]) throw new Error(`Unknown role "${role}"`);
      const u = await db.query(
        'insert into app_user (email, name, password_hash) values ($1,$2,$3) returning id',
        [email.toLowerCase(), name, await hashPassword(password)]);
      await db.query('insert into user_role (user_id, role_id) values ($1,$2)', [u.rows[0].id, r.rows[0].id]);
      await audit(db, { action: 'user.created', entity: 'app_user', entityId: u.rows[0].id, data: { email, role, via: 'cli' } });
      console.log(`Created user ${email} with role ${role}`);
      break;
    }
    default: console.log(HELP);
  }
}

main().catch((e) => { console.error('Error:', (e as Error).message); process.exitCode = 1; }).finally(closeAll);
