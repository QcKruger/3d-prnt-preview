import { useQuery, useMutation } from "@tanstack/react-query";
import type { PaymentConfig, PaymentRedirect, PaymentRequest } from "../types";

async function requestJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  if (!response.headers.get("content-type")?.includes("application/json")) {
    throw new Error(
      "The payment server is unavailable. Open the site through npm run dev or npm start.",
    );
  }
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.message || "Checkout could not start.");
  return data as T;
}

export function usePaymentConfig(enabled = true) {
  return useQuery({
    queryKey: ["payment-config"],
    queryFn: () => requestJson<PaymentConfig>("/api/payment/config"),
    enabled,
    retry: false,
  });
}

export function usePayment() {
  return useMutation({
    mutationFn: (request: PaymentRequest) =>
      requestJson<PaymentRedirect>("/api/payment/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      }),
  });
}
