# my-point-of-sale-backend

Express app for managment of the backend of the point of sale

## Store endpoint

`GET /store` requires a Firebase ID token in the `Authorization` header:

```text
Authorization: Bearer YOUR_FIREBASE_ID_TOKEN
```

The endpoint verifies the token, finds the store containing the user's document
at `stores/{storeId}/users/{uid}`, and returns the store document data with its
Firestore document ID. Firestore subcollections are not included.
