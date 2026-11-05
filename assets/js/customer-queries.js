import { db } from './firebase-config.js';
import { collection, or, query, where } from 'firebase/firestore';

export function customersVisibleToStaffQuery() {
  return query(
    collection(db, 'customers'),
    or(
      where('uid', '>', ''),
      where('registrationSource', '==', 'admin')
    )
  );
}