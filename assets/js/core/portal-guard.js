import { auth } from '../firebase-config.js';
import { AuthService } from './app-core.js';

export const PORTAL_ROUTES = Object.freeze({
  admin: { home: '/admin/', login: '/login.html' },
  accountant: { home: '/admin/', login: '/login.html' },
  employee: { home: '/employee/', login: '/login.html' },
  client: { home: '/client/', login: '/client/login.html' },
});

function normalizedPortal(role) {
  if (role === 'admin' || role === 'accountant' || role === 'مدير' || role === 'محاسب') return 'admin';
  if (role === 'employee' || role === 'مشرف' || role === 'موظف') return 'employee';
  if (role === 'client' || role === 'عميل') return 'client';
  return null;
}

export async function resolvePortal(user = auth.currentUser) {
  const identity = await AuthService.getIdentity(user);
  const portal = normalizedPortal(identity?.role);
  return identity && portal ? { user, identity, portal } : null;
}

export function guardPortal(expectedPortal, onAuthorized = () => {}) {
  return AuthService.onStateChanged(async (user) => {
    if (!user) {
      window.location.replace(PORTAL_ROUTES[expectedPortal]?.login || '/login.html');
      return;
    }

    try {
      const session = await resolvePortal(user);
      if (!session) {
        await AuthService.signOut();
        window.location.replace('/login.html');
        return;
      }

      if (session.portal !== expectedPortal) {
        window.location.replace(PORTAL_ROUTES[session.portal].home);
        return;
      }

      onAuthorized(session);
    } catch (error) {
      console.error('Portal route guard failed:', error);
      window.location.replace(PORTAL_ROUTES[expectedPortal]?.login || '/login.html');
    }
  });
}

export function routeByRole(user = auth.currentUser) {
  return resolvePortal(user).then((session) => {
    if (!session) return '/login.html';
    return PORTAL_ROUTES[session.portal].home;
  });
}

export function installGlobalRouteGuard() {
  const portal = document.body?.dataset.portal;
  if (!portal || !PORTAL_ROUTES[portal]) return () => {};
  return guardPortal(portal);
}