import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  where,
} from 'firebase/firestore';
import { getBytes, ref, uploadBytes } from 'firebase/storage';

const directory = path.dirname(fileURLToPath(import.meta.url));
const projectId = process.env.GCLOUD_PROJECT || 'demo-crm-rules';
console.log('Initializing rules test environment...');
const environment = await initializeTestEnvironment({
  projectId,
  firestore: {
    rules: fs.readFileSync(path.join(directory, '../firestore.rules'), 'utf8'),
  },
  storage: {
    rules: fs.readFileSync(path.join(directory, '../storage.rules'), 'utf8'),
  },
});
console.log('Rules environment ready.');

try {
  console.log('Seeding test documents...');
  await environment.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await Promise.all([
      setDoc(doc(db, 'customers/client-1'), { uid: 'client-1', name: 'Client One' }),
      setDoc(doc(db, 'customers/client-2'), { uid: 'client-2', name: 'Client Two' }),
      setDoc(doc(db, 'users/employee-1'), {
        uid: 'employee-1', role: 'موظف', disabled: false, permissions: {},
      }),
      setDoc(doc(db, 'employees/employee-1'), { uid: 'employee-1' }),
      setDoc(doc(db, 'tasks/task-owned'), {
        title: 'Owned task', assignedEmployeeIds: ['employee-1'], status: 'assigned',
      }),
      setDoc(doc(db, 'tasks/task-other'), {
        title: 'Other task', assignedEmployeeIds: ['employee-2'], status: 'assigned',
      }),
      setDoc(doc(db, 'orders/order-client-1'), {
        customerUid: 'client-1', customerId: 'client-1', status: 'جديد',
      }),
      setDoc(doc(db, 'orders/order-client-2'), {
        customerUid: 'client-2', customerId: 'client-2', status: 'جديد',
      }),
    ]);
  });
  console.log('Seed complete.');

  console.log('Creating authenticated contexts...');
  const asAdmin = environment.authenticatedContext('admin-1', { role: 'admin', admin: true });
  const asClient = environment.authenticatedContext('client-1', { role: 'client' });
  const asOtherClient = environment.authenticatedContext('client-2', { role: 'client' });
  const asEmployee = environment.authenticatedContext('employee-1', { role: 'employee' });
  console.log('Authenticated contexts ready.');

  const clientDb = asClient.firestore();
  const otherClientDb = asOtherClient.firestore();
  const employeeDb = asEmployee.firestore();
  const adminDb = asAdmin.firestore();
  const clientStorage = asClient.storage();
  const otherClientStorage = asOtherClient.storage();
  console.log('All Firestore and Storage contexts ready.');
  await assertSucceeds(getDoc(doc(clientDb, 'customers/client-1')));
  console.log('Client can read own customer.');
  await assertFails(getDoc(doc(clientDb, 'customers/client-2')));
  console.log('Client cannot read another customer.');

  const ownedOrders = await assertSucceeds(getDocs(query(
    collection(clientDb, 'orders'),
    where('customerUid', '==', 'client-1')
  )));
  if (ownedOrders.size !== 1) throw new Error('Client order query returned unexpected records.');
  console.log('Client order query is owner-scoped.');

  await assertSucceeds(setDoc(doc(clientDb, 'orders/client-created'), {
    orderNumber: 'PORTAL-TEST',
    customerUid: 'client-1',
    customerId: 'client-1',
    serviceId: 'service-1',
    description: 'Client order',
    price: 0,
    discount: 0,
    tax: 0,
    total: 0,
    paid: 0,
    status: 'جديد',
    priority: 'متوسطة',
    notes: 'Client order',
    stages: [],
    completionRate: 0,
    deadline: null,
    expectedDeliveryDate: null,
    lifecycleStage: 'inquiry',
    approvalStatus: 'pending',
    source: 'portal',
  }));
  console.log('Client can create an unpriced order.');
  await assertFails(setDoc(doc(clientDb, 'orders/client-priced'), {
    customerUid: 'client-1', customerId: 'client-1', status: 'جديد', total: 500,
  }));
  console.log('Client cannot choose order pricing.');

  await assertSucceeds(getDoc(doc(employeeDb, 'tasks/task-owned')));
  await assertFails(getDoc(doc(employeeDb, 'tasks/task-other')));
  console.log('Employee task access is assignment-scoped.');
  await assertSucceeds(setDoc(doc(employeeDb, 'expenses/employee-request'), {
    description: 'Travel',
    amount: 25,
    category: 'operating',
    date: new Date().toISOString(),
    paymentMethod: 'cash',
    orderId: null,
    notes: '',
    status: 'pending',
    submittedBy: 'employee-1',
    createdBy: 'employee-1',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }));
  await assertFails(setDoc(doc(employeeDb, 'expenses/employee-approved'), {
    description: 'Forged', amount: 25, status: 'approved',
    submittedBy: 'employee-1', createdBy: 'employee-1',
  }));
  console.log('Employee expense submission remains pending until approval.');

  const receipt = new Blob(['test receipt'], { type: 'application/pdf' });
  await assertSucceeds(uploadBytes(ref(clientStorage, 'receipts/client-1/test.pdf'), receipt));
  await assertFails(getBytes(ref(otherClientStorage, 'receipts/client-1/test.pdf')));
  await assertFails(uploadBytes(
    ref(clientStorage, 'receipts/client-1/invalid.txt'),
    new Blob(['not an allowed receipt'], { type: 'text/plain' })
  ));

  await assertSucceeds(getDoc(doc(adminDb, 'customers/client-2')));
  console.log('Security rules tests passed.');
} finally {
  await environment.cleanup();
}
