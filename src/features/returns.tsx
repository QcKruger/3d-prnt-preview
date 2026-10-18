import { useEffect, useRef, useState } from "react";
import {
  initialReturn,
  returnReasons,
  returnResolutions,
  validateReturn,
  RETURN_HANDLING_FEE_PERCENT,
} from "../returns";
import type { ReturnErrors, ReturnFields, ReturnReceipt } from "../returns";
import { TrackingLink } from "../components/TrackingLink";
import { trackingUrl } from "../tracking";

export function Returns() {
  const [fields, setFields] = useState<ReturnFields>({ ...initialReturn });
  const [errors, setErrors] = useState<ReturnErrors>({});
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState("");
  const [receipt, setReceipt] = useState<ReturnReceipt | null>(null);
  const form = useRef<HTMLFormElement>(null);
  const confirmation = useRef<HTMLDivElement>(null);
  const submitting = useRef(false);
  const attempt = useRef<{ key: string; id: string } | null>(null);
  useEffect(() => {
    if (receipt) confirmation.current?.focus();
  }, [receipt]);
  function change<K extends keyof ReturnFields>(
    key: K,
    value: ReturnFields[K],
  ) {
    setFields((previous) => ({ ...previous, [key]: value }));
    setErrors((previous) => ({ ...previous, [key]: undefined }));
  }
  async function submit() {
    if (submitting.current) return;
    const validation = validateReturn(fields);
    setErrors(validation);
    setFailure("");
    if (Object.keys(validation).length) {
      form.current
        ?.querySelector<HTMLElement>(`[name="${Object.keys(validation)[0]}"]`)
        ?.focus();
      return;
    }
    submitting.current = true;
    setPending(true);
    const key = JSON.stringify(fields);
    if (attempt.current?.key !== key)
      attempt.current = { key, id: crypto.randomUUID() };
    try {
      const response = await fetch("/api/returns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        cache: "no-store",
        body: JSON.stringify({ ...fields, requestId: attempt.current.id }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) {
        const message =
          response.status === 429
            ? "Too many return requests. Please try again later."
            : response.status === 409
              ? "These details differ from an earlier request. Refresh the page to start a new request."
              : response.status === 400
                ? "Please check your details and try again."
                : "We could not confirm your return request. Keep your details and try again; retrying unchanged details will not create a duplicate.";
        throw new Error(message);
      }
      const data: ReturnReceipt = await response.json();
      if (
        !/^RMA-[a-f0-9-]{36}$/.test(data.reference) ||
        data.status !== "pending-review" ||
        typeof data.localDevelopment !== "boolean"
      )
        throw new Error(
          "We could not confirm your reference. Please try again with the same details.",
        );
      setReceipt(data);
      setFields({ ...initialReturn });
    } catch (error) {
      setFailure(
        error instanceof Error &&
          error.name !== "TimeoutError" &&
          error.name !== "TypeError"
          ? error.message
          : "The connection was interrupted. Keep your details and try again; retrying unchanged details will not create a duplicate.",
      );
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }
  function downloadReceipt() {
    if (!receipt) return;
    const url = URL.createObjectURL(
      new Blob(
        [
          `3D PRNT — Return request\nReference: ${receipt.reference}\nStatus: Pending review\n${receipt.tracking ? `Private tracking link (keep secret): ${trackingUrl(receipt.tracking)}\nExpires: ${receipt.tracking.expiresAt}\n` : ""}Handling fee: ${RETURN_HANDLING_FEE_PERCENT}% of any approved refund amount, deducted before the refund is paid. No payment is taken when submitting this request.\n${receipt.localDevelopment ? "LOCAL TEST ONLY — not submitted to the business; cleared when the development server restarts.\n" : ""}Submitting a request does not approve a return or refund. No confirmation email has been sent. Keep your item, packaging and any photos until you receive instructions.\n`,
        ],
        { type: "text/plain;charset=utf-8" },
      ),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "3d-prnt-return-reference.txt";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const error = (name: keyof ReturnFields) =>
    errors[name] && (
      <span className="field-error" id={`return-error-${name}`}>
        {errors[name]}
      </span>
    );
  const input = (
    name: "name" | "email" | "orderReference" | "item" | "quantity",
    label: string,
    max: number,
    type = "text",
  ) => (
    <div className="form-field">
      <label htmlFor={`return-${name}`}>{label} *</label>
      <input
        id={`return-${name}`}
        name={name}
        type={type}
        value={fields[name]}
        maxLength={max}
        min={name === "quantity" ? 1 : undefined}
        max={name === "quantity" ? 100 : undefined}
        step={name === "quantity" ? 1 : undefined}
        autoComplete={
          name === "name" ? "name" : name === "email" ? "email" : "off"
        }
        required
        onChange={(event) => change(name, event.target.value)}
        aria-invalid={!!errors[name]}
        aria-describedby={errors[name] ? `return-error-${name}` : undefined}
      />
      {error(name)}
    </div>
  );
  return (
    <section
      className="section returns-section"
      id="returns"
      aria-labelledby="returns-title"
    >
      <div className="container custom-grid">
        <div className="custom-intro">
          <div className="eyebrow">LET’S PUT IT RIGHT</div>
          <h2 id="returns-title">
            Something wrong?
            <br />
            <span className="gradient">Tell us about it.</span>
          </h2>
          <p className="section-desc">
            If your print arrived broken, isn’t working as expected, or you have
            another reason to return it, log a request here. No account needed.
          </p>
          <div className="enquiry-steps">
            <div>
              <span>01</span>
              <p>
                <b>Share the details</b>
                <br />
                Include your order or payment reference, the item and what
                happened.
              </p>
            </div>
            <div>
              <span>02</span>
              <p>
                <b>Keep your reference</b>
                <br />
                Your request is saved for review. Keep the item, packaging and
                any photos.
              </p>
            </div>
            <div>
              <span>03</span>
              <p>
                <b>Wait for return instructions</b>
                <br />A request needs review before a return, replacement or
                refund is agreed. Please don’t send the item back yet.
              </p>
            </div>
          </div>
          <p className="contact-note">
            Submitting a reason does not automatically approve a return or
            refund. Your preferred outcome helps with the review. Photos cannot
            be uploaded here yet.
          </p>
        </div>
        {receipt ? (
          <div
            className="quote-form return-confirmation"
            role="status"
            tabIndex={-1}
            ref={confirmation}
          >
            <div className="eyebrow">
              {receipt.localDevelopment
                ? "LOCAL TEST RECEIVED"
                : "REQUEST RECEIVED"}
            </div>
            <h3>
              {receipt.localDevelopment
                ? "Your test request is ready."
                : "Your return request is logged."}
            </h3>
            <p className="return-reference">{receipt.reference}</p>
            <p>
              Status: <strong>Pending review</strong>
            </p>
            <p>
              A {RETURN_HANDLING_FEE_PERCENT}% handling fee will be deducted
              from any approved refund amount. The amount will be confirmed
              during review. No payment was taken when you submitted this
              request.
            </p>
            <p>
              Keep this reference. Your request has not yet been approved and no
              refund has been issued. No automatic confirmation email has been
              sent.
            </p>
            {receipt.localDevelopment && (
              <p className="form-note">
                Local development only: this test stays in server memory, is
                cleared on restart, and has not been submitted to the business.
              </p>
            )}
            {receipt.tracking ? (
              <TrackingLink access={receipt.tracking} />
            ) : (
              <p className="form-note">
                Your request was saved, but a tracking link could not be
                created. Keep your return reference for support.
              </p>
            )}
            <div className="return-actions">
              <button className="btn primary" onClick={downloadReceipt}>
                SAVE RETURN REFERENCE ↓
              </button>
              <button
                className="btn"
                onClick={() => {
                  setReceipt(null);
                  attempt.current = null;
                  setFailure("");
                }}
              >
                Log another return
              </button>
            </div>
          </div>
        ) : (
          <form
            className="quote-form"
            ref={form}
            noValidate
            aria-busy={pending}
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <div className="form-heading">
              <h3>Log a return request</h3>
              <p>
                All fields are required. We use your contact details and request
                information to handle the return. Please don’t include
                passwords, card details or other sensitive information.
              </p>
            </div>
            <fieldset className="return-fields" disabled={pending}>
              <legend className="sr-only">Return details</legend>
              <div className="form-grid">
                {input("name", "Your name", 100)}
                {input("email", "Email address", 254, "email")}
              </div>
              {input("orderReference", "Order or payment reference", 120)}
              <div className="form-grid">
                {input("item", "Item name or description", 200)}
                {input("quantity", "Quantity to return", 3, "number")}
              </div>
              <div className="form-field">
                <label htmlFor="return-reason">Reason for return *</label>
                <select
                  id="return-reason"
                  name="reason"
                  required
                  value={fields.reason}
                  onChange={(event) => change("reason", event.target.value)}
                  aria-invalid={!!errors.reason}
                  aria-describedby={
                    errors.reason ? "return-error-reason" : undefined
                  }
                >
                  <option value="">Choose a reason</option>
                  {Object.entries(returnReasons).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
                {error("reason")}
              </div>
              <div className="form-field">
                <label htmlFor="return-description">What happened? *</label>
                <textarea
                  id="return-description"
                  name="description"
                  rows={4}
                  minLength={20}
                  maxLength={3000}
                  required
                  value={fields.description}
                  onChange={(event) =>
                    change("description", event.target.value)
                  }
                  aria-invalid={!!errors.description}
                  aria-describedby={`return-description-help${errors.description ? " return-error-description" : ""}`}
                />
                <span className="form-note" id="return-description-help">
                  20–3,000 characters. Describe the issue, when you noticed it
                  and any relevant details.
                </span>
                {error("description")}
              </div>
              <div className="form-field">
                <label htmlFor="return-resolution">Preferred outcome *</label>
                <select
                  id="return-resolution"
                  name="resolution"
                  value={fields.resolution}
                  required
                  onChange={(event) => change("resolution", event.target.value)}
                  aria-invalid={!!errors.resolution}
                  aria-describedby={
                    errors.resolution ? "return-error-resolution" : undefined
                  }
                >
                  {Object.entries(returnResolutions).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
                {error("resolution")}
              </div>
              <p className="contact-note" id="return-fee-notice">
                <strong>{RETURN_HANDLING_FEE_PERCENT}% handling fee</strong>
                <br />A {RETURN_HANDLING_FEE_PERCENT}% handling fee will be
                deducted from any approved refund amount before it is paid. For
                example, an approved R100 refund would have a R10 fee, leaving
                R90. The amount will be confirmed during review. No payment is
                taken when you submit this request.
              </p>
              <label className="return-consent" htmlFor="return-consent">
                <input
                  id="return-consent"
                  name="consent"
                  type="checkbox"
                  required
                  checked={fields.consent}
                  onChange={(event) => change("consent", event.target.checked)}
                  aria-invalid={!!errors.consent}
                  aria-describedby={`return-fee-notice${errors.consent ? " return-error-consent" : ""}`}
                />
                <span>
                  I understand the {RETURN_HANDLING_FEE_PERCENT}% handling fee
                  and agree that 3D PRNT may store these details and contact me
                  to handle this return request. *
                </span>
              </label>
              {error("consent")}
              <button className="btn primary return-submit" type="submit">
                {pending ? "LOGGING YOUR REQUEST…" : "LOG RETURN REQUEST ↗"}
              </button>
            </fieldset>
            {failure && (
              <p className="field-error" role="alert">
                {failure}
              </p>
            )}
            <p className="form-note">
              This site currently uses sandbox payments. A return request does
              not verify an order or payment. Save the reference shown after
              submitting; no automatic email is sent.
            </p>
          </form>
        )}
      </div>
    </section>
  );
}
