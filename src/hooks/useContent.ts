import { useQuery } from "@tanstack/react-query";
import { emptyContent } from "../content";
import type { StorefrontContent } from "../content";

const empty = emptyContent();

export function useContent(): StorefrontContent {
  const query = useQuery({
    queryKey: ["site-content"],
    queryFn: async () => {
      const response = await fetch("/api/content", { cache: "no-store" });
      if (!response.ok) throw new Error("Content unavailable");
      return (await response.json()) as StorefrontContent;
    },
    retry: false,
    staleTime: 0,
    refetchInterval: 10_000,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: "always",
  });
  // A failed background refresh must clear formerly visible records, rather
  // than showing stale cached data or replacing it with bundled examples.
  return query.isError ? empty : query.data || empty;
}
