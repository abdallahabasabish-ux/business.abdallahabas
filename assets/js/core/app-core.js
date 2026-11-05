import { auth, db, storage, app } from '../firebase-config.js';
import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  onAuthStateChanged,
  sendPasswordResetEmail,
  setPersistence,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
  browserLocalPersistence,
} from 'firebase/auth';
import {
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  writeBatch,
} from 'firebase/firestore';
import { createNotification, subscribeUnreadCount } from '../notification-helper.js';

const LEGACY_ROLES = {
  'مدير': 'admin',
  'محاسب': 'accountant',
  'مشرف': 'employee',
  'موظف': 'employee',
  'عميل': 'client',
};

export const FirebaseInit = Object.freeze({ app, auth, db, storage });

export const AuthService = Object.freeze({
  signIn(email, password) {
    return signInWithEmailAndPassword(auth, email.trim(), password);
  },

  signInWithGoogle() {
    return signInWithPopup(auth, new GoogleAuthProvider());
  },

  signOut() {
    return signOut(auth);
  },

  sendPasswordReset(email) {
    return sendPasswordResetEmail(auth, email.trim());
  },

  onStateChanged(callback) {
    return onAuthStateChanged(auth, callback);
  },

  setLocalPersistence() {
    return setPersistence(auth, browserLocalPersistence);
  },

  async registerClient({ email, password, name, phone }) {
    const credential = await createUserWithEmailAndPassword(auth, email.trim(), password);
    const user = credential.user;
    await updateProfile(user, { displayName: name.trim() });
    await setDoc(doc(db, 'customers', user.uid), {
      uid: user.uid,
      name: name.trim(),
      email: user.email,
      phone: phone.trim(),
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
    return user;
  },

  async registerEmployee({ email, password, name }) {
    const credential = await createUserWithEmailAndPassword(auth, email.trim(), password);
    const user = credential.user;
    await updateProfile(user, { displayName: name.trim() });
    const now = new Date().toISOString();

    const batch = writeBatch(db);
    batch.set(doc(db, 'users', user.uid), {
      email: user.email,
      displayName: name.trim(),
      role: 'موظف',
      disabled: false,
      employeeId: user.uid,
      permissions: {},
      createdAt: now,
      updatedAt: now,
    });
    batch.set(doc(db, 'employees', user.uid), {
      uid: user.uid,
      email: user.email,
      name: name.trim(),
      position: 'بانتظار التحديد',
      phone: '',
      status: 'بانتظار التفعيل',
      orderCount: 0,
      completionRate: 0,
      createdAt: now,
      updatedAt: now,
    });
    await batch.commit();
    return user;
  },

  async ensureEmployeeProfile(user) {
    const userRef = doc(db, 'users', user.uid);
    const existing = await getDoc(userRef);
    if (existing.exists()) return existing.data();

    const displayName = user.displayName || user.email;
    const now = new Date().toISOString();
    const batch = writeBatch(db);
    batch.set(userRef, {
      email: user.email,
      displayName,
      role: 'موظف',
      disabled: false,
      employeeId: user.uid,
      permissions: {},
      createdAt: now,
      updatedAt: now,
    });
    batch.set(doc(db, 'employees', user.uid), {
      uid: user.uid,
      email: user.email,
      name: displayName,
      position: 'بانتظار التحديد',
      phone: '',
      status: 'بانتظار التفعيل',
      orderCount: 0,
      completionRate: 0,
      createdAt: now,
      updatedAt: now,
    });
    await batch.commit();
    return { uid: user.uid, email: user.email, role: 'موظف', displayName };
  },

  async getIdentity(user = auth.currentUser, { forceRefresh = false } = {}) {
    if (!user) return null;

    const token = await user.getIdTokenResult(forceRefresh);
    const claimRole = token.claims.role
      || (token.claims.admin === true ? 'admin' : null)
      || (token.claims.employee === true ? 'employee' : null)
      || (token.claims.client === true ? 'client' : null);
    const profileSnapshot = await getDoc(doc(db, 'users', user.uid));

    if (profileSnapshot.exists()) {
      const profile = profileSnapshot.data();
      if (profile.disabled === true) return null;
      const role = claimRole || LEGACY_ROLES[profile.role] || profile.role;
      return { uid: user.uid, email: user.email, ...profile, role, claims: token.claims };
    }

    const customerSnapshot = await getDoc(doc(db, 'customers', user.uid));
    if (customerSnapshot.exists()) {
      return {
        uid: user.uid,
        email: user.email,
        role: claimRole || 'client',
        profile: customerSnapshot.data(),
        claims: token.claims,
      };
    }

    return claimRole ? { uid: user.uid, email: user.email, role: claimRole, claims: token.claims } : null;
  },
});

export const NotificationService = Object.freeze({
  create: createNotification,
  subscribeUnreadCount,
});

function escapeHtml(value) {
  const element = document.createElement('span');
  element.textContent = String(value ?? '');
  return element.innerHTML;
}

function toast(message, type = 'info') {
  if (typeof Toastify === 'undefined') return;
  const colors = {
    success: '#16845b',
    error: '#b42318',
    warning: '#9a6700',
    info: '#175cd3',
  };
  Toastify({
    text: String(message ?? ''),
    duration: 3500,
    gravity: 'bottom',
    position: 'left',
    style: { background: colors[type] || colors.info },
  }).showToast();
}

export const UIEngine = Object.freeze({
  escapeHtml,
  toast,
  setText(element, value) {
    if (element) element.textContent = String(value ?? '');
  },
  renderEmptyState(container, message) {
    if (!container) return;
    const paragraph = document.createElement('p');
    paragraph.className = 'app-empty-state';
    paragraph.textContent = message;
    container.replaceChildren(paragraph);
  },
  async run(operation, { onError, fallback } = {}) {
    try {
      return await operation();
    } catch (error) {
      console.error(error);
      onError?.(error);
      if (fallback !== undefined) return fallback;
      throw error;
    }
  },
});

export { serverTimestamp };