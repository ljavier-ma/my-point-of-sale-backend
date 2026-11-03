import type { Query } from "express-serve-static-core";

export interface ErrorResponse {
  error: string;
}

export interface ProductResponse {
  barcode: string;
  code: string;
  eighthLiterPrice: number;
  halfLiterPrice: number;
  id: string;
  idealAmount: number;
  isPaint: boolean;
  literPrice: number;
  lowQuantity: number;
  name: string;
  publicPrice: number;
  quarterLiterPrice: number;
  stock: number;
  unitaryPrice: number;
}

export interface ProductsQuery extends Query {
  limit?: string;
  offset?: string;
}

export interface ProductsResponse {
  products: ProductResponse[];
  totalOfProducts: number;
}
