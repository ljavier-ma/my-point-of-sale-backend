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
  ProductsBelowIdealResponse,
  ProductsLowQuantityResponse,
  ProductsQuery,
  ProductsResponse,
  ProductsSearchQuery,
} from "../types/product.js";
import type { StoreSettings } from "../types/store.js";

import { firestoreDB } from "../config/firebase.js";
import { getAuthenticatedUserId } from "../utils/auth.js";

const productFields = [
  "barcode",
  "baseStockAmount",
  "code",
  "name",
  "stock",
  "unitaryPrice",
] as const satisfies readonly (keyof Omit<ProductResponse, "id">)[];

const uniqueProductFields = ["barcode", "code", "name"] as const;

type CreateProductInput = Partial<Omit<ProductResponse, "id">> & {
  name: string;
};

function getStockPercentage(
  product: Omit<ProductResponse, "id">,
): number | undefined {
  return product.baseStockAmount === 0
    ? undefined
    : (product.stock / product.baseStockAmount) * 100;
}

function getStoreSettings(value: unknown): StoreSettings | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }

  const storeData: Record<string, unknown> = value as Record<string, unknown>;
  return Object.hasOwn(storeData, "settings") &&
    isStoreSettings(storeData.settings)
    ? storeData.settings
    : undefined;
}

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

function isCreateProductInput(value: unknown): value is CreateProductInput {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const data: Record<string, unknown> = value as Record<string, unknown>;
  return (
    Object.hasOwn(data, "name") &&
    isValidProductField("name", data.name) &&
    productFields.every(
      (field: (typeof productFields)[number]): boolean =>
        field === "name" ||
        !Object.hasOwn(data, field) ||
        isValidProductField(field, data[field]),
    )
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

function isStoreSettings(value: unknown): value is StoreSettings {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const settings: Record<string, unknown> = value as Record<string, unknown>;
  return (
    typeof settings.idealPercentageOfProduct === "number" &&
    Number.isFinite(settings.idealPercentageOfProduct) &&
    settings.idealPercentageOfProduct >= 0 &&
    settings.idealPercentageOfProduct < 100 &&
    typeof settings.lowPercentageOfProduct === "number" &&
    Number.isFinite(settings.lowPercentageOfProduct) &&
    settings.lowPercentageOfProduct >= 0 &&
    settings.lowPercentageOfProduct < 100 &&
    settings.idealPercentageOfProduct > settings.lowPercentageOfProduct
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

function normalizeCreateProductInput(
  value: CreateProductInput,
): Omit<ProductResponse, "id"> {
  return {
    barcode: value.barcode ?? "",
    baseStockAmount: value.baseStockAmount ?? 0,
    code: value.code ?? "",
    name: value.name,
    stock: value.stock ?? 0,
    unitaryPrice: value.unitaryPrice ?? 0,
  };
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
    baseStockAmount: value.baseStockAmount,
    code: value.code,
    name: value.name,
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

      products.push({
        ...pickProductData(productData),
        id: productDocument.id,
      });
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

export const searchProductsMiddleware: RequestHandler<
  ParamsDictionary,
  ErrorResponse | ProductResponse[],
  unknown,
  ProductsSearchQuery
> = async (
  req: Request<
    ParamsDictionary,
    ErrorResponse | ProductResponse[],
    unknown,
    ProductsSearchQuery
  >,
  res: Response<ErrorResponse | ProductResponse[]>,
): Promise<void> => {
  const userId: string | undefined = getAuthenticatedUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const searchNameValue: unknown = Reflect.get(req.query, "name");
  if (typeof searchNameValue !== "string" || !searchNameValue.trim()) {
    res
      .status(400)
      .json({ error: "A non-empty name query parameter is required" });
    return;
  }
  const searchName: string = searchNameValue.trim();

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

    const productSnapshot = await stores.docs[storeIndex].ref
      .collection("products")
      .get();
    const normalizedSearchName = searchName.toLocaleLowerCase();
    const products: ProductResponse[] = [];

    for (const productDocument of productSnapshot.docs) {
      const productData: unknown = productDocument.data();
      if (!isProductData(productData)) {
        console.error(
          "Product document is missing valid product fields:",
          productDocument.id,
        );
        res.status(500).json({ error: "Failed to search products" });
        return;
      }

      if (productData.name.toLocaleLowerCase().includes(normalizedSearchName)) {
        products.push({
          ...pickProductData(productData),
          id: productDocument.id,
        });
      }
    }

    res.json(products.slice(0, 10));
  } catch (error) {
    console.error("Failed to search products from Firestore:", error);
    res.status(500).json({ error: "Failed to search products" });
  }
};

export const bellowIdealProductsMiddleware: RequestHandler<
  ParamsDictionary,
  ErrorResponse | ProductsBelowIdealResponse,
  unknown,
  ProductsQuery
> = async (
  req: Request<
    ParamsDictionary,
    ErrorResponse | ProductsBelowIdealResponse,
    unknown,
    ProductsQuery
  >,
  res: Response<ErrorResponse | ProductsBelowIdealResponse>,
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

    const store = stores.docs[storeIndex];
    const settings = getStoreSettings(store.data());
    if (!settings) {
      console.error("Store document is missing valid settings:", store.id);
      res
        .status(500)
        .json({ error: "Failed to fetch products below ideal amount" });
      return;
    }

    const productSnapshot = await store.ref.collection("products").get();
    const products: ProductResponse[] = [];

    for (const productDocument of productSnapshot.docs) {
      const productData: unknown = productDocument.data();
      if (!isProductData(productData)) {
        console.error(
          "Product document is missing valid product fields:",
          productDocument.id,
        );
        res
          .status(500)
          .json({ error: "Failed to fetch products below ideal amount" });
        return;
      }

      const stockPercentage = getStockPercentage(productData);
      if (
        stockPercentage !== undefined &&
        stockPercentage < settings.idealPercentageOfProduct &&
        stockPercentage > settings.lowPercentageOfProduct
      ) {
        products.push({
          ...pickProductData(productData),
          id: productDocument.id,
        });
      }
    }

    res.json({
      products: products.slice(offset, offset + limit),
      totalOfProducts: products.length,
    });
  } catch (error) {
    console.error(
      "Failed to fetch products below ideal amount from Firestore:",
      error,
    );
    res
      .status(500)
      .json({ error: "Failed to fetch products below ideal amount" });
  }
};

export const lowQuantityProductsMiddleware: RequestHandler<
  ParamsDictionary,
  ErrorResponse | ProductsLowQuantityResponse,
  unknown,
  ProductsQuery
> = async (
  req: Request<
    ParamsDictionary,
    ErrorResponse | ProductsLowQuantityResponse,
    unknown,
    ProductsQuery
  >,
  res: Response<ErrorResponse | ProductsLowQuantityResponse>,
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

    const store = stores.docs[storeIndex];
    const settings = getStoreSettings(store.data());
    if (!settings) {
      console.error("Store document is missing valid settings:", store.id);
      res
        .status(500)
        .json({ error: "Failed to fetch products below low quantity" });
      return;
    }

    const productSnapshot = await store.ref.collection("products").get();
    const products: ProductResponse[] = [];

    for (const productDocument of productSnapshot.docs) {
      const productData: unknown = productDocument.data();
      if (!isProductData(productData)) {
        console.error(
          "Product document is missing valid product fields:",
          productDocument.id,
        );
        res
          .status(500)
          .json({ error: "Failed to fetch products below low quantity" });
        return;
      }

      const stockPercentage = getStockPercentage(productData);
      if (
        stockPercentage !== undefined &&
        stockPercentage <= settings.lowPercentageOfProduct
      ) {
        products.push({
          ...pickProductData(productData),
          id: productDocument.id,
        });
      }
    }

    res.json({
      products: products.slice(offset, offset + limit),
      totalOfProducts: products.length,
    });
  } catch (error) {
    console.error(
      "Failed to fetch products below low quantity from Firestore:",
      error,
    );
    res
      .status(500)
      .json({ error: "Failed to fetch products below low quantity" });
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

  if (!isCreateProductInput(req.body)) {
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

    const productsCollection =
      stores.docs[storeIndex].ref.collection("products");
    const productData: Omit<ProductResponse, "id"> =
      normalizeCreateProductInput(req.body);
    const duplicates = await Promise.all(
      uniqueProductFields.map(async (field) => {
        const value = productData[field];
        if (value === "") {
          return false;
        }

        const matches = await productsCollection
          .where(field, "==", value)
          .limit(1)
          .get();
        return !matches.empty;
      }),
    );
    if (duplicates.some(Boolean)) {
      res.status(409).json({
        error: "A product with the same barcode, code, or name already exists",
      });
      return;
    }

    const productDocument = await productsCollection.add(productData);
    const response: ProductResponse = {
      ...pickProductData(productData),
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
      ...pickProductData({ ...existingData, ...updatedProductData }),
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
