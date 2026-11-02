# المرحلة الثالثة — المصادقة والصلاحيات + بوابة العملاء

## التركيب السريع (5 دقائق)

### 1. انسخ الملفات الجديدة

```
من: phase3-auth/new-files/assets/js/
إلى: مشروعك/assets/js/

الملفات:
  permissions.js      ← وحدة الصلاحيات
  init.js              ← التهيئة المشتركة
  sidebar.js           ← القائمة الجانبية الديناميكية
  portal-auth.js       ← مصادقة بوابة العميل
  portal-dashboard.js  ← لوحة العميل
  portal-orders.js     ← طلبات العميل
  portal-payments.js   ← مدفوعات العميل

من: phase3-auth/new-files/
إلى: مشروعك/

  portal-login.html      ← صفحة دخول العميل
  portal-dashboard.html  ← لوحة العميل
  portal-orders.html     ← طلبات العميل
  portal-payments.html   ← مدفوعات العميل
```

### 2. استبدل الملفات المُحدَّثة

```
من: phase3-auth/updated-files/assets/js/pages/
إلى: مشروعك/assets/js/pages/

  payments.js   ← مُحدَّث (status + customerUid + اعتماد/رفض)
  settings.js   ← مُحدَّث (إدارة الصلاحيات)
```

### 3. إعداد المدير الأول (مرة واحدة)

```bash
# في مجلد scripts/:
npm install firebase-admin

# نزّل مفتاح حساب الخدمة من:
# Firebase Console → Project Settings → Service Accounts → Generate New Private Key
# واحفظه باسم: scripts/service-account.json

node set-admin.js abdallah@example.com
```

أو يدويًا (بدون سكربت):
1. افتح Firebase Console → Firestore → users
2. ابحث عن وثيقتك (uid من Firebase Auth)
3. أضف/عدّل الحقل `role` إلى `مدير`

### 4. اختبار سريع

1. سجّل دخول كمدير → تأكد أن القائمة الجانبية تعرض كل العناصر
2. افتح `portal-login.html` → أنشئ حساب عميل جديد
3. سجّل دخول كعميل → تأكد أنك تصل لبوابة العميل فقط
4. من بوابة العميل: أرسل طلب خدمة، ارفع إثبات دفع
5. سجّل دخول كمدير → اذهب للمدفوعات → ستجد الدفعة بحالة `pending`
6. اضغط زر الاعتماد ✓ → يجب أن يُحدث رصيد العميل ويُنشئ إيداع خزينة

### 5. تحديث الصفحات الموجودة (اختياري للمرحلة 3)

لجعل القائمة الجانبية ديناميكية في كل الصفحات، أضف في كل ملف HTML:

```html
<script type="module">
  import { initDynamicSidebar } from './assets/js/sidebar.js';
  initDynamicSidebar();
</script>
```

أو استبدل القائمة الجانبية الثابتة بـ:
```html
<aside id="sidebar"></aside>
<div id="sidebar-overlay"></div>
```
ثم استدعِ `renderSidebar('currentPage.html')` في كل صفحة.

## الميزات الجديدة

### نظام الصلاحيات (15 صلاحية دقيقة)
- عرض/إضافة/تعديل العملاء
- عرض/إنشاء/تحديث الطلبات
- عرض الموظفين، الاستفسارات، المهام
- تعيين المهام، عرض الفواتير/المدفوعات/التقارير/الخزينة

### بوابة العملاء (4 صفحات)
- **portal-login.html**: تسجيل حساب + دخول (منفصل عن لوحة الإدارة)
- **portal-dashboard.html**: إحصائيات + آخر الطلبات + مدفوعات معلّقة
- **portal-orders.html**: تتبع الطلبات + طلب خدمة جديدة
- **portal-payments.html**: رفع إثبات دفع + سجل المدفوعات

### سير التحقق من المدفوعات
- العميل يرفع دفعة → `status: pending`
- المدير/المحاسب يرى زر الاعتماد/الرفض
- الاعتماد: يُحدث رصيد العميل + يُنشئ إيداع خزينة (معاملة ذرية)
- الرفض: يُحدّث الحالة فقط، لا يتأثر الرصيد

## القيود (بسبب الميزانية صفر)

| الميزة | الحل |
|--------|------|
| إضافة مستخدم من الإعدادات | تعطيل الزر — العميل يسجّل من صفحة الدخول |
| Custom Claims تلقائية | سكربت محلي set-admin.js (مرة واحدة) |
| إشعارات بريد/WhatsApp | إشعارات داخل التطبيق فقط |

## الخطوة التالية

بعد اختبار المرحلة الثالثة، ننتقل للمرحلة الرابعة:
- نظام المهام الكامل (tasks)
- الاستفسارات (inquiries)
- لوحة الموظف (employee-dashboard)
