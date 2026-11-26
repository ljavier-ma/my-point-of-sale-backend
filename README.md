# Personal notes

A personal project designed to provide point-of-sale (POS) functionality. The source code is publicly available so that recruiters can evaluate my programming skills; you can also see the project in action by following this [link](https://my-point-of-sale-web--my-point-of-sale-ef022.us-central1.hosted.app/login) and proceeding in test mode.

The frontend repository for this project is also available for review [here](https://github.com/ljavier-ma/my-point-of-sale-web).

The specs repository for this project is also available for review [here](https://github.com/ljavier-ma/my-point-of-sale-specs).

# Project overview

Express app for managment of the backend of the point of sale.

The project has been configured to use typescript following [this article](https://medium.com/@gabrieldrouin/node-js-2025-guide-how-to-setup-express-js-with-typescript-eslint-and-prettier-b342cd21c30d).

## Local browser requests

The API allows browser requests from
`https://my-point-of-sale-web--my-point-of-sale-ef022.us-central1.hosted.app`,
as well as `http://localhost`, `http://127.0.0.1`, and `http://[::1]`,
including origins with a port such as `http://localhost:3000`. CORS preflight
requests allow the API's `GET`, `POST`, `PATCH`, and `DELETE` methods and the
`Authorization` and `Content-Type` headers. API routes still require their
normal authentication.

## Firebase Admin credentials

For local development, `FIREBASE_PRIVATE_KEY_PATH` may point to a service
account JSON file. When the variable is unset, Firebase Admin uses Application
Default Credentials, which is the intended option on Firebase App Hosting.
Grant the App Hosting runtime service account access to Firebase Authentication
and Firestore; do not deploy a local service-account file.

When creating Firebase custom tokens with Application Default Credentials, the
runtime service account also needs `roles/iam.serviceAccountTokenCreator` on the
service account used to sign tokens. This grants `iam.serviceAccounts.signBlob`,
which the Admin SDK uses for remote signing. Ensure the IAM Service Account
Credentials API is enabled. See the [Firebase custom-token
documentation](https://firebase.google.com/docs/auth/admin/create-custom-tokens)
for details.
