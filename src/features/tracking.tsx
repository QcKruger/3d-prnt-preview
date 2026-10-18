import { useEffect, useRef, useState } from "react";
import type { TrackingView } from "../tracking";
import { trackingLabels } from "../tracking";
import { formatPrice } from "../lib/format";

export function GuestTracking() {
  const [token, setToken] = useState("");
  const [result, setResult] = useState<TrackingView | null>(null);
  const [failure, setFailure] = useState("");
  const [pending, setPending] = useState(false);
  const current = useRef(0);
  const resultRef = useRef<HTMLDivElement>(null);
  const lastToken = useRef("");
  async function load(value: string) {
    const attempt = ++current.current;
    setPending(true);
    setFailure("");
    setResult(null);
    try {
      let raw = value.trim();
      if (!/^[A-Za-z0-9_-]{43}$/.test(raw)) {
        let url: URL;
        try {
          url = new URL(raw);
        } catch {
          throw new Error(
            "Use the private tracking link saved with your request.",
          );
        }
        if (
          url.origin !== window.location.origin ||
          !url.hash.startsWith("#track=")
        )
          throw new Error(
            "Use the private tracking link saved with your request.",
          );
        raw = url.hash.slice(7);
      }
      if (!/^[A-Za-z0-9_-]{43}$/.test(raw))
        throw new Error(
          "Use the private tracking link saved with your request.",
        );
      const response = await fetch("/api/tracking/view", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: raw }),
        cache: "no-store",
        credentials: "same-origin",
        signal: AbortSignal.timeout(12_000),
      });
      if (!response.ok)
        throw new Error(
          response.status === 404
            ? "This tracking link is invalid or has expired."
            : response.status === 429
              ? "Too many tracking attempts. Please try again shortly."
              : "Tracking is temporarily unavailable. Please try again shortly.",
        );
      const data = (await response.json()) as TrackingView;
      if (attempt === current.current) {
        lastToken.current = raw;
        setResult(data);
        setToken("");
      }
    } catch (error) {
      if (attempt === current.current)
        setFailure(
          error instanceof Error &&
            !["TypeError", "TimeoutError"].includes(error.name)
            ? error.message
            : "Tracking is temporarily unavailable. Please try again shortly.",
        );
    } finally {
      if (attempt === current.current) setPending(false);
    }
  }
  useEffect(() => {
    const consume = () => {
      if (!window.location.hash.startsWith("#track=")) return;
      const secret = window.location.hash.slice(7);
      // The bearer token stays out of HTTP URLs, referrers and persistent browser
      // storage; replace it in browser history immediately after reading it.
      history.replaceState(
        null,
        "",
        `${window.location.pathname}${window.location.search}#tracking`,
      );
      document.getElementById("tracking")?.scrollIntoView();
      setToken(secret);
      void load(secret);
    };
    consume();
    window.addEventListener("hashchange", consume);
    return () => {
      window.removeEventListener("hashchange", consume);
    };
  }, []);
  useEffect(() => {
    if (result) resultRef.current?.focus();
  }, [result]);
  return (
    <section
      className="section tracking-section"
      id="tracking"
      aria-labelledby="tracking-title"
    >
      <div className="container tracking-grid">
        <div className="custom-intro">
          <div className="eyebrow">YOUR PRINT, YOUR PROGRESS</div>
          <h2 id="tracking-title">
            Stay in the loop.
            <br />
            <span className="gradient">No account needed.</span>
          </h2>
          <p className="section-desc">
            Use the private tracking link saved with your checkout or return
            request to view its latest status.
          </p>
          <p className="contact-note">
            Keep your link private. A reference number or email address alone
            cannot open a request. Email delivery and replacement links are not
            available yet.
          </p>
        </div>
        <div className="quote-form">
          <h3>Track an order or return</h3>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void load(token);
            }}
          >
            <div className="form-field">
              <label htmlFor="guest-tracking-link">Private tracking link</label>
              <input
                id="guest-tracking-link"
                type="text"
                autoComplete="off"
                spellCheck={false}
                maxLength={500}
                value={token}
                onChange={(event) => setToken(event.target.value)}
                required
                disabled={pending}
                placeholder="Paste your saved private link"
              />
            </div>
            <button className="btn primary" disabled={pending}>
              {pending ? "CHECKING STATUS…" : "VIEW STATUS ↗"}
            </button>
          </form>
          {failure && (
            <p role="alert" className="field-error">
              {failure}
            </p>
          )}
          {result && (
            <div
              className="tracking-result"
              role="status"
              tabIndex={-1}
              ref={resultRef}
            >
              <button
                className="view-details"
                type="button"
                onClick={() => void load(lastToken.current)}
              >
                Check for updates ↻
              </button>
              <span className="eyebrow">
                {result.kind === "order" ? "SANDBOX ORDER" : "RETURN REQUEST"}
              </span>
              <p className="return-reference">{result.reference}</p>
              <h3>{trackingLabels[result.status] ?? "Pending review"}</h3>
              {result.kind === "order" && (
                <p>
                  {result.paymentStatus === "verified-sandbox"
                    ? "Sandbox payment verified by PayFast notification. This is a test transaction; no real payment or fulfilment is triggered."
                    : result.paymentStatus === "failed"
                      ? "PayFast reported that this sandbox payment failed. No payment has been confirmed."
                      : result.paymentStatus === "cancelled"
                        ? "PayFast reported that this sandbox payment was cancelled. No payment has been confirmed."
                        : "Payment is unverified. A PayFast redirect does not confirm payment. Sandbox records do not place a real order or trigger fulfilment."}
                </p>
              )}
              {result.fulfilment && (
                <div className="checkout-fulfilment">
                  <b>
                    {result.fulfilment.method === "collection"
                      ? "Collection"
                      : "Delivery"}
                  </b>
                  <p>
                    {result.fulfilment.method === "collection"
                      ? result.fulfilment.collectionAddress
                      : result.fulfilment.deliveryEstimate}
                  </p>
                  {result.fulfilment.method === "collection" && (
                    <p>{result.fulfilment.collectionHours}</p>
                  )}
                  <p>
                    {result.fulfilment.method === "collection"
                      ? "Collection fee"
                      : "Delivery fee"}
                    : {formatPrice(result.fulfilment.feeCents / 100)}
                  </p>
                  {result.status !== "ready-for-collection" &&
                    result.fulfilment.method === "collection" && (
                      <p>
                        Wait for a ready-for-collection confirmation before
                        travelling.
                      </p>
                    )}
                </div>
              )}
              {result.kind === "return" && (
                <p>
                  Requests need review before a return or refund is agreed. The
                  recorded handling fee is {result.handlingFeePercent}%. Keep
                  the item and packaging until you receive instructions.
                </p>
              )}
              {result.localDevelopment && (
                <p className="form-note">
                  Local test only. Records are temporary and disappear when the
                  development server restarts.
                </p>
              )}
              <p className="form-note">
                Link expires {new Date(result.expiresAt).toLocaleString()}. This
                view does not show contact details or delivery addresses.
              </p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
