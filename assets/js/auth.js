import { FirebaseInit, AuthService } from './core/app-core.js';

const { auth } = FirebaseInit;

export function loginUser(email, password) {
  return AuthService.signIn(email, password);
}

export function logoutUser() {
  return AuthService.signOut();
}

export function onAuthStateChangedCallback(callback) {
  return AuthService.onStateChanged(callback);
}

export function getCurrentUser() {
  return auth.currentUser;
}
