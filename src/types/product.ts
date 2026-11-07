import type { Query } from "express-serve-static-core";

export interface ErrorResponse {
  error: string;
}

export interface ProductResponse {
  barcode: null | string;
  code: null | string;
  id: string;
  idealAmount: null | number;
  lowQuantity: null | number;
  name: string;
  stock: null | number;
  unitaryPrice: null | number;
}

export interface ProductsQuery extends Query {
  limit?: string;
  offset?: string;
}

export interface ProductsResponse {
  products: ProductResponse[];
  totalOfProducts: number;
}

export interface ProductsSearchQuery extends Query {
  name?: string;
}
