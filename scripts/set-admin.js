// =============================================================
// set-admin.js — سكربت إعداد المدير الأول
// =============================================================
// يُستخدم مرة واحدة لإعداد أول مستخدم مدير في النظام.
//
// المتطلبات:
// 1. ثبّت Firebase Admin SDK: npm install firebase-admin
// 2. نزّل مفتاح حساب الخدمة من Firebase Console:
//    - Project Settings → Service Accounts → Generate New Private Key
//    - احفظه باسم service-account.json في نفس المجلد
//
// الاستخدام:
//   node set-admin.js user@email.com
//
// ملاحظة: هذا السكربت آمن لأنه يعمل محليًا فقط ولا يُنشر للعميل.
// =============================================================

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

// =============================================================
// 1. قراءة الوسائط
// =============================================================
const email = process.argv[2];

if (!email) {
  console.error('❌ الاستخدام: node set-admin.js user@email.com');
  console.error('   مثال: node set-admin.js abdallah@example.com');
  process.exit(1);
}

// =============================================================
// 2. تحميل مفتاح حساب الخدمة
// =============================================================
const keyPath = path.join(__dirname, 'service-account.json');

if (!fs.existsSync(keyPath)) {
  console.error('❌ لم يُعثر على service-account.json');
  console.error('   نزّل المفتاح من:');
  console.error('   Firebase Console → Project Settings → Service Accounts → Generate New Private Key');
  console.error('   واحفظه في: ' + keyPath);
  process.exit(1);
}

const serviceAccount = require(keyPath);

// =============================================================
// 3. تهيئة Admin SDK
// =============================================================
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId: serviceAccount.project_id,
});

const auth = admin.auth();
const db = admin.firestore();

// =============================================================
// 4. البحث عن المستخدم بواسطة البريد وتعيين دور المدير
// =============================================================
async function setAdmin() {
  try {
    console.log(`🔍 البحث عن المستخدم: ${email}`);

    // البحث في Firebase Auth
    const userRecord = await auth.getUserByEmail(email);
    console.log(`✅ تم العثور على المستخدم. UID: ${userRecord.uid}`);

    // تعيين Custom Claim (admin)
    await auth.setCustomUserClaims(userRecord.uid, { admin: true });
    console.log('✅ تم تعيين custom claim: admin = true');

    // إنشاء/تحديث وثيقة المستخدم في Firestore
    const userRef = db.collection('users').doc(userRecord.uid);
    const userDoc = await userRef.get();

    const userData = {
      email: userRecord.email,
      displayName: userRecord.displayName || userRecord.email,
      role: 'مدير',
      disabled: false,
      permissions: {
        // المدير يملك كل الصلاحيات تلقائيًا، لكن نُضمّنها للوضوح
        canViewCustomers: true,
        canAddCustomers: true,
        canEditCustomers: true,
        canViewOrders: true,
        canCreateOrders: true,
        canUpdateOrders: true,
        canViewEmployees: true,
        canViewInquiries: true,
        canEditInquiries: true,
        canViewTasks: true,
        canAssignTasks: true,
        canViewInvoices: true,
        canViewPayments: true,
        canViewReports: true,
        canViewTreasury: true,
      },
      updatedAt: new Date().toISOString(),
    };

    if (!userDoc.exists) {
      userData.createdAt = new Date().toISOString();
      await userRef.set(userData);
      console.log('✅ تم إنشاء وثيقة المستخدم في Firestore');
    } else {
      await userRef.set(userData, { merge: true });
      console.log('✅ تم تحديث وثيقة المستخدم في Firestore');
    }

    console.log('');
    console.log('═══════════════════════════════════════════════');
    console.log('🎉 تم إعداد المدير بنجاح!');
    console.log('═══════════════════════════════════════════════');
    console.log(`   البريد: ${userRecord.email}`);
    console.log(`   UID: ${userRecord.uid}`);
    console.log(`   الدور: مدير`);
    console.log(`   Custom Claims: { admin: true }`);
    console.log('');
    console.log('   يمكن للمستخدم الآن تسجيل الدخول والوصول لكل الميزات.');
    console.log('   اطلب منه إعادة تسجيل الدخول لتفعيل Custom Claims.');
    console.log('');
    console.log('⚠️  احذف service-account.json بعد الانتهاء (لا تُلتزمه في Git).');
    process.exit(0);
  } catch (error) {
    console.error('');
    console.error('❌ خطأ:', error.message);
    if (error.code === 'auth/user-not-found') {
      console.error('   لا يوجد مستخدم بهذا البريد في Firebase Auth.');
      console.error('   اطلب من المستخدم تسجيل حساب أولاً من صفحة الدخول.');
    }
    process.exit(1);
  }
}

setAdmin();
