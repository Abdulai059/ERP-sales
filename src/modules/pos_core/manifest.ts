import type { Manifest } from '../../types.js';
import { routes } from './routes.js';

const manifest: Manifest = {
  name: 'pos_core',
  version: '0.1.0',
  kernel: '>=0.1 <1.0',
  description: 'Outlets, registers, cashier sessions, orders, payments, gap-free receipts, cancel and refund.',
  depends: ['core_base', 'product'],
  permissions: {
    'pos.view': 'View POS setup, orders and session summaries',
    'pos.sell': 'Open and close own session, create orders, take payment',
    'pos.manage': 'Configure outlets, registers, taxes and payment methods',
    'pos.approve': 'Refund paid orders and act on other cashiers\' orders',
  },
  routes,
};
export default manifest;
