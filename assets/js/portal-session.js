import { db } from './firebase-config.js';
import { doc, getDoc } from 'firebase/firestore';

export async function ensureCustomerSession(user) {
  try {
    const userSnapshot = await getDoc(doc(db, 'users', user.uid));
    if (userSnapshot.exists() && userSnapshot.data().role) {
      window.location.replace('dashboard.html');
      return false;
    }

    const customerSnapshot = await getDoc(doc(db, 'customers', user.uid));
    if (!customerSnapshot.exists()) {
      window.location.replace('portal-login.html');
      return false;
    }

    return true;
  } catch (error) {
    console.error('Could not verify customer session:', error);
    window.location.replace('portal-login.html');
    return false;
  }
}