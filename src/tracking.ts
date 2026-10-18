export interface TrackingAccess {
  token: string;
  expiresAt: string;
}
export interface TrackingView {
  kind: "order" | "return";
  reference: string;
  createdAt: string;
  status: string;
  paymentStatus?: "unverified" | "verified-sandbox" | "failed" | "cancelled";
  fulfilment?: {
    method: "collection" | "delivery";
    status: string;
    feeCents: number;
    collectionAddress?: string;
    collectionHours?: string;
    deliveryEstimate?: string;
  };
  handlingFeePercent?: number;
  localDevelopment: boolean;
  expiresAt: string;
}
export const trackingLabels: Record<string, string> = {
  "awaiting-payment-verification": "Awaiting payment verification",
  "awaiting-processing": "Sandbox payment confirmed · awaiting review",
  "payment-failed": "Payment failed",
  "payment-cancelled": "Payment cancelled",
  "pending-review": "Pending review",
  "under-review": "Under review",
  approved: "Approved",
  declined: "Declined",
  "awaiting-item": "Awaiting returned item",
  received: "Returned item received",
  resolved: "Resolved",
  preparing: "Preparing your items",
  "ready-for-collection": "Ready for collection",
  collected: "Collected",
  dispatched: "Dispatched",
  delivered: "Delivered",
  cancelled: "Cancelled",
};
export function trackingUrl(access: TrackingAccess): string {
  return `${window.location.origin}/#track=${access.token}`;
}
