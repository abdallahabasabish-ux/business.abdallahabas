// =============================================================
// portal-auth.js — مصادقة بوابة العميل
// =============================================================
// معالجة تسجيل الدخول وإنشاء الحساب للعملاء
// الفرق عن login.js:
// - يُنشئ وثيقة في customers (مع uid) بدل users
// - يُوجّه إلى portal-dashboard.html بدل dashboard.html
// - لا يسمح بدور مدير/موظف (العملاء فقط)
// =============================================================

import { auth, db } from './firebase-config.js';
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  onAuthStateChanged,
  updateProfile,
} from 'firebase/auth';
import { doc, setDoc, getDoc, serverTimestamp } from 'firebase/firestore';

// =============================================================
// 1. دوال مساعدة
// =============================================================
function showToast(message, type = 'success') {
  const colors = {
    success: 'linear-gradient(to right, #00b09b, #96c93d)',
    error: 'linear-gradient(to right, #ff5f6d, #ffc371)',
    warning: 'linear-gradient(to right, #f7971e, #ffd200)',
    info: 'linear-gradient(to right, #ff6600, #ff8533)',
  };
  if (typeof Toastify !== 'undefined') {
    Toastify({
      text: message,
      duration: 3500,
      gravity: 'bottom',
      position: 'left',
      style: { background: colors[type] || colors.info },
      className: 'rounded-3 shadow',
    }).showToast();
  } else {
    alert(message);
  }
}

// =============================================================
// 2. الوضع المظلم
// =============================================================
function initDarkMode() {
  const themeToggle = document.getElementById('themeToggle');
  const htmlElement = document.documentElement;
  const savedTheme = localStorage.getItem('theme') || 'light';

  if (savedTheme === 'dark') {
    htmlElement.setAttribute('data-theme', 'dark');
    if (themeToggle) themeToggle.innerHTML = '<i class="fas fa-sun"></i>';
  } else {
    htmlElement.removeAttribute('data-theme');
    if (themeToggle) themeToggle.innerHTML = '<i class="fas fa-moon"></i>';
  }

  themeToggle?.addEventListener('click', function () {
    const current = htmlElement.getAttribute('data-theme');
    if (current === 'dark') {
      htmlElement.removeAttribute('data-theme');
      localStorage.setItem('theme', 'light');
      this.innerHTML = '<i class="fas fa-moon"></i>';
    } else {
      htmlElement.setAttribute('data-theme', 'dark');
      localStorage.setItem('theme', 'dark');
      this.innerHTML = '<i class="fas fa-sun"></i>';
    }
  });
}

// =============================================================
// 3. إظهار/إخفاء كلمة المرور
// =============================================================
function setupPasswordToggles() {
  ['toggleLoginPassword', 'toggleRegisterPassword'].forEach((id) => {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.addEventListener('click', function () {
      const input = this.parentElement.querySelector('input');
      const icon = this.querySelector('i');
      if (input.type === 'password') {
        input.type = 'text';
        icon.classList.replace('fa-eye', 'fa-eye-slash');
      } else {
        input.type = 'password';
        icon.classList.replace('fa-eye-slash', 'fa-eye');
      }
    });
  });
}

// =============================================================
// 4. تسجيل الدخول
// =============================================================
document.getElementById('portalLoginForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  const errorDiv = document.getElementById('loginError');
  const btn = document.getElementById('loginBtn');

  errorDiv.style.display = 'none';
  errorDiv.textContent = '';
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>جاري...';

  try {
    await signInWithEmailAndPassword(auth, email, password);
    // onAuthStateChanged سيتولى التوجيه
  } catch (error) {
    let msg = 'حدث خطأ، تحقق من البيانات.';
    if (error.code === 'auth/user-not-found') msg = 'البريد الإلكتروني غير مسجل.';
    else if (error.code === 'auth/wrong-password') msg = 'كلمة المرور غير صحيحة.';
    else if (error.code === 'auth/invalid-email') msg = 'البريد الإلكتروني غير صحيح.';
    else if (error.code === 'auth/too-many-requests') msg = 'تم حظر الحساب مؤقتاً، حاول لاحقاً.';
    errorDiv.textContent = msg;
    errorDiv.style.display = 'block';
    showToast(msg, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-sign-in-alt me-2"></i>تسجيل الدخول';
  }
});

// =============================================================
// 5. إنشاء حساب عميل جديد
// =============================================================
document.getElementById('portalRegisterForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();

  const name = document.getElementById('registerName').value.trim();
  const email = document.getElementById('registerEmail').value.trim();
  const phone = document.getElementById('registerPhone').value.trim();
  const password = document.getElementById('registerPassword').value;
  const confirm = document.getElementById('registerConfirm').value;
  const errorDiv = document.getElementById('registerError');
  const btn = document.getElementById('registerBtn');

  errorDiv.style.display = 'none';
  errorDiv.textContent = '';

  // التحقق
  if (!name || !email || !phone) {
    errorDiv.textContent = 'جميع الحقول مطلوبة.';
    errorDiv.style.display = 'block';
    showToast('جميع الحقول مطلوبة', 'error');
    return;
  }

  if (password !== confirm) {
    errorDiv.textContent = 'كلمة المرور وتأكيدها غير متطابقين.';
    errorDiv.style.display = 'block';
    showToast('كلمة المرور غير متطابقة', 'error');
    return;
  }

  if (password.length < 6) {
    errorDiv.textContent = 'كلمة المرور يجب أن تكون 6 أحرف على الأقل.';
    errorDiv.style.display = 'block';
    showToast('كلمة المرور ضعيفة', 'error');
    return;
  }

  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>جاري الإنشاء...';

  try {
    // 1. إنشاء حساب Firebase Auth
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;

    // 2. تحديث الاسم المعروض
    if (name) {
      await updateProfile(user, { displayName: name });
    }

    // 3. إنشاء وثيقة العميل في customers (مع uid للربط)
    // القواعد تسمح بإنشاء customer إذا uid == currentUid
    await setDoc(doc(db, 'customers', user.uid), {
      uid: user.uid,
      name: name,
      email: email,
      phone: phone,
      company: '',
      country: '',
      city: '',
      address: '',
      notes: '',
      totalPaid: 0,
      balance: 0,
      portalStatus: 'active',
      registrationSource: 'portal',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    // ملاحظة: نستخدم user.uid كمعرّف المستند في customers
    // هذا يسهّل الربط المباشر uid ↔ customerId

    showToast('تم إنشاء حسابك بنجاح! مرحباً بك.', 'success');
    // onAuthStateChanged سيتولى التوجيه إلى portal-dashboard.html
  } catch (error) {
    console.error('Portal registration error:', error);
    let msg = 'حدث خطأ أثناء التسجيل.';
    if (error.code === 'auth/email-already-in-use') {
      msg = 'البريد الإلكتروني مستخدم بالفعل. حاول تسجيل الدخول.';
    } else if (error.code === 'auth/invalid-email') {
      msg = 'البريد الإلكتروني غير صحيح.';
    } else if (error.code === 'auth/weak-password') {
      msg = 'كلمة المرور ضعيفة (6 أحرف على الأقل).';
    }
    errorDiv.textContent = msg;
    errorDiv.style.display = 'block';
    showToast(msg, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-user-plus me-2"></i>إنشاء الحساب';
  }
});

// =============================================================
// 6. استعادة كلمة المرور
// =============================================================
document.getElementById('forgotPasswordLink')?.addEventListener('click', async (e) => {
  e.preventDefault();
  const { value: email } = await Swal.fire({
    title: 'استعادة كلمة المرور',
    input: 'email',
    inputLabel: 'أدخل بريدك الإلكتروني',
    inputPlaceholder: 'example@email.com',
    showCancelButton: true,
    confirmButtonText: 'إرسال',
    cancelButtonText: 'إلغاء',
    inputValidator: (value) => {
      if (!value) return 'يرجى إدخال البريد الإلكتروني';
      if (!value.includes('@')) return 'بريد إلكتروني غير صحيح';
    },
  });

  if (email) {
    try {
      await sendPasswordResetEmail(auth, email);
      showToast('تم إرسال رابط استعادة كلمة المرور إلى بريدك.', 'success');
    } catch (error) {
      let msg = 'حدث خطأ.';
      if (error.code === 'auth/user-not-found') msg = 'لا يوجد حساب بهذا البريد.';
      showToast(msg, 'error');
    }
  }
});

// =============================================================
// 7. مراقبة حالة المصادقة — توجيه تلقائي
// =============================================================
onAuthStateChanged(auth, async (user) => {
  if (!user) return; // لا توجيه إذا غير مسجّل

  // التحقق: هل المستخدم عميل أم موظف؟
  // إن كان موظفًا (له وثيقة في users)، وجّه إلى لوحة الإدارة
  // إن كان عميلًا (له وثيقة في customers بـ uid)، وجّه إلى بوابة العميل
  try {
    const userDocSnap = await getDoc(doc(db, 'users', user.uid));
    if (userDocSnap.exists() && userDocSnap.data().role) {
      // موظف/مدير — وجّه إلى لوحة الإدارة
      window.location.href = 'dashboard.html';
      return;
    }

    // تحقق من وجود وثيقة العميل
    const customerDocSnap = await getDoc(doc(db, 'customers', user.uid));
    if (customerDocSnap.exists()) {
      // عميل — وجّه إلى بوابة العميل
      window.location.href = 'portal-dashboard.html';
      return;
    }

    // المستخدم موجود في Auth لكن ليس له وثيقة في أي مكان
    // يمكن أن يكون مستخدمًا قديمًا أو حسابًا غير مكتمل
    // أبقِه في صفحة الدخول
  } catch (error) {
    console.warn('Could not determine user type:', error);
  }
});

// =============================================================
// 8. التهيئة
// =============================================================
initDarkMode();
setupPasswordToggles();
console.log('✅ portal-auth.js loaded');
