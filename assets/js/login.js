// =============================================================
// login.js — مُحدَّث مع توجيه الموظفين للوحتهم
// =============================================================
// التغيير: بعد تسجيل الدخول، يُوجّه المستخدم حسب نوعه:
// - مدير/محاسب → dashboard.html
// - مشرف/موظف → employee-dashboard.html
// - عميل (له وثيقة customers بـ uid) → portal-dashboard.html
// - بدون وثيقة → dashboard.html (يُنشئ وثيقته)
// =============================================================

import { auth, db } from './firebase-config.js';
import {
  signInWithEmailAndPassword, createUserWithEmailAndPassword,
  signInWithPopup, GoogleAuthProvider, sendPasswordResetEmail,
  onAuthStateChanged, updateProfile,
} from 'firebase/auth';
import { doc, setDoc, getDoc } from 'firebase/firestore';

// =============================================================
// دوال مساعدة (Toast)
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
      text: message, duration: 3000, gravity: 'bottom', position: 'left',
      style: { background: colors[type] || colors.info },
      className: 'rounded-3 shadow',
    }).showToast();
  } else {
    alert(message);
  }
}

// =============================================================
// الوضع المظلم
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
    const currentTheme = htmlElement.getAttribute('data-theme');
    if (currentTheme === 'dark') {
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
// تبديل إظهار/إخفاء كلمة المرور
// =============================================================
['toggleLoginPassword', 'toggleRegisterPassword', 'toggleRegisterConfirm'].forEach((id) => {
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

// =============================================================
// تسجيل الدخول
// =============================================================
document.getElementById('loginForm')?.addEventListener('submit', async (e) => {
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
// إنشاء حساب جديد (للموظفين — العميل يسجل من portal-login)
// =============================================================
document.getElementById('registerForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('registerName').value.trim();
  const email = document.getElementById('registerEmail').value.trim();
  const password = document.getElementById('registerPassword').value;
  const confirm = document.getElementById('registerConfirm').value;
  const errorDiv = document.getElementById('registerError');
  const btn = document.getElementById('registerBtn');

  errorDiv.style.display = 'none';
  errorDiv.textContent = '';

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
  btn.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>جاري...';

  try {
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;

    if (name) await updateProfile(user, { displayName: name });

    // إنشاء وثيقة المستخدم بدور موظف افتراضي
    await setDoc(doc(db, 'users', user.uid), {
      email: user.email,
      displayName: name || user.email,
      role: 'موظف',
      disabled: false,
      permissions: {}, // المدير يحدّد الصلاحيات لاحقًا
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    showToast('تم إنشاء الحساب! سيتم توجيهك للوحة الموظف.', 'success');
    // onAuthStateChanged سيتولى التوجيه
  } catch (error) {
    let msg = 'حدث خطأ أثناء التسجيل.';
    if (error.code === 'auth/email-already-in-use') msg = 'البريد الإلكتروني مستخدم بالفعل.';
    else if (error.code === 'auth/invalid-email') msg = 'البريد الإلكتروني غير صحيح.';
    else if (error.code === 'auth/weak-password') msg = 'كلمة المرور ضعيفة.';
    errorDiv.textContent = msg;
    errorDiv.style.display = 'block';
    showToast(msg, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-user-plus me-2"></i>إنشاء حساب';
  }
});

// =============================================================
// Google Sign-In
// =============================================================
const provider = new GoogleAuthProvider();

async function handleGoogleSignIn() {
  try {
    const result = await signInWithPopup(auth, provider);
    const user = result.user;

    const userDoc = await getDoc(doc(db, 'users', user.uid));
    if (!userDoc.exists()) {
      await setDoc(doc(db, 'users', user.uid), {
        email: user.email,
        displayName: user.displayName || user.email,
        role: 'موظف',
        disabled: false,
        permissions: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }
  } catch (error) {
    let msg = 'فشل تسجيل الدخول عبر Google.';
    if (error.code === 'auth/popup-closed-by-user') msg = 'تم إغلاق النافذة المنبثقة.';
    showToast(msg, 'error');
  }
}

document.getElementById('googleLoginBtn')?.addEventListener('click', handleGoogleSignIn);
document.getElementById('googleRegisterBtn')?.addEventListener('click', handleGoogleSignIn);

// =============================================================
// نسيت كلمة المرور
// =============================================================
document.getElementById('forgotPasswordLink')?.addEventListener('click', async (e) => {
  e.preventDefault();
  const { value: email } = await Swal.fire({
    title: 'استعادة كلمة المرور',
    input: 'email',
    inputLabel: 'أدخل بريدك الإلكتروني',
    inputPlaceholder: 'example@company.com',
    showCancelButton: true,
    confirmButtonText: 'إرسال',
    cancelButtonText: 'إلغاء',
    inputValidator: (value) => {
      if (!value) return 'يرجى إدخال البريد الإلكتروني';
    },
  });

  if (email) {
    try {
      await sendPasswordResetEmail(auth, email);
      showToast('تم إرسال رابط استعادة كلمة المرور.', 'success');
    } catch (error) {
      showToast('حدث خطأ.', 'error');
    }
  }
});

// =============================================================
// مراقبة المصادقة — التوجيه الذكي حسب نوع المستخدم
// =============================================================
onAuthStateChanged(auth, async (user) => {
  if (!user) return;

  try {
    // التحقق من نوع المستخدم
    const userDocSnap = await getDoc(doc(db, 'users', user.uid));

    if (userDocSnap.exists()) {
      const role = userDocSnap.data().role;

      // مدير أو محاسب → لوحة الإدارة
      if (role === 'مدير' || role === 'محاسب') {
        window.location.href = 'dashboard.html';
        return;
      }

      // مشرف أو موظف → لوحة الموظف
      if (role === 'مشرف' || role === 'موظف') {
        window.location.href = 'employee-dashboard.html';
        return;
      }

      // دور غير معروف → لوحة الإدارة (افتراضي)
      window.location.href = 'dashboard.html';
      return;
    }

    // ليس في users — تحقق من customers (عميل)
    const customerDocSnap = await getDoc(doc(db, 'customers', user.uid));
    if (customerDocSnap.exists()) {
      window.location.href = 'portal-dashboard.html';
      return;
    }

    // ليس في أي مجموعة — ابقِه في login (نادر)
    console.warn('User has no document in users or customers');
  } catch (error) {
    console.warn('Could not determine user type:', error);
    // في حال الخطأ، وجّه للوحة الإدارة كافتراضي
    window.location.href = 'dashboard.html';
  }
});

// =============================================================
// التهيئة
// =============================================================
initDarkMode();
console.log('✅ login.js loaded (with smart routing)');
