# Business CRM Architecture Migration

## Current Architecture

This repository is a static Firebase Hosting application. The new portal roots and shared modules are an incremental foundation; existing root-level HTML pages remain the feature implementation until each feature is migrated. The bridge is intentional so deployments do not remove operational screens prematurely.

## Target Directory Structure

```text
admin/
  index.html                 Admin portal shell
employee/
  index.html                 Employee portal shell
client/
  index.html                 Client portal shell
  login.html                 Redirect to the existing client sign-in form
assets/
  css/
    portal-core.css          Shared responsive RTL design tokens and states
  js/
    core/
      app-core.js            Firebase singleton, AuthService, UIEngine, notifications
      portal-guard.js        Role resolution and route guards
      portal-layout-engine.js Shared portal header/navigation/content layout
      business-services.js   FinanceService, OrderService, TaskService
    portals/
      admin-entry.js
      employee-entry.js
      client-entry.js
    pages/                   Existing feature modules, migrated incrementally
scripts/
  set-admin.js               Trusted initial administrator bootstrap
  set-user-role.js           Trusted Admin SDK role/claim assignment
firestore.rules              Role- and ownership-based data authorization
storage.rules                Role- and resource-based file authorization
docs/
  ARCHITECTURE_MIGRATION.md  This migration guide
```

## Implemented Foundation

- `AuthService` is the shared auth facade. Existing `auth.js` exports remain as compatibility wrappers.
- `portal-guard.js` normalizes old Arabic profile roles and new claims to the admin, employee, or client portal.
- `PortalLayoutEngine` creates shared UI using DOM APIs rather than interpolating untrusted HTML.
- `business-services.js` exposes the initial `FinanceService`, `OrderService`, and `TaskService` boundaries.
- `/admin/`, `/employee/`, and `/client/` are guarded entry points. Their navigation currently links to the existing page implementations.
- `set-user-role.js` sets claims with Firebase Admin SDK. Claims must never be set from browser code.
- Hosting excludes `scripts/`, service-account keys, and local emulator logs.

## Migration Steps

1. **Back up and establish a rollback point.** Export Firestore data and deploy the current Hosting release to a named channel before changing production rules.
2. **Install trusted tooling locally.** In `scripts/`, install the existing `firebase-admin` dependency. Put a service-account JSON in `scripts/`; it is excluded from Git and Hosting. Never commit or publish it.
3. **Set trusted roles.** Create each user in Firebase Authentication first, then run `node scripts/set-user-role.js <email> <admin|employee|client>`. For the first administrator, `node scripts/set-admin.js <email>` remains supported. Users must sign out and back in to refresh ID-token claims.
4. **Test rules against representative accounts.** Start Firestore and Storage emulators and test admin, employee, client, disabled, and unauthenticated access before publishing rules. Do not rely on UI guards as authorization.
5. **Deploy rules and indexes.** Deploy Firestore rules, Storage rules, and indexes in a maintenance window. Watch emulator and production permission-denied logs. Roll back rules immediately if a legitimate workflow is denied.
6. **Adopt portal routes.** Change email links/bookmarks to `/admin/`, `/employee/`, or `/client/`. Keep root `.html` pages available until each workflow has been migrated and verified.
7. **Migrate feature modules by domain.** Move one feature at a time to `assets/js/core/business-services.js` APIs and the shared layout. Start with read-only dashboard views, then CRUD, then transactions and uploads. Add focused emulator tests before removing the old page.
8. **Migrate legacy roles and ownership.** Preserve existing Arabic `users.role` during the bridge. Backfill custom claims using the trusted script. Backfill `customerUid`, `employeeUid`, and ownership references only from verified account-to-record matches; never infer identity from display name or an unverified email match.
9. **Remove compatibility code last.** After all accounts have claims, all records have owner identifiers, and all old URLs have migrated, remove Arabic-role fallbacks and legacy `auth.js` exports in a separate reviewed release.

## Role Mapping During Migration

| Existing profile role | Claim role | Portal |
| --- | --- | --- |
| `مدير` | `admin` | Admin |
| `محاسب` | `accountant` | Admin portal with finance scope |
| `مشرف`, `موظف` | `employee` | Employee |
| Client profile in `customers/{uid}` | `client` | Client |

The rules accept legacy Arabic profile roles as a migration bridge. New application code should use lowercase role IDs and explicit permissions.

## Important Operational Notes

- Custom Claims require Firebase Admin SDK or a trusted server/Cloud Function. Firebase client SDKs cannot assign them. This repository provides a local Admin SDK workflow; production onboarding should move to a protected callable function or another trusted backend.
- The current `firebase.json` Hosting root is the repository root. Deployment excludes `scripts/` and service-account keys; keep those ignore patterns in place.
- The current portal shells are navigational bridges, not yet replacements for every legacy feature page. Do not delete the root pages until each link points to a migrated screen and its behavior has been tested.
- The rules were compiled with Firebase Emulator. Compilation is not equivalent to exercising every access path; run role-based emulator tests before production deployment.
