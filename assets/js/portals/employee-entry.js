import { guardPortal } from '../core/portal-guard.js';
import { PortalLayoutEngine } from '../core/portal-layout-engine.js';

guardPortal('employee', ({ identity }) => {
  PortalLayoutEngine.mount({
    root: '#app',
    portal: 'employee',
    identity,
    title: 'بوابة الموظف',
    links: [
      { href: '/employee-dashboard.html', label: 'لوحة الموظف' },
      { href: '/tasks.html', label: 'المهام' },
      { href: '/employee-ledger.html', label: 'دفتر المستحقات' },
      { href: '/employee/expenses.html', label: 'طلب مصروف' },
      { href: '/inquiries.html', label: 'استفسارات العملاء' },
      { href: '/messages.html', label: 'المحادثات' },
    ],
    content: PortalLayoutEngine.createEmptyState('اختر مساحة العمل من شريط التنقل.'),
  });
});