import { guardPortal } from '../core/portal-guard.js';
import { PortalLayoutEngine } from '../core/portal-layout-engine.js';
import { UIEngine } from '../core/app-core.js';
import { FinanceService } from '../core/business-services.js';

guardPortal('employee', ({ user, identity }) => {
  const form = document.createElement('form');
  form.className = 'portal-expense-form';

  const fields = [
    ['description', 'وصف المصروف', 'text', true],
    ['amount', 'المبلغ', 'number', true],
    ['date', 'التاريخ', 'date', true],
    ['notes', 'ملاحظات', 'text', false],
  ];
  for (const [name, label, type, required] of fields) {
    const wrapper = document.createElement('label');
    wrapper.className = 'portal-form-field';
    wrapper.textContent = label;
    const input = document.createElement('input');
    input.name = name;
    input.type = type;
    input.required = required;
    if (name === 'amount') {
      input.min = '0.01';
      input.step = '0.01';
    }
    if (name === 'date') input.value = new Date().toISOString().slice(0, 10);
    wrapper.append(input);
    form.append(wrapper);
  }

  const categoryLabel = document.createElement('label');
  categoryLabel.className = 'portal-form-field';
  categoryLabel.textContent = 'الفئة';
  const category = document.createElement('select');
  category.name = 'category';
  [
    ['operating', 'تشغيلية'], ['marketing', 'تسويق'], ['software', 'برمجيات'],
    ['hosting', 'استضافة وبنية'], ['utilities', 'مرافق'], ['rent', 'إيجار'], ['other', 'أخرى'],
  ].forEach(([value, label]) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    category.append(option);
  });
  categoryLabel.append(category);
  form.append(categoryLabel);

  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.className = 'portal-logout';
  submit.textContent = 'إرسال للمراجعة';
  form.append(submit);

  const panel = document.createElement('section');
  panel.className = 'portal-panel';
  const heading = document.createElement('h2');
  heading.textContent = 'طلب مصروف تشغيلي';
  const description = document.createElement('p');
  description.className = 'portal-user-label';
  description.textContent = 'سيظل الطلب معلقاً حتى اعتماده من الإدارة.';
  panel.append(heading, description, form);

  PortalLayoutEngine.mount({
    root: '#app',
    portal: 'employee',
    identity,
    title: 'طلب مصروف',
    links: [{ href: '/employee/', label: 'بوابة الموظف' }],
    content: panel,
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    submit.disabled = true;
    try {
      const values = Object.fromEntries(new FormData(form));
      await FinanceService.submitExpense({
        ...values,
        amount: Number(values.amount),
        date: new Date(`${values.date}T00:00:00`),
      }, user.uid);
      form.reset();
      UIEngine.toast('تم إرسال المصروف للمراجعة', 'success');
    } catch (error) {
      console.error('Could not submit employee expense:', error);
      UIEngine.toast('تعذر إرسال المصروف', 'error');
    } finally {
      submit.disabled = false;
    }
  });
});