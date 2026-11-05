import { guardPortal } from '../core/portal-guard.js';
import { PortalLayoutEngine } from '../core/portal-layout-engine.js';

guardPortal('client', ({ identity }) => {
  PortalLayoutEngine.mount({
    root: '#app',
    portal: 'client',
    identity,
    title: 'بوابة العميل',
    links: [
      { href: '/portal-dashboard.html', label: 'لوحتي' },
      { href: '/portal-orders.html', label: 'طلباتي' },
      { href: '/portal-payments.html', label: 'مدفوعاتي' },
    ],
    content: PortalLayoutEngine.createEmptyState('اختر الصفحة من شريط التنقل.'),
  });
});