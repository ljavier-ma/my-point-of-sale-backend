import type { Query } from "express-serve-static-core";

export interface ErrorResponse {
  error: string;
}

export interface ProductResponse {
  barcode: string;
  baseStockAmount: number;
  code: string;
  id: string;
  name: string;
  publicPrice: number;
  stock: number;
  unitaryPrice: number;
}

export interface ProductsBelowIdealResponse {
  products: ProductResponse[];
  totalOfProducts: number;
}

export interface ProductsLowQuantityResponse {
  products: ProductResponse[];
  totalOfProducts: number;
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
