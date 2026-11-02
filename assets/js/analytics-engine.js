// =============================================================
// analytics-engine.js — محرك التحليلات المتقدم
// =============================================================
// دوال حسابية للتحليلات: معدلات النمو، الاتجاهات، التوقعات
// التوقعات شفافة: مبنية على بيانات تاريخية، مُعلَّمة كتقديرات
// =============================================================

import { db } from './firebase-config.js';
import { collection, getDocs } from 'firebase/firestore';
import { computeFinancialSummary, formatCurrency, formatDate } from './accounting.js';

// =============================================================
// 1. معدل النمو
// =============================================================
export function computeGrowthRate(current, previous) {
  if (previous === 0 || previous === undefined || previous === null) {
    return current > 0 ? 100 : 0;
  }
  return ((current - previous) / Math.abs(previous)) * 100;
}

// =============================================================
// 2. الانحدار الخطي (للاتجاه والتوقع)
// =============================================================
export function linearRegression(values) {
  const n = values.length;
  if (n < 2) return null;

  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (let i = 0; i < n; i++) {
    const x = i;
    const y = values[i];
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumX2 += x * x;
  }

  const denominator = n * sumX2 - sumX * sumX;
  if (denominator === 0) return null;

  const slope = (n * sumXY - sumX * sumY) / denominator;
  const intercept = (sumY - slope * sumX) / n;

  // معامل التحديد R² لقياس جودة الملاءمة
  const meanY = sumY / n;
  let ssRes = 0, ssTot = 0;
  for (let i = 0; i < n; i++) {
    const predicted = slope * i + intercept;
    ssRes += Math.pow(values[i] - predicted, 2);
    ssTot += Math.pow(values[i] - meanY, 2);
  }
  const rSquared = ssTot === 0 ? 1 : 1 - (ssRes / ssTot);

  return { slope, intercept, rSquared };
}

// =============================================================
// 3. التوقع (Forecast) — شفاف ومُعلَّم كتقدير
// =============================================================
export function forecastValues(historicalValues, periodsToForecast = 3) {
  const MIN_DATA_POINTS = 3;

  if (!historicalValues || historicalValues.length < MIN_DATA_POINTS) {
    return {
      available: false,
      reason: `البيانات التاريخية غير كافية للتوقع (يلزم ${MIN_DATA_POINTS} نقاط على الأقل، المتوفر: ${historicalValues?.length || 0})`,
      values: [],
      trend: 'unknown',
      confidence: 'low',
    };
  }

  const reg = linearRegression(historicalValues);
  if (!reg) {
    return {
      available: false,
      reason: 'تعذّر حساب الاتجاه من البيانات المتاحة',
      values: [],
      trend: 'unknown',
      confidence: 'low',
    };
  }

  const forecast = [];
  for (let i = 0; i < periodsToForecast; i++) {
    const x = historicalValues.length + i;
    const y = reg.slope * x + reg.intercept;
    forecast.push(Math.max(0, y)); // لا قيم سالبة للأرقام المالية
  }

  const trend = reg.slope > 0.01 ? 'growing' : reg.slope < -0.01 ? 'declining' : 'stable';
  const confidence = reg.rSquared > 0.7 ? 'high' : reg.rSquared > 0.4 ? 'medium' : 'low';

  return {
    available: true,
    values: forecast,
    slope: reg.slope,
    rSquared: reg.rSquared,
    trend,
    confidence,
    historicalPeriod: `${historicalValues.length} فترات`,
    notice: 'تقدير مبني على البيانات التاريخية — ليس نتيجة مضمونة',
  };
}

// =============================================================
// 4. تجميع البيانات حسب الفترة
// =============================================================
export function aggregateByPeriod(data, dateField, valueField, periodType = 'month') {
  const buckets = {};

  for (const item of data) {
    const date = parseDate(item[dateField]);
    if (!date) continue;

    const key = getPeriodKey(date, periodType);
    if (!buckets[key]) {
      buckets[key] = { period: key, count: 0, sum: 0, date: new Date(date) };
    }
    buckets[key].count++;
    buckets[key].sum += item[valueField] || 0;
  }

  return Object.values(buckets).sort((a, b) => a.period.localeCompare(b.period));
}

function parseDate(val) {
  if (!val) return null;
  if (val.toDate && typeof val.toDate === 'function') return val.toDate();
  if (val instanceof Date) return val;
  if (typeof val === 'string' || typeof val === 'number') {
    const d = new Date(val);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function getPeriodKey(date, type) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');

  switch (type) {
    case 'day': return `${y}-${m}-${d}`;
    case 'week': {
      const onejan = new Date(y, 0, 1);
      const week = Math.ceil(((date - onejan) / 86400000 + onejan.getDay() + 1) / 7);
      return `${y}-W${String(week).padStart(2, '0')}`;
    }
    case 'month': return `${y}-${m}`;
    case 'quarter': return `${y}-Q${Math.floor(date.getMonth() / 3) + 1}`;
    case 'year': return `${y}`;
    default: return `${y}-${m}`;
  }
}

// =============================================================
// 5. قمع التحويل (Conversion Funnel)
// =============================================================
export function computeConversionFunnel(inquiries, orders) {
  const totalInquiries = inquiries.length;
  const convertedInquiries = inquiries.filter((i) => i.status === 'converted').length;
  const totalOrders = orders.length;
  const completedOrders = orders.filter((o) => o.status === 'مكتمل').length;
  const cancelledOrders = orders.filter((o) => o.status === 'ملغي').length;

  return {
    inquiries: totalInquiries,
    convertedToOrders: convertedInquiries,
    inquiryToOrderRate: totalInquiries > 0 ? (convertedInquiries / totalInquiries) * 100 : 0,
    orders: totalOrders,
    completedOrders,
    cancelledOrders,
    completionRate: totalOrders > 0 ? (completedOrders / totalOrders) * 100 : 0,
    cancellationRate: totalOrders > 0 ? (cancelledOrders / totalOrders) * 100 : 0,
  };
}

// =============================================================
// 6. معدل احتفاظ العملاء (Retention)
// =============================================================
export function computeRetentionRate(customers, orders, periodDays = 30) {
  const now = new Date();
  const periodAgo = new Date(now);
  periodAgo.setDate(periodAgo.getDate() - periodDays);
  const twoPeriodsAgo = new Date(now);
  twoPeriodsAgo.setDate(twoPeriodsAgo.getDate() - periodDays * 2);

  // العملاء النشطون في الفترة السابقة (قاموا بطلب بين periodAgo و twoPeriodsAgo)
  const previousPeriodCustomers = new Set();
  orders.forEach((o) => {
    const date = parseDate(o.createdAt);
    if (date && date >= twoPeriodsAgo && date < periodAgo && o.customerId) {
      previousPeriodCustomers.add(o.customerId);
    }
  });

  // منهم من عاد للطلب في الفترة الحالية
  const currentPeriodCustomers = new Set();
  orders.forEach((o) => {
    const date = parseDate(o.createdAt);
    if (date && date >= periodAgo && o.customerId) {
      currentPeriodCustomers.add(o.customerId);
    }
  });

  const retained = [...previousPeriodCustomers].filter((c) => currentPeriodCustomers.has(c)).length;
  const retentionRate = previousPeriodCustomers.size > 0
    ? (retained / previousPeriodCustomers.size) * 100
    : 0;

  return {
    previousPeriodCustomers: previousPeriodCustomers.size,
    currentPeriodCustomers: currentPeriodCustomers.size,
    retainedCustomers: retained,
    retentionRate,
    newCustomers: currentPeriodCustomers.size - retained,
  };
}

// =============================================================
// 7. تحليل ربحية الخدمات
// =============================================================
export function computeServiceProfitability(orders, expenses, ledgerEntries, services) {
  const serviceMap = {};
  services.forEach((s) => {
    serviceMap[s.id] = {
      serviceId: s.id,
      serviceName: s.name,
      category: s.category || '-',
      orderCount: 0,
      revenue: 0,
      directCosts: 0,
      compensation: 0,
      profit: 0,
      margin: 0,
    };
  });

  // الإيراد وعدد الطلبات لكل خدمة
  orders.forEach((o) => {
    if (!o.serviceId || o.status === 'ملغي') return;
    if (!serviceMap[o.serviceId]) {
      serviceMap[o.serviceId] = {
        serviceId: o.serviceId,
        serviceName: 'غير معروف',
        category: '-',
        orderCount: 0, revenue: 0, directCosts: 0, compensation: 0, profit: 0, margin: 0,
      };
    }
    serviceMap[o.serviceId].orderCount++;
    serviceMap[o.serviceId].revenue += o.total || 0;
  });

  // تعويضات الموظفين المرتبطة بالخدمة (عبر الطلبات)
  const orderToService = {};
  orders.forEach((o) => {
    if (o.serviceId) orderToService[o.id] = o.serviceId;
  });

  ledgerEntries.forEach((e) => {
    if (e.status !== 'approved') return;
    if (e.type !== 'earning' && e.type !== 'bonus') return;
    if (e.orderId && orderToService[e.orderId]) {
      const sid = orderToService[e.orderId];
      if (serviceMap[sid]) {
        serviceMap[sid].compensation += e.amount || 0;
      }
    }
  });

  // المصروفات المرتبطة بالخدمة (عبر الطلبات)
  expenses.forEach((e) => {
    if (e.orderId && orderToService[e.orderId]) {
      const sid = orderToService[e.orderId];
      if (serviceMap[sid]) {
        serviceMap[sid].directCosts += e.amount || 0;
      }
    }
  });

  // حساب الربح والهامش
  Object.values(serviceMap).forEach((s) => {
    s.profit = s.revenue - s.directCosts - s.compensation;
    s.margin = s.revenue > 0 ? (s.profit / s.revenue) * 100 : 0;
  });

  return Object.values(serviceMap)
    .filter((s) => s.orderCount > 0)
    .sort((a, b) => b.revenue - a.revenue);
}

// =============================================================
// 8. أداء الموظفين
// =============================================================
export async function computeEmployeePerformance(dateFrom, dateTo) {
  const [tasksSnap, ledgerSnap, employeesSnap] = await Promise.all([
    getDocs(collection(db, 'tasks')),
    getDocs(collection(db, 'employeeLedger')),
    getDocs(collection(db, 'employees')),
  ]);

  const employees = employeesSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  let tasks = tasksSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  let ledger = ledgerSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

  // فلترة بالمدى الزمني
  const from = dateFrom ? new Date(dateFrom) : null;
  const to = dateTo ? new Date(dateTo) : null;
  if (to) to.setHours(23, 59, 59, 999);

  tasks = tasks.filter((t) => {
    const d = parseDate(t.createdAt);
    if (!d) return false;
    if (from && d < from) return false;
    if (to && d > to) return false;
    return true;
  });

  ledger = ledger.filter((e) => {
    const d = parseDate(e.createdAt);
    if (!d) return false;
    if (from && d < from) return false;
    if (to && d > to) return false;
    return true;
  });

  return employees.map((emp) => {
    const uid = emp.uid || emp.id;
    const empTasks = tasks.filter(
      (t) => t.assignedEmployeeIds && t.assignedEmployeeIds.includes(uid)
    );

    const assigned = empTasks.length;
    const completed = empTasks.filter((t) => t.status === 'completed').length;
    const inProgress = empTasks.filter((t) => t.status === 'in_progress').length;
    const rejected = empTasks.filter((t) => t.status === 'rejected').length;
    const overdue = empTasks.filter((t) => {
      if (['completed', 'cancelled'].includes(t.status)) return false;
      const d = parseDate(t.deadline);
      return d && d < new Date();
    }).length;

    // متوسط وقت الإنجاز
    const completedTasks = empTasks.filter((t) => t.status === 'completed' && t.completedAt);
    let avgCompletionDays = 0;
    if (completedTasks.length > 0) {
      const totalDays = completedTasks.reduce((sum, t) => {
        const created = parseDate(t.createdAt);
        const completed = parseDate(t.completedAt);
        if (created && completed) {
          return sum + (completed - created) / (1000 * 60 * 60 * 24);
        }
        return sum;
      }, 0);
      avgCompletionDays = totalDays / completedTasks.length;
    }

    // المستحقات
    const empLedger = ledger.filter((e) => e.employeeId === emp.id || e.employeeUid === uid);
    const earnings = empLedger
      .filter((e) => e.status === 'approved' && e.type === 'earning')
      .reduce((s, e) => s + (e.amount || 0), 0);
    const bonuses = empLedger
      .filter((e) => e.status === 'approved' && e.type === 'bonus')
      .reduce((s, e) => s + (e.amount || 0), 0);
    const deductions = empLedger
      .filter((e) => e.status === 'approved' && e.type === 'deduction')
      .reduce((s, e) => s + (e.amount || 0), 0);

    return {
      employeeId: emp.id,
      employeeName: emp.name,
      position: emp.position || '-',
      assigned,
      completed,
      inProgress,
      rejected,
      overdue,
      completionRate: assigned > 0 ? (completed / assigned) * 100 : 0,
      rejectionRate: assigned > 0 ? (rejected / assigned) * 100 : 0,
      avgCompletionDays,
      earnings: earnings + bonuses - deductions,
      workload: inProgress + overdue,
    };
  }).sort((a, b) => b.completed - a.completed);
}

// =============================================================
// 9. ملخص تحليلي شامل (لصفحة analytics)
// =============================================================
export async function computeAnalyticsSummary(dateFrom, dateTo) {
  const days = dateFrom && dateTo
    ? Math.ceil((new Date(dateTo) - new Date(dateFrom)) / (1000 * 60 * 60 * 24))
    : 30;

  // الفترة الحالية
  const current = await computeFinancialSummary(dateFrom, dateTo);

  // الفترة السابقة (نفس المدى قبلها)
  const prevFrom = dateFrom ? new Date(dateFrom) : null;
  const prevTo = dateTo ? new Date(dateTo) : null;
  if (prevFrom) prevFrom.setDate(prevFrom.getDate() - days);
  if (prevTo) prevTo.setDate(prevTo.getDate() - days);

  const previous = await computeFinancialSummary(prevFrom, prevTo);

  // معدلات النمو
  const growth = {
    earnedRevenue: computeGrowthRate(current.earnedRevenue, previous.earnedRevenue),
    collectedCash: computeGrowthRate(current.collectedCash, previous.collectedCash),
    totalExpenses: computeGrowthRate(current.totalExpenses, previous.totalExpenses),
    netProfit: computeGrowthRate(current.netProfit, previous.netProfit),
    ordersCount: computeGrowthRate(current.ordersCount, previous.ordersCount),
    activeOrdersCount: computeGrowthRate(current.activeOrdersCount, previous.activeOrdersCount),
    expensesCount: computeGrowthRate(current.expensesCount, previous.expensesCount),
    approvedPaymentsCount: computeGrowthRate(current.approvedPaymentsCount, previous.approvedPaymentsCount),
  };

  // جلب بيانات إضافية للتحليلات
  const [inquiriesSnap, customersSnap, ordersSnap, servicesSnap, expensesSnap, ledgerSnap] = await Promise.all([
    getDocs(collection(db, 'inquiries')),
    getDocs(collection(db, 'customers')),
    getDocs(collection(db, 'orders')),
    getDocs(collection(db, 'services')),
    getDocs(collection(db, 'expenses')),
    getDocs(collection(db, 'employeeLedger')),
  ]);

  const inquiries = inquiriesSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const customers = customersSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const orders = ordersSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const services = servicesSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const expenses = expensesSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const ledgerEntries = ledgerSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

  // قمع التحويل
  const funnel = computeConversionFunnel(inquiries, orders);

  // احتباز العملاء
  const retention = computeRetentionRate(customers, orders, days);

  // ربحية الخدمات
  const serviceProfitability = computeServiceProfitability(orders, expenses, ledgerEntries, services);

  // متوسط قيمة الطلب
  const avgOrderValue = current.activeOrdersCount > 0
    ? current.earnedRevenue / current.activeOrdersCount
    : 0;

  // السلاسل الزمنية للرسوم البيانية
  const revenueSeries = aggregateByPeriod(orders, 'createdAt', 'total', 'month');
  const customerSeries = aggregateByPeriod(customers, 'createdAt', 'totalPaid', 'month');

  // التوقعات (شفافة)
  const revenueForecast = forecastValues(revenueSeries.map((r) => r.sum), 3);
  const ordersForecast = forecastValues(revenueSeries.map((r) => r.count), 3);

  return {
    current,
    previous,
    growth,
    funnel,
    retention,
    serviceProfitability,
    avgOrderValue,
    revenueSeries,
    customerSeries,
    revenueForecast,
    ordersForecast,
    period: { from: dateFrom, to: dateTo, days },
  };
}

// =============================================================
// 10. دوال مساعدة للعرض
// =============================================================
export function formatGrowthBadge(percent) {
  if (percent === 0) return { text: '—', class: 'text-muted', arrow: '' };
  const isPositive = percent > 0;
  return {
    text: `${Math.abs(percent).toFixed(1)}%`,
    class: isPositive ? 'text-success' : 'text-danger',
    arrow: isPositive ? '↑' : '↓',
  };
}

export function getTrendLabel(trend) {
  const map = {
    growing: { label: 'في تزايد', cls: 'text-success', icon: 'fa-arrow-trend-up' },
    declining: { label: 'في تراجع', cls: 'text-danger', icon: 'fa-arrow-trend-down' },
    stable: { label: 'مستقر', cls: 'text-muted', icon: 'fa-minus' },
    unknown: { label: 'غير محدد', cls: 'text-muted', icon: 'fa-question' },
  };
  return map[trend] || map.unknown;
}

export function getConfidenceLabel(confidence) {
  const map = {
    high: { label: 'ثقة عالية', cls: 'text-success' },
    medium: { label: 'ثقة متوسطة', cls: 'text-warning' },
    low: { label: 'ثقة منخفضة', cls: 'text-danger' },
  };
  return map[confidence] || map.low;
}

console.log('✅ analytics-engine.js loaded');
