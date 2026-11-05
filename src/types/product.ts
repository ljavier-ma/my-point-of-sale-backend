import type { Query } from "express-serve-static-core";

export interface ErrorResponse {
  error: string;
}

export interface ProductResponse {
  barcode: null | string;
  code: null | string;
  eighthLiterPrice: null | number;
  halfLiterPrice: null | number;
  id: string;
  idealAmount: null | number;
  literPrice: null | number;
  lowQuantity: null | number;
  name: string;
  publicPrice: null | number;
  quarterLiterPrice: null | number;
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
