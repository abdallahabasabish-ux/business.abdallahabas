import { collection, getDocs, onSnapshot, query, where } from 'firebase/firestore';

function uniqueCustomers(...groups) {
  const customers = new Map();
  groups.flat().forEach((customer) => customers.set(customer.id, customer));
  return [...customers.values()];
}

function customerQuery(db, field, operator, value) {
  return query(collection(db, 'customers'), where(field, operator, value));
}

export async function getVisibleCustomers(db) {
  const [registered, createdInCrm] = await Promise.all([
    getDocs(customerQuery(db, 'uid', '>', '')),
    getDocs(customerQuery(db, 'recordSource', '==', 'admin')),
  ]);

  return uniqueCustomers(
    registered.docs.map((snapshot) => ({ id: snapshot.id, ...snapshot.data() })),
    createdInCrm.docs.map((snapshot) => ({ id: snapshot.id, ...snapshot.data() }))
  );
}

export function listenToVisibleCustomers(db, onCustomers, onError = console.error) {
  let registered = [];
  let createdInCrm = [];
  let registeredReady = false;
  let crmReady = false;

  const emit = () => {
    if (registeredReady && crmReady) {
      onCustomers(uniqueCustomers(registered, createdInCrm));
    }
  };

  const registeredUnsubscribe = onSnapshot(
    customerQuery(db, 'uid', '>', ''),
    (snapshot) => {
      registered = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
      registeredReady = true;
      emit();
    },
    (error) => {
      registeredReady = true;
      onError(error);
      emit();
    }
  );

  const crmUnsubscribe = onSnapshot(
    customerQuery(db, 'recordSource', '==', 'admin'),
    (snapshot) => {
      createdInCrm = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
      crmReady = true;
      emit();
    },
    (error) => {
      crmReady = true;
      onError(error);
      emit();
    }
  );

  return () => {
    registeredUnsubscribe();
    crmUnsubscribe();
  };
}