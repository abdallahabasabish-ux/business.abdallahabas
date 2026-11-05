import { AuthService, UIEngine } from './app-core.js';

function createLink({ href, label, active = false }) {
  const link = document.createElement('a');
  link.href = href;
  link.textContent = label;
  if (active) link.setAttribute('aria-current', 'page');
  return link;
}

export const PortalLayoutEngine = Object.freeze({
  mount({ root, portal, identity, title, links = [], content } = {}) {
    const target = typeof root === 'string' ? document.querySelector(root) : root;
    if (!target) throw new Error('Portal layout root was not found.');

    const shell = document.createElement('div');
    shell.className = `portal-shell portal-shell--${portal}`;

    const header = document.createElement('header');
    header.className = 'portal-header';
    const heading = document.createElement('h1');
    heading.textContent = title;

    const userLabel = document.createElement('span');
    userLabel.className = 'portal-user-label';
    userLabel.textContent = identity?.displayName || identity?.name || identity?.email || '';

    const logout = document.createElement('button');
    logout.type = 'button';
    logout.className = 'portal-logout';
    logout.textContent = 'تسجيل الخروج';
    logout.addEventListener('click', async () => {
      await UIEngine.run(() => AuthService.signOut(), {
        onError: () => UIEngine.toast('تعذر تسجيل الخروج', 'error'),
      });
      window.location.replace(portal === 'client' ? '/client/login.html' : '/login.html');
    });

    header.append(heading, userLabel, logout);

    const navigation = document.createElement('nav');
    navigation.className = 'portal-navigation';
    navigation.setAttribute('aria-label', 'التنقل الرئيسي');
    links.forEach((link) => navigation.append(createLink(link)));

    const main = document.createElement('main');
    main.className = 'portal-content';
    if (content instanceof Node) main.append(content);

    shell.append(header, navigation, main);
    target.replaceChildren(shell);
    return { shell, header, navigation, main };
  },

  createSkeleton(rows = 4) {
    const container = document.createElement('div');
    container.className = 'portal-skeleton-list';
    for (let index = 0; index < rows; index += 1) {
      const item = document.createElement('div');
      item.className = 'portal-skeleton';
      item.setAttribute('aria-hidden', 'true');
      container.append(item);
    }
    return container;
  },

  createEmptyState(message) {
    const empty = document.createElement('div');
    empty.className = 'portal-empty-state';
    empty.setAttribute('role', 'status');
    empty.textContent = message;
    return empty;
  },
});