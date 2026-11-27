import type { Manifest } from '../../types.js';
import { routes } from './routes.js';

const manifest: Manifest = {
  name: 'product',
  version: '0.1.0',
  kernel: '>=0.1 <1.0',
  description: 'Shared catalog: menu items, retail goods, services. Price is whole minor units plus currency.',
  depends: ['core_base'],
  permissions: {
    'product.view': 'View products and categories',
    'product.manage': 'Create and change products, categories and prices',
  },
  routes,
};
export default manifest;
