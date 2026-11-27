import test from 'node:test';
import assert from 'node:assert/strict';
import { ModuleRegistry } from '../src/loader.js';
import { resolveSlug } from '../src/tenancy.js';
import type { Manifest } from '../src/types.js';

const mod = (name: string, depends: string[] = []): Manifest =>
  ({ name, version: '1.0.0', kernel: '>=0.1', description: 'x', depends });

function reg(...ms: Manifest[]) { const r = new ModuleRegistry(); ms.forEach((m) => r.add(m)); return r; }

test('orders dependencies first and includes them automatically', () => {
  const r = reg(mod('pos_kitchen', ['pos_restaurant']), mod('pos_restaurant', ['pos_core']), mod('pos_core'));
  assert.deepEqual(r.orderFor(['pos_kitchen']), ['pos_core', 'pos_restaurant', 'pos_kitchen']);
});

test('detects a dependency cycle', () => {
  assert.throws(() => reg(mod('a', ['b']), mod('b', ['a'])).orderFor(['a']), /cycle/i);
});

test('detects a missing dependency', () => {
  assert.throws(() => reg(mod('a', ['ghost'])).orderFor(['a']), /Missing module "ghost"/);
});

test('rejects invalid module names and duplicates', () => {
  assert.throws(() => reg(mod('Bad-Name')), /Invalid module name/);
  assert.throws(() => reg(mod('a'), mod('a')), /Duplicate/);
});

test('tenant slug comes from the subdomain', () => {
  assert.equal(resolveSlug('hotel-d.localhost:3000', undefined), 'hotel-d');
  assert.equal(resolveSlug('localhost:3000', undefined), null);
});
