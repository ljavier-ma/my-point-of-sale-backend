import type {
  ParamsDictionary,
  Query,
  Request,
  RequestHandler,
  Response,
} from "express-serve-static-core";
import type {
  DocumentReference,
  DocumentSnapshot,
  QueryDocumentSnapshot,
} from "firebase-admin/firestore";

import type {
  ErrorResponse,
  ProductResponse,
  ProductsQuery,
  ProductsResponse,
} from "../types/product.js";

import { firestoreDB } from "../config/firebase.js";

const productFields = [
  "barcode",
  "code",
  "eighthLiterPrice",
  "halfLiterPrice",
  "idealAmount",
  "isPaint",
  "literPrice",
  "lowQuantity",
  "name",
  "publicPrice",
  "quarterLiterPrice",
  "stock",
  "unitaryPrice",
] as const satisfies readonly (keyof Omit<ProductResponse, "id">)[];

function isProductData(value: unknown): value is Omit<ProductResponse, "id"> {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const data: Record<string, unknown> = value as Record<string, unknown>;
  return productFields.every(
    (field: (typeof productFields)[number]): boolean => {
      const fieldValue: unknown = data[field];
      if (field === "barcode" || field === "code" || field === "name") {
        return typeof fieldValue === "string";
      }
      if (field === "isPaint") {
        return typeof fieldValue === "boolean";
      }
      return typeof fieldValue === "number" && Number.isFinite(fieldValue);
    },
  );
}

function parsePaginationValue(
  value: Query[string] | undefined,
  minimum: number,
): number | undefined {
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    return undefined;
  }

  const parsedValue = Number(value);
  return Number.isSafeInteger(parsedValue) && parsedValue >= minimum
    ? parsedValue
    : undefined;
}

export const productsMiddleware: RequestHandler<
  ParamsDictionary,
  ErrorResponse | ProductsResponse,
  unknown,
  ProductsQuery
> = async (
  req: Request<
    ParamsDictionary,
    ErrorResponse | ProductsResponse,
    unknown,
    ProductsQuery
  >,
  res: Response<ErrorResponse | ProductsResponse>,
): Promise<void> => {
  const userId: string | undefined = req.firebaseUser?.uid;
  if (!userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const offset: number | undefined = parsePaginationValue(req.query.offset, 0);
  const limit: number | undefined = parsePaginationValue(req.query.limit, 1);
  if (offset === undefined || limit === undefined) {
    res
      .status(400)
      .json({ error: "Valid offset and limit query parameters are required" });
    return;
  }

  try {
    const stores = await firestoreDB.collection("stores").get();
    if (stores.empty) {
      res.status(404).json({ error: "No store found for this user" });
      return;
    }

    const userDocuments = await firestoreDB.getAll(
      ...stores.docs.map((store: QueryDocumentSnapshot): DocumentReference =>
        store.ref.collection("users").doc(userId),
      ),
    );
    const storeIndex: number = userDocuments.findIndex(
      (userDocument: DocumentSnapshot): boolean => userDocument.exists,
    );
    if (storeIndex === -1) {
      res.status(404).json({ error: "No store found for this user" });
      return;
    }

    const productsCollection =
      stores.docs[storeIndex].ref.collection("products");
    const [productsSnapshot, countSnapshot] = await Promise.all([
      productsCollection.offset(offset).limit(limit).get(),
      productsCollection.count().get(),
    ]);
    const products: ProductResponse[] = [];

    for (const productDocument of productsSnapshot.docs) {
      const productData: unknown = productDocument.data();
      if (!isProductData(productData)) {
        console.error(
          "Product document is missing valid product fields:",
          productDocument.id,
        );
        res.status(500).json({ error: "Failed to fetch products" });
        return;
      }

      products.push({ ...productData, id: productDocument.id });
    }

    const response: ProductsResponse = {
      products,
      totalOfProducts: countSnapshot.data().count,
    };
    res.json(response);
  } catch (error) {
    console.error("Failed to fetch products from Firestore:", error);
    res.status(500).json({ error: "Failed to fetch products" });
  }
};
