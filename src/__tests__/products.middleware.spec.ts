import type { Request, Response } from "express";

import { beforeEach, describe, expect, it, vi } from "vitest";

const { firestoreDB, productCollection, productReference } = vi.hoisted(() => ({
  firestoreDB: {
    collection: vi.fn(),
    getAll: vi.fn(),
  },
  productCollection: {
    add: vi.fn(),
    count: vi.fn(),
    doc: vi.fn(),
    get: vi.fn(),
    limit: vi.fn(),
    offset: vi.fn(),
  },
  productReference: {
    delete: vi.fn(),
    get: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock("../config/firebase.js", () => ({ firestoreDB }));

import type {
  ErrorResponse,
  ProductResponse,
  ProductsQuery,
  ProductsResponse,
} from "../types/product.js";

import {
  createProductMiddleware,
  deleteProductMiddleware,
  productMiddleware,
  productsMiddleware,
  updateProductMiddleware,
} from "../middlewares/products.middleware.js";

const productData = {
  barcode: "",
  code: "330750.51",
  eighthLiterPrice: 36,
  halfLiterPrice: 102,
  idealAmount: 2,
  isPaint: true,
  literPrice: 167,
  lowQuantity: 1,
  name: "ESMALTE S.D. ALUMINIO FINO 3.785 LTS",
  publicPrice: 397,
  quarterLiterPrice: 62,
  stock: 3,
  unitaryPrice: 273.7,
};

const createResponse = (): Response<
  ErrorResponse | ProductResponse | ProductsResponse
> =>
  ({
    end: vi.fn(),
    json: vi.fn(),
    status: vi.fn().mockReturnThis(),
  }) as unknown as Response<ErrorResponse | ProductResponse | ProductsResponse>;

interface FirestoreConfig {
  membershipExists?: boolean;
  productDocuments?: { data: () => unknown; id: string }[];
  singleProduct?: {
    data: () => unknown;
    exists: boolean;
    id: string;
  };
  storeCount?: number;
}

function configureFirestore(config: FirestoreConfig = {}): void {
  const productDocuments = config.productDocuments ?? [];
  const membershipExists = config.membershipExists ?? true;
  const storeCount = config.storeCount ?? 1;
  productCollection.offset.mockReturnThis();
  productCollection.limit.mockReturnThis();
  productCollection.add.mockResolvedValue({ id: "generated-product-id" });
  productCollection.get.mockResolvedValue({ docs: productDocuments });
  productReference.get.mockResolvedValue({
    data: (): typeof productData => productData,
    exists: true,
    id: "product-1",
  });

  productReference.update.mockResolvedValue(undefined);
  productReference.delete.mockResolvedValue(undefined);
  if (config.singleProduct) {
    productReference.get.mockResolvedValue(config.singleProduct);
  }
  productCollection.doc.mockReturnValue(productReference);
  productCollection.count.mockReturnValue({
    get: vi.fn().mockResolvedValue({
      data: () => ({ count: 15 }),
    }),
  });

  const stores = Array.from(
    { length: storeCount },
    (_value: unknown, index: number) => ({
      id: `store-${String(index + 1)}`,
      ref: {
        collection: vi.fn((name: string) =>
          name === "products"
            ? {
                ...productCollection,
                doc: productCollection.doc,
              }
            : {
                doc: vi
                  .fn()
                  .mockReturnValue(`user-reference-${String(index + 1)}`),
              },
        ),
      },
    }),
  );
  firestoreDB.collection.mockReturnValue({
    get: vi.fn().mockResolvedValue({ docs: stores, empty: storeCount === 0 }),
  });
  firestoreDB.getAll.mockResolvedValue(
    stores.map((_store: (typeof stores)[number], index: number) => ({
      exists: membershipExists && index === storeCount - 1,
    })),
  );
}

describe("deleteProductMiddleware", () => {
  beforeEach((): void => {
    vi.clearAllMocks();
  });

  it("deletes the product from the authenticated user's store", async () => {
    configureFirestore();
    const req = {
      firebaseUser: { uid: "user-1" },
      params: { productId: "product-1" },
    } as Request<{ productId: string }, ErrorResponse>;
    const res = createResponse();

    await deleteProductMiddleware(req, res, vi.fn());

    expect(productCollection.doc).toHaveBeenCalledWith("product-1");
    expect(productReference.delete).toHaveBeenCalledOnce();
    expect(res.status).toHaveBeenCalledWith(204);
    expect(res.end).toHaveBeenCalledOnce();
  });

  it("returns 404 if the product does not exist", async () => {
    configureFirestore({
      singleProduct: {
        data: (): undefined => undefined,
        exists: false,
        id: "missing-product",
      },
    });
    const req = {
      firebaseUser: { uid: "user-1" },
      params: { productId: "missing-product" },
    } as Request<{ productId: string }, ErrorResponse>;
    const res = createResponse();

    await deleteProductMiddleware(req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: "Product not found" });
    expect(productReference.delete).not.toHaveBeenCalled();
  });

  it("returns 401 when the request is unauthenticated", async () => {
    const req = {
      params: { productId: "product-1" },
    } as Request<{ productId: string }, ErrorResponse>;
    const res = createResponse();

    await deleteProductMiddleware(req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      error: "Authentication required",
    });
    expect(firestoreDB.collection).not.toHaveBeenCalled();
  });
});

describe("productsMiddleware", () => {
  beforeEach((): void => {
    vi.clearAllMocks();
  });

  it("returns paginated products, their Firestore IDs, and the total count", async () => {
    configureFirestore({
      productDocuments: [
        { data: (): typeof productData => productData, id: "product-1" },
      ],
      storeCount: 2,
    });

    const req = {
      firebaseUser: { uid: "user-1" },
      query: { limit: "5", offset: "10" },
    } as Request<
      Record<string, never>,
      ErrorResponse | ProductsResponse,
      unknown,
      ProductsQuery
    >;
    const res = createResponse();

    await productsMiddleware(req, res, vi.fn());

    expect(firestoreDB.collection).toHaveBeenCalledWith("stores");
    expect(firestoreDB.getAll).toHaveBeenCalledWith(
      "user-reference-1",
      "user-reference-2",
    );
    expect(productCollection.offset).toHaveBeenCalledWith(10);
    expect(productCollection.limit).toHaveBeenCalledWith(5);
    expect(res.json).toHaveBeenCalledWith({
      products: [{ ...productData, id: "product-1" }],
      totalOfProducts: 15,
    });
    expect(res.status).not.toHaveBeenCalled();
  });

  it("returns a product by ID from the authenticated user's store", async () => {
    configureFirestore();
    const req = {
      firebaseUser: { uid: "user-1" },
      params: { productId: "product-1" },
    } as Request<{ productId: string }, ErrorResponse | ProductResponse>;
    const res = createResponse();

    await productMiddleware(req, res, vi.fn());

    expect(productCollection.doc).toHaveBeenCalledWith("product-1");
    expect(res.json).toHaveBeenCalledWith({
      ...productData,
      id: "product-1",
    });
    expect(res.status).not.toHaveBeenCalled();
  });

  it("returns 404 when the product ID does not exist in the user's store", async () => {
    configureFirestore({
      singleProduct: {
        data: (): undefined => undefined,
        exists: false,
        id: "missing-product",
      },
    });
    const req = {
      firebaseUser: { uid: "user-1" },
      params: { productId: "missing-product" },
    } as Request<{ productId: string }, ErrorResponse | ProductResponse>;
    const res = createResponse();

    await productMiddleware(req, res, vi.fn());

    expect(productCollection.doc).toHaveBeenCalledWith("missing-product");
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: "Product not found" });
  });

  it("returns 401 when the request is not authenticated", async () => {
    const req = {
      query: { limit: "5", offset: "0" },
    } as Request<
      Record<string, never>,
      ErrorResponse | ProductsResponse,
      unknown,
      ProductsQuery
    >;
    const res = createResponse();

    await productsMiddleware(req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      error: "Authentication required",
    });
    expect(firestoreDB.collection).not.toHaveBeenCalled();
  });

  it("returns 400 when pagination parameters are missing or invalid", async () => {
    const req = {
      firebaseUser: { uid: "user-1" },
      query: { limit: "0", offset: "-1" },
    } as Request<
      Record<string, never>,
      ErrorResponse | ProductsResponse,
      unknown,
      ProductsQuery
    >;
    const res = createResponse();

    await productsMiddleware(req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: "Valid offset and limit query parameters are required",
    });
    expect(firestoreDB.collection).not.toHaveBeenCalled();
  });

  it("returns 404 when the authenticated user has no store", async () => {
    configureFirestore({ membershipExists: false });
    const req = {
      firebaseUser: { uid: "user-1" },
      query: { limit: "5", offset: "0" },
    } as Request<
      Record<string, never>,
      ErrorResponse | ProductsResponse,
      unknown,
      ProductsQuery
    >;
    const res = createResponse();

    await productsMiddleware(req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      error: "No store found for this user",
    });
  });

  describe("updateProductMiddleware", () => {
    beforeEach((): void => {
      vi.clearAllMocks();
    });

    it("updates all product fields and returns the updated product", async () => {
      configureFirestore();
      const updateData: typeof productData = {
        ...productData,
        name: "Updated product name",
        stock: 12,
      };
      const req = {
        body: updateData,
        firebaseUser: { uid: "user-1" },
        params: { productId: "product-1" },
      } as Request<
        { productId: string },
        ErrorResponse | ProductResponse,
        unknown
      >;
      const res = createResponse();

      await updateProductMiddleware(req, res, vi.fn());

      expect(productCollection.doc).toHaveBeenCalledWith("product-1");
      expect(productReference.update).toHaveBeenCalledWith(updateData);
      expect(res.json).toHaveBeenCalledWith({
        ...productData,
        ...updateData,
        id: "product-1",
      });
      expect(res.status).not.toHaveBeenCalled();
    });

    it("rejects partial update data", async () => {
      configureFirestore();
      const req = {
        body: { stock: 12 },
        firebaseUser: { uid: "user-1" },
        params: { productId: "product-1" },
      } as Request<
        { productId: string },
        ErrorResponse | ProductResponse,
        unknown
      >;
      const res = createResponse();

      await updateProductMiddleware(req, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: "Invalid product data" });
      expect(productReference.update).not.toHaveBeenCalled();
    });

    it("rejects invalid field types", async () => {
      configureFirestore();
      const req = {
        body: { ...productData, stock: "12" },
        firebaseUser: { uid: "user-1" },
        params: { productId: "product-1" },
      } as Request<
        { productId: string },
        ErrorResponse | ProductResponse,
        unknown
      >;
      const res = createResponse();

      await updateProductMiddleware(req, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: "Invalid product data" });
      expect(productReference.update).not.toHaveBeenCalled();
    });

    it("rejects unexpected fields such as an ID in the body", async () => {
      configureFirestore();
      const req = {
        body: { ...productData, id: "client-id" },
        firebaseUser: { uid: "user-1" },
        params: { productId: "product-1" },
      } as Request<
        { productId: string },
        ErrorResponse | ProductResponse,
        unknown
      >;
      const res = createResponse();

      await updateProductMiddleware(req, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: "Invalid product data" });
      expect(productReference.update).not.toHaveBeenCalled();
    });

    it("returns 404 if the product does not exist", async () => {
      configureFirestore({
        singleProduct: {
          data: (): undefined => undefined,
          exists: false,
          id: "missing-product",
        },
      });
      const req = {
        body: productData,
        firebaseUser: { uid: "user-1" },
        params: { productId: "missing-product" },
      } as Request<
        { productId: string },
        ErrorResponse | ProductResponse,
        unknown
      >;
      const res = createResponse();

      await updateProductMiddleware(req, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ error: "Product not found" });
      expect(productReference.update).not.toHaveBeenCalled();
    });
  });

  describe("createProductMiddleware", () => {
    beforeEach((): void => {
      vi.clearAllMocks();
    });

    it("creates the product with a Firestore-generated document ID", async () => {
      configureFirestore();
      const req = {
        body: { ...productData, id: "client-id", ignored: "not stored" },
        firebaseUser: { uid: "user-1" },
      } as Request<
        Record<string, never>,
        ErrorResponse | ProductResponse,
        unknown
      >;
      const res = createResponse();

      await createProductMiddleware(req, res, vi.fn());

      expect(productCollection.add).toHaveBeenCalledWith(productData);
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith({
        ...productData,
        id: "generated-product-id",
      });
    });

    it("returns 400 when the product data is invalid", async () => {
      configureFirestore();
      const req = {
        body: { ...productData, stock: "3" },
        firebaseUser: { uid: "user-1" },
      } as Request<
        Record<string, never>,
        ErrorResponse | ProductResponse,
        unknown
      >;
      const res = createResponse();

      await createProductMiddleware(req, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: "Invalid product data" });
      expect(productCollection.add).not.toHaveBeenCalled();
    });

    it("returns 401 when the request is unauthenticated", async () => {
      const req = {
        body: productData,
      } as Request<
        Record<string, never>,
        ErrorResponse | ProductResponse,
        unknown
      >;
      const res = createResponse();

      await createProductMiddleware(req, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: "Authentication required",
      });
      expect(firestoreDB.collection).not.toHaveBeenCalled();
    });
  });

  it("returns 500 if a product does not match the product schema", async () => {
    configureFirestore({
      productDocuments: [
        {
          data: (): Omit<typeof productData, "stock"> & { stock: string } => ({
            ...productData,
            stock: "3",
          }),
          id: "invalid-product",
        },
      ],
    });
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const req = {
      firebaseUser: { uid: "user-1" },
      query: { limit: "5", offset: "0" },
    } as Request<
      Record<string, never>,
      ErrorResponse | ProductsResponse,
      unknown,
      ProductsQuery
    >;
    const res = createResponse();

    await productsMiddleware(req, res, vi.fn());

    expect(consoleError).toHaveBeenCalledWith(
      "Product document is missing valid product fields:",
      "invalid-product",
    );
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      error: "Failed to fetch products",
    });
  });

  it("logs Firestore failures and returns 500", async () => {
    const error = new Error("Firestore unavailable");
    firestoreDB.collection.mockReturnValue({
      get: vi.fn().mockRejectedValue(error),
    });
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const req = {
      firebaseUser: { uid: "user-1" },
      query: { limit: "5", offset: "0" },
    } as Request<
      Record<string, never>,
      ErrorResponse | ProductsResponse,
      unknown,
      ProductsQuery
    >;
    const res = createResponse();

    await productsMiddleware(req, res, vi.fn());

    expect(consoleError).toHaveBeenCalledWith(
      "Failed to fetch products from Firestore:",
      error,
    );
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      error: "Failed to fetch products",
    });
  });
});
