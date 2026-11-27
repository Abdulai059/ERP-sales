import type { Manifest } from '../../types.js';
import { routes } from './routes.js';

const manifest: Manifest = {
  name: 'rooms',
  version: '0.1.0',
  kernel: '>=0.1 <1.0',
  description: 'Hotel rooms: list, create, and track room status.',
  depends: ['core_base'],
  permissions: {
    'rooms.view': 'View rooms',
    'rooms.manage': 'Create rooms and change their status',
  },
  routes,
};
export default manifest;
