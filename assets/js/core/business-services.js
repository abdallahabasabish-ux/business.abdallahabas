import { db } from '../firebase-config.js';
import {
  addDoc,
  collection,
  doc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import { computeComparison, computeFinancialSummary } from '../accounting.js';
import { computeAnalyticsSummary, computeEmployeePerformance } from '../analytics-engine.js';

const ordersCollection = collection(db, 'orders');
const tasksCollection = collection(db, 'tasks');

function uniqueById(records) {
  return [...new Map(records.map((record) => [record.id, record])).values()];
}

export const FinanceService = Object.freeze({
  summary: computeFinancialSummary,
  comparison: computeComparison,
  analytics: computeAnalyticsSummary,
  employeePerformance: computeEmployeePerformance,

  submitExpense(expense, employeeUid) {
    if (!employeeUid) throw new Error('Authenticated employee is required.');
    if (!Number.isFinite(expense.amount) || expense.amount <= 0) {
      throw new Error('Expense amount must be greater than zero.');
    }
    return addDoc(collection(db, 'expenses'), {
      description: String(expense.description || '').trim(),
      amount: expense.amount,
      category: expense.category || 'other',
      date: expense.date,
      paymentMethod: expense.paymentMethod || 'cash',
      orderId: expense.orderId || null,
      notes: String(expense.notes || '').trim(),
      status: 'pending',
      submittedBy: employeeUid,
      createdBy: employeeUid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  },
});

export const OrderService = Object.freeze({
  async listAll() {
    const snapshot = await getDocs(query(ordersCollection, orderBy('createdAt', 'desc')));
    return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
  },

  async listForClient(uid) {
    const [byUid, byId] = await Promise.all([
      getDocs(query(ordersCollection, where('customerUid', '==', uid))),
      getDocs(query(ordersCollection, where('customerId', '==', uid))),
    ]);
    return uniqueById([...byUid.docs, ...byId.docs]
      .map((item) => ({ id: item.id, ...item.data() }))
      .sort((a, b) => new Date(b.createdAt?.toDate?.() || b.createdAt || 0)
        - new Date(a.createdAt?.toDate?.() || a.createdAt || 0)));
  },

  async createClientOrder(uid, order) {
    if (!uid) throw new Error('Client authentication is required.');
    return addDoc(ordersCollection, {
      ...order,
      customerUid: uid,
      customerId: uid,
      status: 'جديد',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  },

  update(id, changes) {
    return updateDoc(doc(db, 'orders', id), {
      ...changes,
      updatedAt: new Date().toISOString(),
    });
  },
});

export const TaskService = Object.freeze({
  async listAll() {
    const snapshot = await getDocs(query(tasksCollection, orderBy('createdAt', 'desc')));
    return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
  },

  async listAssigned(uid) {
    const snapshot = await getDocs(query(
      tasksCollection,
      where('assignedEmployeeIds', 'array-contains', uid),
      orderBy('createdAt', 'desc')
    ));
    return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
  },

  create(task, creatorUid) {
    if (!creatorUid) throw new Error('Authenticated task creator is required.');
    return addDoc(tasksCollection, {
      ...task,
      assignedEmployeeIds: [...new Set(task.assignedEmployeeIds || [])],
      assignedBy: creatorUid,
      createdBy: creatorUid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  },

  update(id, changes) {
    return updateDoc(doc(db, 'tasks', id), {
      ...changes,
      updatedAt: new Date().toISOString(),
    });
  },
});