import type { Query } from "express-serve-static-core";

export interface ErrorResponse {
  error: string;
}

export interface MovementProductDetail {
  price: number;
  productId: string;
  quantity: number;
}

export interface MovementResponse {
  id: string;
  productDetails: MovementProductDetail[];
  time: unknown;
}

export interface MovementsQuery extends Query {
  limit?: string;
  offset?: string;
}

export interface MovementsResponse {
  movements: MovementResponse[];
  totalOfMovements: number;
}
