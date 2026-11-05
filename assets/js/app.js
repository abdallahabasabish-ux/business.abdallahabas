import { AuthService } from './core/app-core.js';
import { routeByRole } from './core/portal-guard.js';

const currentPage = window.location.pathname.split('/').pop() || 'index.html';

if (currentPage === 'index.html') {
    AuthService.onStateChanged(async (user) => {
        if (!user) {
            window.location.replace('login.html');
            return;
        }

        try {
            window.location.replace(await routeByRole(user));
        } catch (error) {
            console.error('Could not route authenticated user:', error);
            window.location.replace('login.html');
        }
    });
}

// ============================================
//  دوال مساعدة آمنة - أضفها في أعلى app.js
// ============================================

/**
 * تحديث textContent بأمان (يتجنب الخطأ إذا كان العنصر غير موجود)
 */
function safeSetText(elementId, text) {
    const element = document.getElementById(elementId);
    if (element) {
        element.textContent = text;
        return true;
    }
    // تسجيل تحذير فقط في وضع التطوير
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
        console.warn(`⚠️ Element with id="${elementId}" not found in DOM`);
    }
    return false;
}

/**
 * تحديث innerHTML بأمان
 */
function safeSetHTML(elementId, html) {
    const element = document.getElementById(elementId);
    if (element) {
        element.innerHTML = html;
        return true;
    }
    return false;
}

/**
 * تحديث قيمة input بأمان
 */
function safeSetValue(elementId, value) {
    const element = document.getElementById(elementId);
    if (element) {
        element.value = value;
        return true;
    }
    return false;
}

/**
 * إظهار/إخفاء عنصر بأمان
 */
function safeToggle(elementId, show) {
    const element = document.getElementById(elementId);
    if (element) {
        element.style.display = show ? '' : 'none';
        return true;
    }
    return false;
}
