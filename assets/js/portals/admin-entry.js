import { guardPortal } from '../core/portal-guard.js';
import { PortalLayoutEngine } from '../core/portal-layout-engine.js';

guardPortal('admin', ({ identity }) => {
  PortalLayoutEngine.mount({
    root: '#app',
    portal: 'admin',
    identity,
    title: 'بوابة الإدارة',
    links: [
      { href: '/dashboard.html', label: 'لوحة القيادة' },
      { href: '/customers.html', label: 'العملاء' },
      { href: '/orders.html', label: 'الطلبات' },
      { href: '/invoices.html', label: 'الفواتير' },
      { href: '/payments.html', label: 'المدفوعات' },
      { href: '/treasury.html', label: 'الخزينة' },
      { href: '/expenses.html', label: 'المصروفات' },
      { href: '/employees.html', label: 'الموظفون' },
      { href: '/tasks.html', label: 'المهام' },
      { href: '/activity-logs.html', label: 'سجل النشاط' },
      { href: '/settings.html', label: 'الإعدادات' },
    ],
    content: PortalLayoutEngine.createEmptyState('اختر صفحة الإدارة من شريط التنقل.'),
  });
});