import * as React from "react";
import type { Product, CheckoutCustomer } from "../types";
import type { useStore } from "../hooks/useStore";
import { formatPrice } from "../lib/format";
import { usePaymentConfig, usePayment } from "../lib/payment";
import { FieldLabel } from "../components/Layout";
export function useCheckout() {
  const [customer, setCustomer] = React.useState<CheckoutCustomer>({
    firstName: "",
    lastName: "",
    email: "",
  });
  const [validation, setValidation] = React.useState("");
  const payment = usePayment();
  function change(field: keyof CheckoutCustomer, value: string) {
    setCustomer((previous) => ({
      ...previous,
      [field]: value,
    }));
    setValidation("");
    payment.reset();
  }
  async function submit(productIds: number[]) {
    if (
      !customer.firstName.trim() ||
      !customer.lastName.trim() ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email.trim())
    ) {
      setValidation(
        "Enter your first name, surname and a valid email address.",
      );
      return;
    }
    try {
      const redirect = await payment.mutateAsync({
        ...customer,
        productIds,
      });
      const allowedDestinations = ["https://sandbox.payfast.co.za/eng/process"];
      if (!allowedDestinations.includes(redirect.action))
        throw new Error("Unexpected payment destination.");
      const form = document.createElement("form");
      form.method = "POST";
      form.action = redirect.action;
      for (const [name, value] of Object.entries(redirect.fields)) {
        const input = document.createElement("input");
        input.type = "hidden";
        input.name = name;
        input.value = value;
        form.appendChild(input);
      }
      document.body.appendChild(form);
      form.submit();
    } catch (error) {
      setValidation(
        error instanceof Error
          ? error.message
          : "Checkout could not start. Please try again.",
      );
    }
  }
  return {
    customer,
    change,
    submit,
    payment,
    validation,
  };
}
export function Checkout({
  products,
  onBack,
}: {
  products: Product[];
  onBack: () => void;
}) {
  let config = usePaymentConfig(true);
  let checkout = useCheckout();
  return (
    <div className="checkout-panel">
      <button className="view-details" onClick={onBack}>
        ← Back to cart
      </button>
      <h3>{"Review & checkout"}</h3>
      <p className="checkout-intro">
        Payment will take place on PayFast’s hosted checkout. Card details are
        never entered on this website.
      </p>
      {config.isPending && <p role="status">Checking payment availability…</p>}
      {config.error && (
        <p className="payment-alert" role="alert">
          {config.error.message}
        </p>
      )}
      {config.data && !config.data.enabled && (
        <p className="payment-alert" role="status">
          {config.data.reason}
        </p>
      )}
      {config.data?.mode === "sandbox" && (
        <p className="payment-alert">
          Sandbox test checkout · no real payment. Completing or cancelling
          returns you to the preview website. Payment notifications are not
          connected.
        </p>
      )}
      <form
        onSubmit={(t) => {
          t.preventDefault();
          config.data?.enabled && checkout.submit(products.map((e) => e.id));
        }}
      >
        {[
          {
            key: "firstName" as const,
            label: "First name",
            type: "text",
          },
          {
            key: "lastName" as const,
            label: "Surname",
            type: "text",
          },
          {
            key: "email" as const,
            label: "Email address",
            type: "email",
          },
        ].map((e) => (
          <div className="form-field" key={e.key}>
            <FieldLabel htmlFor={`checkout-${e.key}`}>{e.label}</FieldLabel>
            <input
              id={`checkout-${e.key}`}
              type={e.type}
              maxLength={e.key === "email" ? 100 : 50}
              autoComplete={
                e.key === "firstName"
                  ? "given-name"
                  : e.key === "lastName"
                    ? "family-name"
                    : "email"
              }
              required={true}
              value={checkout.customer[e.key]}
              onChange={(t) => checkout.change(e.key, t.target.value)}
              disabled={checkout.payment.isPending}
            />
          </div>
        ))}
        <div className="checkout-fulfilment">
          <b>
            {config.data?.enabled ? "Collection" : "Fulfilment to be confirmed"}
          </b>
          <p>
            {config.data?.enabled
              ? "This checkout is for collection only. Delivery is not included. Collection arrangements must be confirmed with the studio."
              : "Delivery and collection arrangements will be confirmed before payments open."}
          </p>
        </div>
        {(checkout.validation || checkout.payment.error) && (
          <p className="field-error" role="alert">
            {checkout.validation || checkout.payment.error?.message}
          </p>
        )}
        <button
          className="btn primary"
          type="submit"
          disabled={
            !config.data?.enabled ||
            !products.length ||
            checkout.payment.isPending
          }
        >
          {checkout.payment.isPending
            ? "PREPARING PAYMENT…"
            : config.data?.mode === "sandbox"
              ? "CONTINUE TO PAYFAST TEST"
              : "CONTINUE TO PAYFAST ↗"}
        </button>
      </form>
    </div>
  );
}
export function useCartFocus(open: boolean, onClose: () => void) {
  const drawerRef = React.useRef<HTMLElement>(null);
  React.useEffect(() => {
    if (!open) return;
    const previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusableElements = () =>
      Array.from(
        drawerRef.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), [tabindex="0"]',
        ) ?? [],
      );
    focusableElements()[0]?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key !== "Tab") return;
      const elements = focusableElements();
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
      previousFocus?.focus();
    };
  }, [open, onClose]);
  return drawerRef;
}
export function CartDrawer({ store }: { store: ReturnType<typeof useStore> }) {
  let [checkingOut, setCheckingOut] = React.useState(false);
  let setCartOpen = store.setCartOpen;
  let close = React.useCallback(() => {
    setCheckingOut(false);
    setCartOpen(false);
  }, [setCartOpen]);
  let drawerRef = useCartFocus(store.cartOpen, close);
  return (
    <>
      <div
        className={`overlay${store.cartOpen ? " show" : ""}`}
        id="overlay"
        onClick={close}
        aria-hidden="true"
      />
      <aside
        className={`drawer${store.cartOpen ? " show" : ""}`}
        id="drawer"
        ref={drawerRef}
        role="dialog"
        aria-modal={store.cartOpen || void 0}
        aria-labelledby="cartTitle"
        aria-hidden={!store.cartOpen}
        inert={!store.cartOpen}
      >
        <div className="drawer-head">
          <h2 id="cartTitle">
            {"Your cart "}
            <span className="gradient">✦</span>
          </h2>
          <button
            className="icon-btn"
            id="cartClose"
            aria-label="Close cart"
            onClick={close}
          >
            ✕
          </button>
        </div>
        <div className="cart-items" id="cartItems">
          {checkingOut ? (
            <Checkout
              products={store.cartProducts}
              onBack={() => setCheckingOut(false)}
            />
          ) : (
            <>
              {store.cartProducts.length ? (
                store.cartProducts.map((t, n) => (
                  <div className="cart-item" key={`${t.id}-${n}`}>
                    <div>
                      <b>{t.name}</b>
                      <br />
                      <small>{formatPrice(t.price)}</small>
                    </div>
                    <button
                      className="icon-btn"
                      onClick={() => store.removeFromCart(n)}
                      aria-label={`Remove ${t.name} from cart`}
                    >
                      ✕
                    </button>
                  </div>
                ))
              ) : (
                <p className="empty">
                  Your cart is empty. Find something you love in the collection!
                </p>
              )}
            </>
          )}
        </div>
        <div className="cart-total">
          <span>Total</span>
          <span id="cartTotal">
            {formatPrice(store.cartProducts.reduce((e, t) => e + t.price, 0))}
          </span>
        </div>
        {!checkingOut && (
          <button
            className="btn primary"
            id="checkout"
            onClick={() => setCheckingOut(true)}
            disabled={!store.cartProducts.length}
          >
            REVIEW CHECKOUT ↗
          </button>
        )}
        {!checkingOut && (
          <p className="cart-note">
            Your selection stays in this browsing session. Prices are indicative
            until product specifications are confirmed.
          </p>
        )}
      </aside>
    </>
  );
}
