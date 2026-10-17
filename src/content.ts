import type { Product } from "./types.ts";

export interface StorefrontContent {
  products: Product[];
  categories: { value: string; label: string }[];
  faqs: { id: string; question: string; answer: string }[];
  services: { id: string; title: string; icon: string; description: string }[];
  processSteps: { id: string; title: string; description: string }[];
}

export function emptyContent(): StorefrontContent {
  return {
    products: [],
    categories: [],
    faqs: [],
    services: [],
    processSteps: [],
  };
}
