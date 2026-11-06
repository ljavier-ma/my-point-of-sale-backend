# my-point-of-sale-backend

Express app for managment of the backend of the point of sale

## Local browser requests

The API allows browser requests from `http://localhost`, `http://127.0.0.1`,
and `http://[::1]`, including origins with a port such as
`http://localhost:3000`. CORS preflight requests allow the API's `GET`, `POST`,
`PATCH`, and `DELETE` methods and the `Authorization` and `Content-Type`
headers. API routes still require their normal authentication.

## Store endpoint

`GET /store` requires a Firebase ID token in the `Authorization` header:

```text
Authorization: Bearer YOUR_FIREBASE_ID_TOKEN
```

The endpoint verifies the token, finds the store containing the user's document
at `stores/{storeId}/users/{uid}`, and returns the store document data with its
Firestore document ID. Firestore subcollections are not included.

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
      "barcode": "",
      "code": "330750.51",
      "idealAmount": 2,
      "lowQuantity": 1,
      "name": "ESMALTE S.D. ALUMINIO FINO 3.785 LTS",
      "stock": 3,
      "unitaryPrice": 273.7
    }
  ],
  "totalOfProducts": 1
}
```

`POST /products` uses the same Firebase ID token and store membership. Send a
JSON object with the required `name` and any optional product fields shown
above, excluding `id`. Omitted optional fields are stored as `null`. Barcode,
code, and name must each be unique among products in the authenticated user's
store. The server creates a document in `stores/{storeId}/products` using a
Firestore-generated document ID and returns the product with that ID. A
duplicate barcode, code, or name returns `409 Conflict`.

`PATCH /products/{productId}` updates one or more product fields in the
authenticated user's store. The request must contain at least one valid product
field; the product ID and unrecognized fields cannot be changed.

`DELETE /product/{productId}` deletes the specified product from the
authenticated user's store and returns `204 No Content` when successful.

## Movements endpoint

`GET /movements?offset=0&limit=20` requires a Firebase ID token in the
`Authorization` header as a bearer token. It reads a page of movements from
the authenticated user's `stores/{storeId}/movements` collection.
`offset` is a zero-based index and must be at least `0`; `limit` must be at
least `1`. Each movement includes its Firestore document ID as `id`, the stored
`time`, and a `productDetails` array. The response includes the total movement
count:

```json
{
  "movements": [
    {
      "id": "movement-document-id",
      "time": "Firebase movement time",
      "productDetails": [
        {
          "price": 0,
          "productId": "string",
          "quantity": 0
        }
      ]
    }
  ],
  "totalOfMovements": 1
}
```
