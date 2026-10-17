import * as React from "react";
import type { StorefrontContent } from "../content";
export function useStore(content: StorefrontContent) {
  const { products, categories } = content;
  const [filter, setFilter] = React.useState("All");
  const [search, setSearch] = React.useState("");
  const [sort, setSort] = React.useState("featured");
  const [cartIds, setCartIds] = React.useState<number[]>([]);
  const [cartOpen, setCartOpen] = React.useState(false);
  const [notification, setNotification] = React.useState("");
  const notificationTimer = React.useRef<
    ReturnType<typeof setTimeout> | undefined
  >(undefined);
  React.useEffect(() => () => clearTimeout(notificationTimer.current), []);
  function notify(message: string) {
    setNotification(message);
    clearTimeout(notificationTimer.current);
    notificationTimer.current = setTimeout(() => setNotification(""), 2800);
  }
  const searchTerm = search.trim().toLowerCase();
  const shown = products.filter(
    (product) =>
      (filter === "All" || product.category === filter) &&
      `${product.name} ${product.desc} ${product.category}`
        .toLowerCase()
        .includes(searchTerm),
  );
  if (sort === "low") shown.sort((a, b) => a.price - b.price);
  if (sort === "high") shown.sort((a, b) => b.price - a.price);
  if (sort === "az") shown.sort((a, b) => a.name.localeCompare(b.name));
  const cartProducts = cartIds.flatMap((id) =>
    products.filter((product) => product.id === id),
  );
  function addToCart(id: number) {
    if (!products.some((product) => product.id === id)) return;
    setCartIds((ids) => [...ids, id]);
    setCartOpen(true);
    notify("Added to cart ✦");
  }
  function removeFromCart(index: number) {
    setCartIds((ids) => ids.filter((_, itemIndex) => itemIndex !== index));
  }
  return {
    products,
    categories,
    filter,
    setFilter,
    search,
    setSearch,
    sort,
    setSort,
    shown,
    cartProducts,
    cartOpen,
    setCartOpen,
    notification,
    notify,
    addToCart,
    removeFromCart,
  };
}
