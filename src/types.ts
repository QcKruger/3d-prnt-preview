export type ProductShape =
  | "planter"
  | "stand"
  | "dragon"
  | "cable"
  | "sign"
  | "vase"
  | "controller"
  | "key";
export interface Product {
  id: number;
  name: string;
  category: string;
  price: number;
  desc: string;
  color: string;
  shape: ProductShape;
  tag: string;
}
export interface EnquiryFields {
  name: string;
  email: string;
  description: string;
  quantity: string;
  colour: string;
  dimensions: string;
}
export type EnquiryErrors = Partial<Record<keyof EnquiryFields, string>>;
export type Notify = (message: string) => void;
export interface CheckoutCustomer {
  firstName: string;
  lastName: string;
  email: string;
}
export interface PaymentRequest extends CheckoutCustomer {
  productIds: number[];
}
export interface PaymentRedirect {
  action: string;
  fields: Record<string, string>;
}
export interface PaymentConfig {
  enabled: boolean;
  mode: "sandbox";
  fulfilment: "collection";
  notificationsEnabled: false;
  reason?: string;
}
