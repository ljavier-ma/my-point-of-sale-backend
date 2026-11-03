// index.ts
import type { ParamsDictionary } from "express-serve-static-core";

import express, { type Express } from "express";

import type {
  ErrorResponse,
  ProductResponse,
  ProductsQuery,
  ProductsResponse,
} from "#types/product.js";
import type { StoreResponse } from "#types/store.js";
import type { UserResponse } from "#types/user.js";

import {
  productMiddleware,
  productsMiddleware,
} from "#middlewares/products.middleware.js";
import { storeMiddleware } from "#middlewares/store.middleware.js";
import { userMiddleware } from "#middlewares/user.middleware.js";
import { firebaseAuthMiddleware } from "#services/firebase-auth.service.js";

const app: Express = express();
const port: string = process.env.PORT ?? "9001";

app.get<ParamsDictionary, StoreResponse>(
  "/store",
  firebaseAuthMiddleware,
  storeMiddleware,
);
app.get<ParamsDictionary, UserResponse>(
  "/user",
  firebaseAuthMiddleware,
  userMiddleware,
);
app.get<
  ParamsDictionary,
  ErrorResponse | ProductsResponse,
  unknown,
  ProductsQuery
>("/products", firebaseAuthMiddleware, productsMiddleware);
app.get<{ productId: string }, ErrorResponse | ProductResponse>(
  "/products/:productId",
  firebaseAuthMiddleware,
  productMiddleware,
);

app.listen(port, (): void => {
  console.log(`Example app listening on port ${port}`);
});
