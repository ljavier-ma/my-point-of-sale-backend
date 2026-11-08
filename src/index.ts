// index.ts
import type { ParamsDictionary } from "express-serve-static-core";

import express, { type Express } from "express";

import type {
  CreateMovementRequest,
  ErrorResponse as MovementErrorResponse,
  MovementResponse,
  MovementsQuery,
  MovementsResponse,
} from "#types/movement.js";
import type {
  ErrorResponse,
  ProductResponse,
  ProductsBelowIdealResponse,
  ProductsLowQuantityResponse,
  ProductsQuery,
  ProductsResponse,
  ProductsSearchQuery,
} from "#types/product.js";
import type { StoreResponse } from "#types/store.js";
import type { UserResponse } from "#types/user.js";

import {
  createMovementMiddleware,
  movementsMiddleware,
} from "#middlewares/movements.middleware.js";
import {
  bellowIdealProductsMiddleware,
  createProductMiddleware,
  deleteProductMiddleware,
  lowQuantityProductsMiddleware,
  productMiddleware,
  productsMiddleware,
  searchProductsMiddleware,
  updateProductMiddleware,
} from "#middlewares/products.middleware.js";
import { storeMiddleware } from "#middlewares/store.middleware.js";
import { userMiddleware } from "#middlewares/user.middleware.js";
import { firebaseAuthMiddleware } from "#services/firebase-auth.service.js";

const app: Express = express();
const port: string = process.env.PORT ?? "8080";

app.use((req, res, next): void => {
  const origin: string | undefined = req.get("origin");

  if (
    origin &&
    /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(origin)
  ) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.vary("Origin");
    res.setHeader(
      "Access-Control-Allow-Methods",
      "GET,POST,PATCH,DELETE,OPTIONS",
    );
    res.setHeader("Access-Control-Allow-Headers", "Authorization,Content-Type");
  }

  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }

  next();
});

app.use(express.json());

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
  MovementErrorResponse | MovementsResponse,
  unknown,
  MovementsQuery
>("/movements", firebaseAuthMiddleware, movementsMiddleware);
app.post<
  ParamsDictionary,
  MovementErrorResponse | MovementResponse,
  CreateMovementRequest
>("/movements", firebaseAuthMiddleware, createMovementMiddleware);
app.get<
  ParamsDictionary,
  ErrorResponse | ProductsResponse,
  unknown,
  ProductsQuery
>("/products", firebaseAuthMiddleware, productsMiddleware);
app.get<
  ParamsDictionary,
  ErrorResponse | ProductResponse[],
  unknown,
  ProductsSearchQuery
>("/products/search", firebaseAuthMiddleware, searchProductsMiddleware);
app.get<ParamsDictionary, ErrorResponse | ProductsBelowIdealResponse>(
  "/products/bellowIdeal",
  firebaseAuthMiddleware,
  bellowIdealProductsMiddleware,
);
app.get<ParamsDictionary, ErrorResponse | ProductsLowQuantityResponse>(
  "/products/lowQuantity",
  firebaseAuthMiddleware,
  lowQuantityProductsMiddleware,
);
app.post<ParamsDictionary, ErrorResponse | ProductResponse, unknown>(
  "/products",
  firebaseAuthMiddleware,
  createProductMiddleware,
);
app.get<{ productId: string }, ErrorResponse | ProductResponse>(
  "/products/:productId",
  firebaseAuthMiddleware,
  productMiddleware,
);
app.patch<{ productId: string }, ErrorResponse | ProductResponse, unknown>(
  "/products/:productId",
  firebaseAuthMiddleware,
  updateProductMiddleware,
);
app.delete<{ productId: string }, ErrorResponse>(
  "/products/:productId",
  firebaseAuthMiddleware,
  deleteProductMiddleware,
);

app.listen(port, (): void => {
  console.log(`Example app listening on port ${port}`);
});
