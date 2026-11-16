export interface StoreResponse {
  id: string;
  name: string;
  settings: StoreSettings;
}

export interface StoreSettings {
  idealPercentageOfProduct: number;
  lowPercentageOfProduct: number;
}
