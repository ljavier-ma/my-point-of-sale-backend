export interface StoreErrorResponse {
  error: string;
}

export interface StoreResponse {
  id: string;
  name: string;
  settings: StoreSettings;
}

export interface StoreSettings {
  idealPercentageOfProduct: number;
  lowPercentageOfProduct: number;
}

export interface StoreUpdateRequest {
  name: string;
  settings: StoreSettings;
}
