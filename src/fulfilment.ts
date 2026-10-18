export const provinces = [
  "Eastern Cape",
  "Free State",
  "Gauteng",
  "KwaZulu-Natal",
  "Limpopo",
  "Mpumalanga",
  "North West",
  "Northern Cape",
  "Western Cape",
] as const;
export interface DeliveryAddress {
  recipient: string;
  phone: string;
  street: string;
  suburb: string;
  city: string;
  province: string;
  postalCode: string;
  country: "ZA";
}
export const emptyAddress: DeliveryAddress = {
  recipient: "",
  phone: "",
  street: "",
  suburb: "",
  city: "",
  province: "",
  postalCode: "",
  country: "ZA",
};
export interface FulfilmentChoice {
  method: "collection" | "delivery";
  address?: DeliveryAddress;
}
export interface FulfilmentConfig {
  deliveryEnabled: boolean;
  deliveryFeeCents: number;
  deliveryProvinces: string[];
  deliveryEstimate: string;
  collectionAddress: string;
  collectionHours: string;
}
export interface SavedFulfilment extends FulfilmentChoice {
  feeCents: number;
  status:
    | "awaiting-payment-verification"
    | "awaiting-processing"
    | "preparing"
    | "ready-for-collection"
    | "collected"
    | "dispatched"
    | "delivered"
    | "cancelled";
  collectionAddress?: string;
  collectionHours?: string;
  deliveryEstimate?: string;
}
