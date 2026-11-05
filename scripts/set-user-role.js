const { cert, initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const fs = require('node:fs');
const path = require('node:path');

const [email, role] = process.argv.slice(2);
const roleMap = {
  admin: { claim: 'admin', legacy: 'مدير' },
  employee: { claim: 'employee', legacy: 'موظف' },
  client: { claim: 'client', legacy: 'عميل' },
};

if (!email || !roleMap[role]) {
  console.error('Usage: node set-user-role.js <email> <admin|employee|client>');
  process.exit(1);
}

const credentialPath = [
  path.join(__dirname, 'service-account.json'),
  path.join(__dirname, 'serviceAccountKey.json'),
].find((candidate) => fs.existsSync(candidate));

if (!credentialPath) {
  console.error('Service account JSON was not found in scripts/.');
  process.exit(1);
}

const serviceAccount = require(credentialPath);
const app = initializeApp({
  credential: cert(serviceAccount),
  projectId: serviceAccount.project_id,
});
const auth = getAuth(app);
const db = getFirestore(app);

async function setRole() {
  const user = await auth.getUserByEmail(email.trim());
  const roleDefinition = roleMap[role];
  const userRef = db.collection('users').doc(user.uid);

  if (role === 'client') {
    const customer = await db.collection('customers').doc(user.uid).get();
    if (!customer.exists) {
      throw new Error('Client has no customers/{uid} profile; register the client first.');
    }
  }

  const claims = { ...(user.customClaims || {}), role: roleDefinition.claim };
  delete claims.admin;
  delete claims.employee;
  delete claims.client;
  if (role === 'admin') claims.admin = true;

  await auth.setCustomUserClaims(user.uid, claims);

  if (role === 'client') {
    if ((await userRef.get()).exists) {
      await userRef.set({
        role: roleDefinition.legacy,
        disabled: false,
        updatedAt: new Date().toISOString(),
      }, { merge: true });
    }
  } else {
    const userSnapshot = await userRef.get();
    const profile = {
      email: user.email,
      displayName: user.displayName || user.email,
      role: roleDefinition.legacy,
      disabled: false,
      permissions: {},
      updatedAt: new Date().toISOString(),
    };
    if (!userSnapshot.exists) profile.createdAt = FieldValue.serverTimestamp();
    await userRef.set(profile, { merge: true });
  }

  console.log(`Set ${role} role for ${user.email} (${user.uid}). Ask the user to sign in again.`);
}

setRole().catch((error) => {
  console.error(`Could not set role: ${error.message}`);
  process.exitCode = 1;
});