import * as React from "react";
import type { Product, CheckoutCustomer, PaymentRedirect } from "../types";
import type { useStore } from "../hooks/useStore";
import { formatPrice } from "../lib/format";
import { usePaymentConfig, usePayment } from "../lib/payment";
import { FieldLabel } from "../components/Layout";
import { emptyAddress } from "../fulfilment";
import type { FulfilmentChoice, DeliveryAddress } from "../fulfilment";
import { TrackingLink } from "../components/TrackingLink";
export function useCheckout() {
  const [customer, setCustomer] = React.useState<CheckoutCustomer>({
    firstName: "",
    lastName: "",
    email: "",
  });
  const [validation, setValidation] = React.useState("");
  const [fulfilment, setFulfilment] = React.useState<FulfilmentChoice>({
    method: "collection",
  });
  const [prepared, setPrepared] = React.useState<PaymentRedirect | null>(null);
  const attempt = React.useRef<{ key: string; id: string } | null>(null);
  const submitting = React.useRef(false);
  const payment = usePayment();
  function change(field: keyof CheckoutCustomer, value: string) {
    setCustomer((previous) => ({
      ...previous,
      [field]: value,
    }));
    setValidation("");
    payment.reset();
    setPrepared(null);
  }
  async function submit(productIds: number[]) {
    if (submitting.current) return;
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
      submitting.current = true;
      const payload = { ...customer, productIds, fulfilment };
      const key = JSON.stringify(payload);
      if (attempt.current?.key !== key)
        attempt.current = { key, id: crypto.randomUUID() };
      const redirect = await payment.mutateAsync({
        ...payload,
        requestId: attempt.current.id,
      });
      const allowedDestinations = ["https://sandbox.payfast.co.za/eng/process"];
      if (!allowedDestinations.includes(redirect.action))
        throw new Error("Unexpected payment destination.");
      if (!redirect.order?.tracking)
        throw new Error(
          "Checkout was not saved. Please try again with the same details.",
        );
      setPrepared(redirect);
    } catch (error) {
      setValidation(
        error instanceof Error
          ? error.message
          : "Checkout could not start. Please try again.",
      );
    } finally {
      submitting.current = false;
    }
  }
  function proceed() {
    if (
      !prepared ||
      prepared.action !== "https://sandbox.payfast.co.za/eng/process"
    )
      return;
    const form = document.createElement("form");
    form.method = "POST";
    form.action = prepared.action;
    for (const [name, value] of Object.entries(prepared.fields)) {
      const input = document.createElement("input");
      input.type = "hidden";
      input.name = name;
      input.value = value;
      form.appendChild(input);
    }
    document.body.appendChild(form);
    form.submit();
  }
  return {
    customer,
    change,
    submit,
    payment,
    validation,
    fulfilment,
    setFulfilment,
    prepared,
    proceed,
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
  const deliveryFee =
    checkout.fulfilment.method === "delivery"
      ? (config.data?.fulfilmentOptions.deliveryFeeCents ?? 0)
      : 0;
  const subtotal = products.reduce(
    (sum, p) => sum + Math.round(p.price * 100),
    0,
  );
  const address = checkout.fulfilment.address ?? { ...emptyAddress };
  const changeAddress = (field: keyof DeliveryAddress, value: string) =>
    checkout.setFulfilment({
      method: "delivery",
      address: { ...address, [field]: value },
    });
  if (checkout.prepared?.order) {
    const order = checkout.prepared.order;
    return (
      <div className="checkout-panel">
        <h3>Checkout saved</h3>
        <p className="return-reference">{order.reference}</p>
        <p className="payment-alert">
          Sandbox record · payment remains unverified. No real order has been
          placed.
        </p>
        <p>
          Items: {formatPrice(order.subtotalCents / 100)}
          <br />
          {order.fulfilment.method === "delivery"
            ? "Delivery"
            : "Collection"}: {formatPrice(order.fulfilment.feeCents / 100)}
          <br />
          <strong>Total: {formatPrice(order.totalCents / 100)}</strong>
        </p>
        <TrackingLink access={order.tracking} />
        {order.localDevelopment && (
          <p className="form-note">
            Local test only. This checkout and its tracking link disappear when
            the development server restarts.
          </p>
        )}
        <button
          className="btn primary"
          type="button"
          onClick={checkout.proceed}
        >
          OPEN PAYFAST TEST ↗
        </button>
      </div>
    );
  }
  return (
    <div className="checkout-panel">
      <button className="view-details" onClick={onBack}>
        ← Back to cart
      </button>
      <h3>{"Review & checkout"}</h3>
      <p className="checkout-intro">
        Payment will take place on PayFast’s hosted checkout. Card details are
        never entered on this website. Your contact details, items and delivery
        address (if selected) are saved to handle this checkout. Save your
        private tracking link on the next screen; no email will be sent.
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
          returns you to this website. Save your private tracking link to check
          the result verified through PayFast’s notification.
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
        <fieldset
          className="return-fields checkout-fulfilment"
          disabled={checkout.payment.isPending}
        >
          <legend>Collection or delivery</legend>
          <div className="fulfilment-choices">
            <label>
              <input
                type="radio"
                name="fulfilment"
                value="collection"
                checked={checkout.fulfilment.method === "collection"}
                onChange={() =>
                  checkout.setFulfilment({ method: "collection" })
                }
              />{" "}
              Collection · Free
            </label>
            <label>
              <input
                type="radio"
                name="fulfilment"
                value="delivery"
                checked={checkout.fulfilment.method === "delivery"}
                disabled={!config.data?.fulfilmentOptions.deliveryEnabled}
                onChange={() =>
                  checkout.setFulfilment({
                    method: "delivery",
                    address: { ...emptyAddress },
                  })
                }
              />{" "}
              Delivery ·{" "}
              {formatPrice(
                (config.data?.fulfilmentOptions.deliveryFeeCents ?? 0) / 100,
              )}
            </label>
          </div>
          {checkout.fulfilment.method === "collection" ? (
            <>
              <p>{config.data?.fulfilmentOptions.collectionAddress}</p>
              <p>{config.data?.fulfilmentOptions.collectionHours}</p>
              <p>
                Wait until your order is marked ready for collection before
                travelling.
              </p>
            </>
          ) : (
            <>
              <p>
                South Africa only.{" "}
                {config.data?.fulfilmentOptions.deliveryEstimate}
              </p>
              {(
                [
                  ["recipient", "Recipient name", "name", 100],
                  ["phone", "Delivery phone", "tel", 30],
                  ["street", "Street address", "address-line1", 200],
                  ["suburb", "Suburb (optional)", "address-line2", 100],
                  ["city", "City or town", "address-level2", 100],
                  ["postalCode", "Postal code", "postal-code", 4],
                ] as const
              ).map(([field, label, autoComplete, max]) => (
                <div className="form-field" key={field}>
                  <label htmlFor={`delivery-${field}`}>{label}</label>
                  <input
                    id={`delivery-${field}`}
                    type={field === "phone" ? "tel" : "text"}
                    required={field !== "suburb"}
                    maxLength={max}
                    autoComplete={autoComplete}
                    value={address[field]}
                    onChange={(event) =>
                      changeAddress(field, event.target.value)
                    }
                  />
                </div>
              ))}
              <div className="form-field">
                <label htmlFor="delivery-province">Province</label>
                <select
                  id="delivery-province"
                  required
                  value={address.province}
                  onChange={(event) =>
                    changeAddress("province", event.target.value)
                  }
                >
                  <option value="">Choose your province</option>
                  {config.data?.fulfilmentOptions.deliveryProvinces.map(
                    (province) => (
                      <option key={province}>{province}</option>
                    ),
                  )}
                </select>
              </div>
            </>
          )}
        </fieldset>
        <div className="checkout-summary">
          <p>
            Items <strong>{formatPrice(subtotal / 100)}</strong>
          </p>
          <p>
            {checkout.fulfilment.method === "delivery"
              ? "Delivery"
              : "Collection"}{" "}
            <strong>{formatPrice(deliveryFee / 100)}</strong>
          </p>
          <p>
            Total including fulfilment{" "}
            <strong>{formatPrice((subtotal + deliveryFee) / 100)}</strong>
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
  React.useEffect(() => {
    const leaveForTracking = () => {
      if (window.location.hash.startsWith("#track")) close();
    };
    window.addEventListener("hashchange", leaveForTracking);
    return () => window.removeEventListener("hashchange", leaveForTracking);
  }, [close]);
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
          <span>{checkingOut ? "Items subtotal" : "Total"}</span>
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
