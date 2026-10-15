import * as React from "react";
import type { useStore } from "../hooks/useStore";
import type { Product } from "../types";
import { categories } from "../data/catalogue";
import { formatPrice } from "../lib/format";
import { FieldLabel } from "../components/Layout";
import { useIsMobile } from "../hooks/useResponsive";
export function useProductDialog() {
  const dialogRef = React.useRef<HTMLDialogElement>(null);
  const [quantity, setQuantity] = React.useState(1);
  React.useEffect(() => {
    const dialog = dialogRef.current;
    const previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const previousOverflow = document.body.style.overflow;
    dialog?.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      dialog?.close();
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, []);
  return {
    dialogRef,
    quantity,
    setQuantity,
  };
}
export function ProductShape({
  shape,
  color,
}: {
  shape: Product["shape"];
  color: string;
}) {
  switch (shape) {
    case "planter":
      return (
        <>
          <path d="M62 80 L188 80 172 179 Q125 203 78 179Z" fill={color} />
          <path d="M62 80 Q125 58 188 80 Q125 104 62 80" fill="#e7d7ff" />
          <path
            d="M84 95 L95 175 M113 101 L116 187 M143 101 L139 186 M170 94 L158 174"
            stroke="#ffffff55"
            strokeWidth="4"
          />
        </>
      );
    case "stand":
      return (
        <>
          <path d="M115 55 L144 55 144 169 115 169Z" fill={color} />
          <path d="M77 176 Q125 158 175 176 L185 190 67 190Z" fill={color} />
          <path
            d="M80 75 Q80 28 129 28 Q178 28 178 75"
            fill="none"
            stroke={color}
            strokeWidth="16"
          />
          <rect x="66" y="76" width="25" height="55" rx="9" fill="#e3dcff" />
          <rect x="166" y="76" width="25" height="55" rx="9" fill="#e3dcff" />
        </>
      );
    case "dragon":
      return (
        <>
          <path
            d="M42 150 Q72 80 112 130 T198 89 Q178 140 205 153 Q177 176 152 151 Q122 201 93 162 Q60 186 42 150Z"
            fill={color}
          />
          <path
            d="M75 119 L83 87 102 113 120 84 133 118 158 92 163 130"
            fill="none"
            stroke="#ffd4ef"
            strokeWidth="10"
            strokeLinejoin="round"
          />
          <circle cx="182" cy="117" r="5" fill="#21172c" />
        </>
      );
    case "cable":
      return (
        <>
          <rect x="50" y="105" width="150" height="65" rx="20" fill={color} />
          <path
            d="M80 105 V145 M125 105 V145 M170 105 V145"
            stroke="#292044"
            strokeWidth="15"
            strokeLinecap="round"
          />
        </>
      );
    case "sign":
      return (
        <>
          <rect x="32" y="77" width="186" height="103" rx="17" fill={color} />
          <text
            x="125"
            y="140"
            fontSize="38"
            textAnchor="middle"
            fontWeight="bold"
            fill="#2d2046"
          >
            HELLO
          </text>
        </>
      );
    case "vase":
      return (
        <>
          <path
            d="M91 42 L159 42 150 70 Q198 126 160 186 Q125 207 90 186 Q52 126 100 70Z"
            fill={color}
          />
          <path
            d="M100 70 Q125 84 150 70 M83 107 Q125 125 167 107 M78 145 Q125 163 172 145"
            stroke="#fff7"
            strokeWidth="5"
            fill="none"
          />
        </>
      );
    case "controller":
      return (
        <>
          <path
            d="M60 98 Q65 73 92 79 L158 79 Q185 73 190 98 L207 154 Q212 181 186 177 L151 147 99 147 64 177 Q38 181 43 154Z"
            fill={color}
          />
          <path d="M82 103 V135 M66 119 H98" stroke="#332450" strokeWidth="9" />
          <circle cx="164" cy="108" r="7" fill="#fff" />
          <circle cx="179" cy="124" r="7" fill="#fff" />
        </>
      );
    case "key":
      return (
        <>
          <circle
            cx="92"
            cy="100"
            r="33"
            stroke={color}
            strokeWidth="18"
            fill="none"
          />
          <path
            d="M116 121 L179 182 194 165 183 151 170 160 160 146 172 135 130 107"
            fill={color}
          />
        </>
      );
  }
}
export function ProductIllustration({ product }: { product: Product }) {
  return (
    <svg
      viewBox="0 0 250 230"
      role="img"
      aria-label={`Illustration of ${product.name}`}
    >
      <ellipse cx="125" cy="205" rx="85" ry="12" fill="#0006" />
      <ProductShape shape={product.shape} color={product.color} />
    </svg>
  );
}
export function ProductDialog({
  product,
  onClose,
  onAdd,
}: {
  product: Product;
  onClose: () => void;
  onAdd: (id: number) => void;
}) {
  let { dialogRef, quantity, setQuantity } = useProductDialog();
  let personalised = product.shape === "sign";
  function addSelection() {
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 20) return;
    dialogRef.current?.close();
    onClose();
    for (let index = 0; index < quantity; index++) onAdd(product.id);
  }
  return (
    <dialog
      className="product-dialog"
      ref={dialogRef}
      aria-labelledby="product-title"
      onCancel={onClose}
      onClick={(e) => {
        e.target === e.currentTarget && onClose();
      }}
    >
      <div className="product-dialog-content">
        <button
          className="icon-btn modal-close"
          aria-label="Close product details"
          onClick={onClose}
        >
          ✕
        </button>
        <div className="detail-art">
          <span className="tag">{product.tag}</span>
          <ProductIllustration product={product} />
          <small>Product illustration · photography coming soon</small>
        </div>
        <div className="detail-copy">
          <div className="eyebrow">
            {product.category}
            {" / THE COLLECTION"}
          </div>
          <h2 id="product-title">{product.name}</h2>
          <p>{product.desc}</p>
          <div className="detail-price">
            {personalised ? "From " : ""}
            {formatPrice(product.price)} <small>Indicative price</small>
          </div>
          <dl className="product-specs">
            <div>
              <dt>{"Size & material"}</dt>
              <dd>Final specifications to be confirmed</dd>
            </div>
            <div>
              <dt>Colour options</dt>
              <dd>Include your preference in a custom enquiry</dd>
            </div>
            <div>
              <dt>{"Production & delivery"}</dt>
              <dd>Lead time and delivery costs confirmed before payment</dd>
            </div>
          </dl>
          {personalised ? (
            <>
              <p className="detail-note">
                Tell us the name or wording, preferred colour and size in your
                enquiry.
              </p>
              <a
                className="btn primary"
                href="#custom"
                onClick={() => {
                  dialogRef.current?.close();
                  onClose();
                }}
              >
                PERSONALISE WITH A QUOTE ↗
              </a>
            </>
          ) : (
            <>
              <div className="quantity-row">
                <FieldLabel htmlFor="product-quantity">Quantity</FieldLabel>
                <input
                  id="product-quantity"
                  type="number"
                  min={1}
                  max={20}
                  step={1}
                  value={quantity}
                  onChange={(e) => setQuantity(Number(e.target.value))}
                />
              </div>
              <button
                className="btn primary"
                disabled={
                  !Number.isInteger(quantity) || quantity < 1 || quantity > 20
                }
                onClick={addSelection}
              >
                ADD TO CART ·{" "}
                {formatPrice(
                  product.price * (Number.isFinite(quantity) ? quantity : 0),
                )}
              </button>
              <a
                className="detail-custom-link"
                href="#custom"
                onClick={() => {
                  dialogRef.current?.close();
                  onClose();
                }}
              >
                Need a different size or colour? Request a quote ↗
              </a>
            </>
          )}
          <p className="detail-note">
            Try this selection with PayFast sandbox checkout. Test payments do
            not place a real order.
          </p>
        </div>
      </div>
    </dialog>
  );
}
export function ProductCard({
  product,
  onAdd,
  onView,
}: {
  product: Product;
  onAdd: (id: number) => void;
  onView: (product: Product) => void;
}) {
  return (
    <article className="product">
      <div className="product-art">
        <span className="tag">{product.tag}</span>
        <button
          className="art-button"
          aria-label={`View ${product.name} details`}
          onClick={() => onView(product)}
        >
          <ProductIllustration product={product} />
        </button>
      </div>
      <div className="product-body">
        <h3>
          <button
            className="product-title-button"
            onClick={() => onView(product)}
          >
            {product.name}
          </button>
        </h3>
        <p>{product.desc}</p>
        <button className="view-details" onClick={() => onView(product)}>
          View details ↗
        </button>
        <div className="product-bottom">
          <span className="price">{formatPrice(product.price)}</span>
          <button
            className="add"
            onClick={() =>
              product.shape === "sign" ? onView(product) : onAdd(product.id)
            }
            aria-label={
              product.shape === "sign"
                ? `Personalise ${product.name}`
                : `Add ${product.name} to cart`
            }
          >
            {product.shape === "sign" ? "PERSONALISE ↗" : "+ ADD TO CART"}
          </button>
        </div>
      </div>
    </article>
  );
}
export function Shop({ store }: { store: ReturnType<typeof useStore> }) {
  let [selectedProduct, setSelectedProduct] = React.useState<Product | null>(
    null,
  );
  let mobile = useIsMobile();
  let [expandedResults, setExpandedResults] = React.useState("");
  let resultsKey = `${store.filter}|${store.search}|${store.sort}`;
  let expanded = expandedResults === resultsKey;
  let visibleProducts =
    mobile && !expanded ? store.shown.slice(0, 4) : store.shown;
  return (
    <section className="section" id="shop">
      <div className="container">
        <div className="section-head reveal">
          <div>
            <div className="eyebrow">THE COLLECTION</div>
            <h2>
              {"Small prints. "}
              <span className="gradient">Big personality.</span>
            </h2>
            <p className="section-desc">
              Find your next favourite thing. Designed to stand out, printed to
              last.
            </p>
          </div>
          <a className="btn secondary" href="#custom">
            NEED SOMETHING CUSTOM? ↗
          </a>
        </div>
        <div className="chips" id="filters" aria-label="Product categories">
          {categories.map((t) => (
            <button
              className={`chip${store.filter === t.value ? " active" : ""}`}
              aria-pressed={store.filter === t.value}
              onClick={() => store.setFilter(t.value)}
              key={t.value}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="shop-toolbar">
          <span className="results" id="results" aria-live="polite">
            {store.shown.length}
            {" product"}
            {store.shown.length === 1 ? "" : "s"} found
          </span>
          <div className="shop-controls">
            <FieldLabel className="sr-only" htmlFor="search">
              Search products
            </FieldLabel>
            <input
              id="search"
              type="search"
              placeholder="Search the collection\\u2026"
              value={store.search}
              onChange={(t) => store.setSearch(t.target.value)}
            />
            <FieldLabel className="sr-only" htmlFor="sort">
              Sort products
            </FieldLabel>
            <select
              id="sort"
              value={store.sort}
              onChange={(t) => store.setSort(t.target.value)}
            >
              <option value="featured">Featured</option>
              <option value="low">Price: low to high</option>
              <option value="high">Price: high to low</option>
              <option value="az">Name: A to Z</option>
            </select>
          </div>
        </div>
        <div className="products" id="products">
          {store.shown.length ? (
            visibleProducts.map((t) => (
              <ProductCard
                product={t}
                onAdd={store.addToCart}
                onView={setSelectedProduct}
                key={t.id}
              />
            ))
          ) : (
            <div className="no-results">
              No products found. Try another search or category.
            </div>
          )}
        </div>
        {mobile && store.shown.length > 4 && (
          <button
            className="btn secondary show-more-products"
            aria-expanded={expanded}
            onClick={() => setExpandedResults(expanded ? "" : resultsKey)}
          >
            {expanded
              ? "SHOW FEWER PRODUCTS ↑"
              : `SHOW ALL ${store.shown.length} PRODUCTS ↓`}
          </button>
        )}
        <p className="catalogue-note">
          Explore the collection. Product photography and final specifications
          will be added before online ordering opens.
        </p>
        {selectedProduct && (
          <ProductDialog
            product={selectedProduct}
            onClose={() => setSelectedProduct(null)}
            onAdd={store.addToCart}
          />
        )}
      </div>
    </section>
  );
}
