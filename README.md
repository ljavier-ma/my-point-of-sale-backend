# my-point-of-sale-backend

Express app for managment of the backend of the point of sale

## Local browser requests

The API allows browser requests from
`https://my-point-of-sale-web--my-point-of-sale-ef022.us-central1.hosted.app`,
as well as `http://localhost`, `http://127.0.0.1`, and `http://[::1]`,
including origins with a port such as `http://localhost:3000`. CORS preflight
requests allow the API's `GET`, `POST`, `PATCH`, and `DELETE` methods and the
`Authorization` and `Content-Type` headers. API routes still require their
normal authentication.

## Store endpoint

`GET /store` requires a Firebase ID token in the `Authorization` header:

```text
Authorization: Bearer YOUR_FIREBASE_ID_TOKEN
```

The endpoint verifies the token, finds the store containing the user's document
at `stores/{storeId}/users/{uid}`, and returns its Firestore document ID, name,
and `settings` object with numeric `idealPercentageOfProduct` and
`lowPercentageOfProduct` fields. Firestore subcollections are not included.

`PATCH /store` accepts a JSON object containing a non-empty `name` and a
`settings` object with numeric `idealPercentageOfProduct` and
`lowPercentageOfProduct` values from `0` (inclusive) to `100` (exclusive). It
also requires `idealPercentageOfProduct` to be greater than
`lowPercentageOfProduct`. It updates those fields on the authenticated user's
store and returns the updated store.

## Firebase Admin credentials

For local development, `FIREBASE_PRIVATE_KEY_PATH` may point to a service
account JSON file. When the variable is unset, Firebase Admin uses Application
Default Credentials, which is the intended option on Firebase App Hosting.
Grant the App Hosting runtime service account access to Firebase Authentication
and Firestore; do not deploy a local service-account file.

## Products endpoint

`GET /products?offset=0&limit=20` requires a Firebase ID token in the
`Authorization` header. It finds the store containing the authenticated user
and reads the page from `stores/{storeId}/products`. `offset` is a zero-based
index and must be at least `0`; `limit` must be at least `1`.

The response contains the requested products, each with its Firestore document
ID, and the total number of products in that store:

```json
{
  "products": [
    {
      "id": "product-document-id",
      "baseStockAmount": 10,
      "barcode": "",
      "code": "330750.51",
      "name": "ESMALTE S.D. ALUMINIO FINO 3.785 LTS",
      "stock": 3,
      "unitaryPrice": 273.7
    }
  ],
  "totalOfProducts": 1
}
```

`GET /products/search?name=aluminio` searches for the provided text anywhere
within product names in the authenticated user's store. Matching is
case-insensitive, and the response is an array of matching products with their
Firestore IDs. A non-empty `name` query parameter is required.

`GET /products/bellowIdeal` returns products whose stock as a percentage of
`baseStockAmount` is strictly below the store's `settings.idealPercentageOfProduct`
and strictly above `settings.lowPercentageOfProduct`. Products with a
`baseStockAmount` of zero are excluded because their percentage is undefined.
Each product includes its Firestore ID.

`GET /products/lowQuantity` returns products whose stock as a percentage of
`baseStockAmount` is at or below the store's `settings.lowPercentageOfProduct`.
Products with a `baseStockAmount` of zero are excluded because their percentage
is undefined. Each product includes its Firestore ID.

`POST /products` uses the same Firebase ID token and store membership. Send a
JSON object with the required `name` and any optional product fields shown
above, including numeric `baseStockAmount`, excluding `id`. Omitted string
fields are stored as empty strings and omitted numeric fields as `0`; product
fields cannot be `null`. Barcode, code, and name must each be unique among
non-empty values in the authenticated user's store. The server creates a
document in `stores/{storeId}/products` using a Firestore-generated document ID
and returns the product with that ID. A duplicate barcode, code, or name
returns `409 Conflict`.

`PATCH /products/{productId}` updates a product in the authenticated user's
store. The request must contain all product fields, including
`baseStockAmount`; the product ID, null values, and unrecognized fields cannot
be changed.

`DELETE /product/{productId}` deletes the specified product from the
authenticated user's store and returns `204 No Content` when successful.

## Movements endpoint

`GET /movements?offset=0&limit=20` requires a Firebase ID token in the
`Authorization` header as a bearer token. It reads a page of movements from
the authenticated user's `stores/{storeId}/movements` collection.
`offset` is a zero-based index and must be at least `0`; `limit` must be at
least `1`. Movements are ordered from newest to oldest by `time`. Each movement
includes its Firestore document ID as `id`, the stored `time`, and a
`productDetails` array. The response includes the total movement count:

```json
{
  "movements": [
    {
      "id": "movement-document-id",
      "isMovementAPurchase": true,
      "time": "Firebase movement time",
      "productDetails": [
        {
          "productTotal": 0,
          "productId": "string",
          "quantity": 0
        }
      ]
    }
  ],
  "totalOfMovements": 1
}
```

`POST /movements` accepts `isMovementAPurchase` and a non-empty
`productDetails` array. Each detail must contain a `productId`, `productTotal`,
and non-negative `quantity`; product IDs must be unique and refer to products
in the authenticated user's store. For example:

```json
{
  "productDetails": [
    {
      "productTotal": 0,
      "productId": "product-document-id",
      "quantity": 0
    }
  ],
  "isMovementAPurchase": true
}
```

The endpoint updates product stocks and creates the movement atomically.
Purchases add quantity to stock; other movements subtract quantity, clamping
the result at zero. Product stock must be a non-negative number. The server
sets `time` using the current Firestore timestamp and returns the created
movement with its Firestore ID.
