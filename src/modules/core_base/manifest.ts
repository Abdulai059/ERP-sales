import type { Manifest } from '../../types.js';
import { routes } from './routes.js';

const manifest: Manifest = {
  name: 'core_base',
  version: '0.1.0',
  kernel: '>=0.1 <1.0',
  description: 'Users, roles, permissions, audit log, outbox, sequences.',
  depends: [],
  permissions: {
    'users.manage': 'Create and manage users and roles',
    'audit.view': 'View the audit log',
  },
  routes,
};
export default manifest;
