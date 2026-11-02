// =============================================================
// accounting.js — وحدة الحسابات الموحّدة
// =============================================================
// مصدر الحقيقة الوحيد (Single Source of Truth) لكل الأرقام المالية.
// كل من dashboard.js وreports.js وprofit-loss.js يستخدم هذه الوحدة
// لضمان تطابق الأرقام عبر كل اللوحات والتقارير.
//
// المبادئ:
// 1. الإيراد المحقق = مجموع طلبات الطلبات غير الملغاة
// 2. النقد المحصّل = مجموع المدفوعات المعتمدة فقط (status=approved)
// 3. المتبقي = الإيراد المحقق - النقد المحصّل
// 4. صافي الربح = الإيراد - المصروفات - تعويضات الموظفين
// 5. رصيد الخزينة = الإيداعات - السحوبات + التحويلات
// =============================================================

import { db } from './firebase-config.js';
import {
  collection, getDocs, query, where,
} from 'firebase/firestore';

// =============================================================
// 1. جلب كل البيانات المالية دفعة واحدة (تقليل القراءات)
// =============================================================
async function fetchAllData() {
  const [
    ordersSnap, paymentsSnap, expensesSnap,
    treasurySnap, ledgerSnap, invoicesSnap,
  ] = await Promise.all([
    getDocs(collection(db, 'orders')),
    getDocs(collection(db, 'payments')),
    getDocs(collection(db, 'expenses')),
    getDocs(collection(db, 'treasury')),
    getDocs(collection(db, 'employeeLedger')),
    getDocs(collection(db, 'invoices')),
  ]);

  const parseDate = (val) => {
    if (!val) return null;
    if (val.toDate && typeof val.toDate === 'function') return val.toDate();
    if (val instanceof Date) return val;
    if (typeof val === 'string') return new Date(val);
    return null;
  };

  return {
    orders: ordersSnap.docs.map((d) => ({
      id: d.id, ...d.data(),
      createdAt: parseDate(d.data().createdAt),
    })),
    payments: paymentsSnap.docs.map((d) => ({
      id: d.id, ...d.data(),
      paymentDate: parseDate(d.data().paymentDate),
      createdAt: parseDate(d.data().createdAt),
    })),
    expenses: expensesSnap.docs.map((d) => ({
      id: d.id, ...d.data(),
      date: parseDate(d.data().date),
      createdAt: parseDate(d.data().createdAt),
    })),
    treasury: treasurySnap.docs.map((d) => ({
      id: d.id, ...d.data(),
      createdAt: parseDate(d.data().createdAt),
      date: parseDate(d.data().date),
    })),
    employeeLedger: ledgerSnap.docs.map((d) => ({
      id: d.id, ...d.data(),
      createdAt: parseDate(d.data().createdAt),
    })),
    invoices: invoicesSnap.docs.map((d) => ({
      id: d.id, ...d.data(),
      createdAt: parseDate(d.data().createdAt),
    })),
  };
}

// =============================================================
// 2. فلترة بالمدى الزمني
// =============================================================
function filterByDate(items, dateField, from, to) {
  if (!from && !to) return items;
  return items.filter((item) => {
    const date = item[dateField];
    if (!date) return false;
    if (from && date < from) return false;
    if (to && date > to) return false;
    return true;
  });
}

// =============================================================
// 3. الدالة الرئيسية: حساب الملخص المالي الكامل
// =============================================================
export async function computeFinancialSummary(dateFrom, dateTo) {
  const data = await fetchAllData();

  const from = dateFrom ? new Date(dateFrom) : null;
  const to = dateTo ? new Date(dateTo) : null;
  if (to) to.setHours(23, 59, 59, 999);

  // فلترة بالمدى الزمني
  const orders = filterByDate(data.orders, 'createdAt', from, to);
  const payments = filterByDate(data.payments, 'paymentDate', from, to);
  const expenses = filterByDate(data.expenses, 'date', from, to);
  const treasuryTx = filterByDate(data.treasury, 'date', from, to);
  const ledgerEntries = filterByDate(data.employeeLedger, 'createdAt', from, to);

  // =============================================================
  // الإيرادات
  // =============================================================
  const activeOrders = orders.filter((o) => o.status !== 'ملغي');
  const earnedRevenue = activeOrders.reduce((sum, o) => sum + (o.total || 0), 0);
  const discountsTotal = activeOrders.reduce((sum, o) => sum + (o.discount || 0), 0);

  // =============================================================
  // النقد المحصّل (المدفوعات المعتمدة فقط)
  // =============================================================
  const approvedPayments = payments.filter(
    (p) => !p.status || p.status === 'approved'
  );
  const pendingPayments = payments.filter((p) => p.status === 'pending');
  const rejectedPayments = payments.filter((p) => p.status === 'rejected');

  const collectedCash = approvedPayments.reduce((sum, p) => sum + (p.amount || 0), 0);
  const pendingCash = pendingPayments.reduce((sum, p) => sum + (p.amount || 0), 0);

  // المتبقي = الإيراد المحقق - النقد المحصّل
  const outstandingReceivables = earnedRevenue - collectedCash;

  // الإيراد حسب الخدمة
  const revenueByService = {};
  activeOrders.forEach((o) => {
    const sid = o.serviceId || 'unknown';
    revenueByService[sid] = (revenueByService[sid] || 0) + (o.total || 0);
  });

  // =============================================================
  // المصروفات
  // =============================================================
  const totalExpenses = expenses.reduce((sum, e) => sum + (e.amount || 0), 0);

  const expenseCategories = {
    operating: 'تشغيلية',
    marketing: 'تسويق',
    software: 'برمجيات',
    hosting: 'استضافة وبنية',
    salaries: 'رواتب',
    task_payments: 'مدفوعات مهام',
    utilities: 'مرافق',
    rent: 'إيجار',
    other: 'أخرى',
  };

  const expensesByCategory = {};
  expenses.forEach((e) => {
    const cat = e.category || 'other';
    expensesByCategory[cat] = (expensesByCategory[cat] || 0) + (e.amount || 0);
  });

  // =============================================================
  // تعويضات الموظفين (من employeeLedger)
  // =============================================================
  const approvedLedger = ledgerEntries.filter((e) => e.status === 'approved');

  const earningsTotal = approvedLedger
    .filter((e) => e.type === 'earning')
    .reduce((sum, e) => sum + (e.amount || 0), 0);

  const bonusesTotal = approvedLedger
    .filter((e) => e.type === 'bonus')
    .reduce((sum, e) => sum + (e.amount || 0), 0);

  const deductionsTotal = approvedLedger
    .filter((e) => e.type === 'deduction')
    .reduce((sum, e) => sum + (e.amount || 0), 0);

  const payoutsTotal = approvedLedger
    .filter((e) => e.type === 'payout')
    .reduce((sum, e) => sum + (e.amount || 0), 0);

  // إجمالي التعويضات = أرباح + مكافآت - خصومات
  const employeeCompensation = earningsTotal + bonusesTotal - deductionsTotal;

  // مستحقات الموظفين غير المدفوعة = التعويض - المدفوع
  const employeeLiabilities = employeeCompensation - payoutsTotal;

  // =============================================================
  // الخزينة
  // =============================================================
  const deposits = treasuryTx
    .filter((t) => t.type === 'deposit')
    .reduce((sum, t) => sum + (t.amount || 0), 0);

  const withdrawals = treasuryTx
    .filter((t) => t.type === 'withdraw')
    .reduce((sum, t) => sum + (t.amount || 0), 0);

  const transfers = treasuryTx
    .filter((t) => t.type === 'transfer')
    .reduce((sum, t) => sum + (t.amount || 0), 0);

  const cashBalance = deposits - withdrawals + transfers;

  // =============================================================
  // الأرباح
  // =============================================================
  // إجمالي التكاليف = المصروفات + التعويضات
  const totalCosts = totalExpenses + employeeCompensation;

  // صافي الربح = الإيراد - التكاليف
  const netProfit = earnedRevenue - totalCosts;

  // هامش الربح
  const profitMargin = earnedRevenue > 0
    ? (netProfit / earnedRevenue) * 100
    : 0;

  // =============================================================
  // النتيجة الكاملة
  // =============================================================
  return {
    // الإيرادات
    earnedRevenue,
    collectedCash,
    pendingCash,
    outstandingReceivables,
    discountsTotal,
    revenueByService,

    // المصروفات
    totalExpenses,
    expensesByCategory,
    expenseCategories,

    // الموظفون
    earningsTotal,
    bonusesTotal,
    deductionsTotal,
    payoutsTotal,
    employeeCompensation,
    employeeLiabilities,

    // الخزينة
    deposits,
    withdrawals,
    transfers,
    cashBalance,

    // الأرباح
    totalCosts,
    netProfit,
    profitMargin,

    // الإحصائيات
    ordersCount: orders.length,
    activeOrdersCount: activeOrders.length,
    cancelledOrdersCount: orders.filter((o) => o.status === 'ملغي').length,
    pendingPaymentsCount: pendingPayments.length,
    approvedPaymentsCount: approvedPayments.length,
    rejectedPaymentsCount: rejectedPayments.length,
    expensesCount: expenses.length,

    // الفترة
    dateFrom: from,
    dateTo: to,
  };
}

// =============================================================
// 4. حساب مقارنة بين فترتين
// =============================================================
export async function computeComparison(days = 30) {
  const now = new Date();
  now.setHours(23, 59, 59, 999);

  const currentFrom = new Date(now);
  currentFrom.setDate(currentFrom.getDate() - days);
  currentFrom.setHours(0, 0, 0, 0);

  const prevFrom = new Date(currentFrom);
  prevFrom.setDate(prevFrom.getDate() - days);

  const prevTo = new Date(currentFrom);
  prevTo.setMilliseconds(-1);

  const [current, previous] = await Promise.all([
    computeFinancialSummary(currentFrom, now),
    computeFinancialSummary(prevFrom, prevTo),
  ]);

  return {
    current,
    previous,
    change: computeChange(current, previous),
  };
}

function computeChange(current, previous) {
  const calc = (c, p) => {
    if (p === 0) return c > 0 ? 100 : 0;
    return ((c - p) / p) * 100;
  };

  return {
    earnedRevenue: calc(current.earnedRevenue, previous.earnedRevenue),
    collectedCash: calc(current.collectedCash, previous.collectedCash),
    totalExpenses: calc(current.totalExpenses, previous.totalExpenses),
    netProfit: calc(current.netProfit, previous.netProfit),
    ordersCount: calc(current.ordersCount, previous.ordersCount),
    expensesCount: calc(current.expensesCount, previous.expensesCount),
  };
}

// =============================================================
// 5. دوال مساعدة للعرض
// =============================================================
export function formatCurrency(amount, currency = '$') {
  if (amount === undefined || amount === null || isNaN(amount)) return `${currency}0.00`;
  const sign = amount < 0 ? '-' : '';
  return `${sign}${currency}${Math.abs(amount).toFixed(2)}`;
}

export function formatPercent(value, decimals = 1) {
  if (value === undefined || value === null || isNaN(value)) return '0%';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(decimals)}%`;
}

export function formatDate(date) {
  if (!date) return '-';
  if (date.toDate && typeof date.toDate === 'function') date = date.toDate();
  if (date instanceof Date) return date.toISOString().slice(0, 10);
  if (typeof date === 'string') return date.slice(0, 10);
  return '-';
}

// =============================================================
// 6. تصدير فئات المصروفات للقوائم المنسدلة
// =============================================================
export const EXPENSE_CATEGORIES = [
  { value: 'operating', label: 'تشغيلية' },
  { value: 'marketing', label: 'تسويق' },
  { value: 'software', label: 'برمجيات واشتراكات' },
  { value: 'hosting', label: 'استضافة وبنية تحتية' },
  { value: 'salaries', label: 'رواتب ثابتة' },
  { value: 'task_payments', label: 'مدفوعات مهام' },
  { value: 'utilities', label: 'مرافق (كهرباء/إنترنت)' },
  { value: 'rent', label: 'إيجار' },
  { value: 'other', label: 'أخرى' },
];

// =============================================================
// 7. تصدير أنواع دفتر الأستاذ
// =============================================================
export const LEDGER_TYPES = [
  { value: 'earning', label: 'ربح مهمة', sign: '+', color: 'success' },
  { value: 'bonus', label: 'مكافأة', sign: '+', color: 'info' },
  { value: 'deduction', label: 'خصم', sign: '-', color: 'danger' },
  { value: 'payout', label: 'دفعة مدفوعة', sign: '-', color: 'primary' },
];

console.log('✅ accounting.js loaded — unified financial calculations ready');
