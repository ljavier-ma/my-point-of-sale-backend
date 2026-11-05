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
import { getAuthenticatedUserId } from "../utils/auth.js";

const productFields = [
  "barcode",
  "code",
  "eighthLiterPrice",
  "halfLiterPrice",
  "idealAmount",
  "literPrice",
  "lowQuantity",
  "name",
  "publicPrice",
  "quarterLiterPrice",
  "stock",
  "unitaryPrice",
] as const satisfies readonly (keyof Omit<ProductResponse, "id">)[];

function isCompleteProductInput(
  value: unknown,
): value is Omit<ProductResponse, "id"> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).length !== productFields.length
  ) {
    return false;
  }

  const data: Record<string, unknown> = value as Record<string, unknown>;
  return productFields.every(
    (field: (typeof productFields)[number]): boolean =>
      Object.hasOwn(data, field) && isValidProductField(field, data[field]),
  );
}

function isProductData(value: unknown): value is Omit<ProductResponse, "id"> {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const data: Record<string, unknown> = value as Record<string, unknown>;
  return productFields.every(
    (field: (typeof productFields)[number]): boolean => {
      return isValidProductField(field, data[field]);
    },
  );
}

function isValidProductField(
  field: (typeof productFields)[number],
  value: unknown,
): boolean {
  if (field === "barcode" || field === "code" || field === "name") {
    return typeof value === "string";
  }
  return typeof value === "number" && Number.isFinite(value);
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

function pickProductData(
  value: Omit<ProductResponse, "id">,
): Omit<ProductResponse, "id"> {
  return {
    barcode: value.barcode,
    code: value.code,
    eighthLiterPrice: value.eighthLiterPrice,
    halfLiterPrice: value.halfLiterPrice,
    idealAmount: value.idealAmount,
    literPrice: value.literPrice,
    lowQuantity: value.lowQuantity,
    name: value.name,
    publicPrice: value.publicPrice,
    quarterLiterPrice: value.quarterLiterPrice,
    stock: value.stock,
    unitaryPrice: value.unitaryPrice,
  };
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
  const userId: string | undefined = getAuthenticatedUserId(req);
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

export const createProductMiddleware: RequestHandler<
  ParamsDictionary,
  ErrorResponse | ProductResponse,
  unknown
> = async (
  req: Request<ParamsDictionary, ErrorResponse | ProductResponse, unknown>,
  res: Response<ErrorResponse | ProductResponse>,
): Promise<void> => {
  const userId: string | undefined = getAuthenticatedUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  if (!isProductData(req.body)) {
    res.status(400).json({ error: "Invalid product data" });
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

    const productData: Omit<ProductResponse, "id"> = pickProductData(req.body);
    const productDocument = await stores.docs[storeIndex].ref
      .collection("products")
      .add(productData);
    const response: ProductResponse = {
      ...productData,
      id: productDocument.id,
    };
    res.status(201).json(response);
  } catch (error) {
    console.error("Failed to create product in Firestore:", error);
    res.status(500).json({ error: "Failed to create product" });
  }
};

interface ProductParams extends ParamsDictionary {
  productId: string;
}

export const productMiddleware: RequestHandler<
  ProductParams,
  ErrorResponse | ProductResponse
> = async (
  req: Request<ProductParams, ErrorResponse | ProductResponse>,
  res: Response<ErrorResponse | ProductResponse>,
): Promise<void> => {
  const userId: string | undefined = getAuthenticatedUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authentication required" });
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

    const productReference = stores.docs[storeIndex].ref
      .collection("products")
      .doc(req.params.productId);
    const productDocument = await productReference.get();
    if (!productDocument.exists) {
      res.status(404).json({ error: "Product not found" });
      return;
    }

    const productData: unknown = productDocument.data();
    if (!isProductData(productData)) {
      console.error(
        "Product document is missing valid product fields:",
        productDocument.id,
      );
      res.status(500).json({ error: "Failed to fetch product" });
      return;
    }

    const response: ProductResponse = {
      ...productData,
      id: productDocument.id,
    };
    res.json(response);
  } catch (error) {
    console.error("Failed to fetch product from Firestore:", error);
    res.status(500).json({ error: "Failed to fetch product" });
  }
};

export const updateProductMiddleware: RequestHandler<
  ProductParams,
  ErrorResponse | ProductResponse,
  unknown
> = async (
  req: Request<ProductParams, ErrorResponse | ProductResponse, unknown>,
  res: Response<ErrorResponse | ProductResponse>,
): Promise<void> => {
  const userId: string | undefined = getAuthenticatedUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  if (!isCompleteProductInput(req.body)) {
    res.status(400).json({ error: "Invalid product data" });
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

    const productReference = stores.docs[storeIndex].ref
      .collection("products")
      .doc(req.params.productId);
    const productDocument = await productReference.get();
    if (!productDocument.exists) {
      res.status(404).json({ error: "Product not found" });
      return;
    }

    const existingData: unknown = productDocument.data();
    if (!isProductData(existingData)) {
      console.error(
        "Product document is missing valid product fields:",
        productDocument.id,
      );
      res.status(500).json({ error: "Failed to update product" });
      return;
    }

    const updatedProductData: Omit<ProductResponse, "id"> = pickProductData(
      req.body,
    );
    await productReference.update(updatedProductData);
    const response: ProductResponse = {
      ...existingData,
      ...updatedProductData,
      id: productDocument.id,
    };
    res.json(response);
  } catch (error) {
    console.error("Failed to update product in Firestore:", error);
    res.status(500).json({ error: "Failed to update product" });
  }
};

export const deleteProductMiddleware: RequestHandler<
  ProductParams,
  ErrorResponse,
  unknown
> = async (
  req: Request<ProductParams, ErrorResponse, unknown>,
  res: Response<ErrorResponse>,
): Promise<void> => {
  const userId: string | undefined = getAuthenticatedUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authentication required" });
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

    const productReference = stores.docs[storeIndex].ref
      .collection("products")
      .doc(req.params.productId);
    const productDocument = await productReference.get();
    if (!productDocument.exists) {
      res.status(404).json({ error: "Product not found" });
      return;
    }

    await productReference.delete();
    res.status(204).end();
  } catch (error) {
    console.error("Failed to delete product from Firestore:", error);
    res.status(500).json({ error: "Failed to delete product" });
  }
};
