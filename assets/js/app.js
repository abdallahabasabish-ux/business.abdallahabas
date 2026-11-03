import { onAuthStateChangedCallback } from './auth.js';
import { db } from './firebase-config.js';
import { doc, getDoc } from 'firebase/firestore';

const currentPage = window.location.pathname.split('/').pop() || 'index.html';

if (currentPage === 'index.html') {
    onAuthStateChangedCallback(async (user) => {
        if (!user) {
            window.location.replace('login.html');
            return;
        }

        try {
            const userSnapshot = await getDoc(doc(db, 'users', user.uid));
            if (userSnapshot.exists()) {
                const role = userSnapshot.data().role;
                const destination = ['مشرف', 'موظف'].includes(role)
                    ? 'employee-dashboard.html'
                    : 'dashboard.html';
                window.location.replace(destination);
                return;
            }

            const customerSnapshot = await getDoc(doc(db, 'customers', user.uid));
            window.location.replace(
                customerSnapshot.exists() ? 'portal-dashboard.html' : 'login.html'
            );
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
