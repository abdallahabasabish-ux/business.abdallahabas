import { AuthService } from './core/app-core.js';
import { PORTAL_ROUTES, resolvePortal } from './core/portal-guard.js';

export async function ensureCustomerSession(user) {
  try {
    const session = await resolvePortal(user);
    if (!session) return false;
    if (session.portal !== 'client') {
      window.location.replace(PORTAL_ROUTES[session.portal].home);
      return false;
    }
    return true;
  } catch (error) {
    console.error('Could not verify customer session:', error);
    if (!user) await AuthService.signOut();
    window.location.replace('portal-login.html');
    return false;
  }
}