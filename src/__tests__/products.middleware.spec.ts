import type { Request, Response } from "express";

import { beforeEach, describe, expect, it, vi } from "vitest";

const { firestoreDB, productCollection } = vi.hoisted(() => ({
  firestoreDB: {
    collection: vi.fn(),
    getAll: vi.fn(),
  },
  productCollection: {
    count: vi.fn(),
    get: vi.fn(),
    limit: vi.fn(),
    offset: vi.fn(),
  },
}));

vi.mock("../config/firebase.js", () => ({ firestoreDB }));

import type {
  ErrorResponse,
  ProductsQuery,
  ProductsResponse,
} from "../types/product.js";

import { productsMiddleware } from "../middlewares/products.middleware.js";

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

const createResponse = (): Response<ErrorResponse | ProductsResponse> =>
  ({
    json: vi.fn(),
    status: vi.fn().mockReturnThis(),
  }) as unknown as Response<ErrorResponse | ProductsResponse>;

interface FirestoreConfig {
  membershipExists?: boolean;
  productDocuments?: { data: () => unknown; id: string }[];
  storeCount?: number;
}

function configureFirestore(config: FirestoreConfig = {}): void {
  const productDocuments = config.productDocuments ?? [];
  const membershipExists = config.membershipExists ?? true;
  const storeCount = config.storeCount ?? 1;
  productCollection.offset.mockReturnThis();
  productCollection.limit.mockReturnThis();
  productCollection.get.mockResolvedValue({ docs: productDocuments });
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
            ? productCollection
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
