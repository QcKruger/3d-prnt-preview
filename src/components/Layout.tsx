import type * as React from "react";
import { useIsMobile, useMobileNavigation } from "../hooks/useResponsive";
export function PaymentNotice() {
  let params = new URLSearchParams(window.location.search);
  let payment = params.get("payment");
  if (!payment) return null;
  return (
    <div className="payment-notice container" role="status">
      <strong>
        {payment === "cancel"
          ? "Sandbox checkout closed"
          : "Returned from sandbox checkout"}
      </strong>
      <p>
        No real payment or order has been placed. Payment notifications are not
        connected, so returning to this page does not confirm a payment.
      </p>
    </div>
  );
}
export function PreviewNotice() {
  return (
    <div className="preview-notice" role="note">
      Sandbox preview · Try PayFast checkout with test funds. No real payments
      or orders.
    </div>
  );
}
export function BrandLogo() {
  return (
    <a className="logo brand-logo" href="#home" aria-label="3D PRNT home">
      <img src="./3d-prnt-logo.png" alt="3D PRNT" width={64} height={64} />
      <span>
        3D PRNT
        <small>YOUR IDEAS. MADE REAL.</small>
      </span>
    </a>
  );
}
export function Header({
  count,
  onOpenCart,
}: {
  count: number;
  onOpenCart: () => void;
}) {
  let navigation = useMobileNavigation();
  return (
    <header>
      <div className="announcement">
        {"Made in South Africa "}
        <span>✦</span>
        {" Custom prints & everyday creations"}
      </div>
      <div className="container nav">
        <BrandLogo />
        <nav className="links" aria-label="Main navigation">
          <a href="#home">HOME</a>
          <a href="#shop">SHOP</a>
          <a href="#services">SERVICES</a>
          <a href="#custom">CUSTOM PRINTS</a>
        </nav>
        <div className="nav-actions">
          <button
            className="icon-btn mobile-toggle"
            aria-label={
              navigation.open ? "Close navigation" : "Open navigation"
            }
            aria-expanded={navigation.open}
            aria-controls="mobile-navigation"
            onClick={navigation.toggle}
            ref={navigation.toggleRef}
          >
            <span aria-hidden="true">{navigation.open ? "✕" : "☰"}</span>
            <span className="menu-label">Menu</span>
          </button>
          <button
            className="icon-btn"
            id="cartOpen"
            aria-label={`Open cart, ${count} items`}
            onClick={onOpenCart}
          >
            🛒{" "}
            <span className="count" id="cartCount">
              {count}
            </span>
          </button>
          <a className="btn primary" href="#custom">
            GET A QUOTE ↗
          </a>
        </div>
      </div>
      <nav
        className="mobile-navigation"
        id="mobile-navigation"
        aria-label="Mobile navigation"
        hidden={!navigation.open}
      >
        {[
          ["#home", "Home"],
          ["#shop", "Shop products"],
          ["#services", "Services"],
          ["#custom", "Custom prints"],
          ["#contact", "Contact"],
        ].map(([e, t]) => (
          <a href={e} onClick={navigation.close} key={e}>
            {t}
            <span>↗</span>
          </a>
        ))}
      </nav>
    </header>
  );
}
export function FieldLabel(props: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label {...props} />;
}
export function MobileDisclosure({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return useIsMobile() ? (
    <details className="mobile-disclosure">
      <summary>
        {title}
        <span aria-hidden="true">+</span>
      </summary>
      <div className="disclosure-content">{children}</div>
    </details>
  ) : (
    <>{children}</>
  );
}
export function Footer() {
  return (
    <footer className="business-footer" id="contact">
      <div className="container">
        <div className="footer-grid">
          <div>
            <BrandLogo />
            <p>
              Thoughtful objects. Personal touches.
              <br />
              Your ideas, made real in South Africa.
            </p>
            <span className="launch-pill">Online ordering coming soon</span>
          </div>
          <div>
            <h3>Explore</h3>
            <a href="#shop">Shop the collection</a>
            <a href="#services">Printing services</a>
            <a href="#custom">Custom print enquiries</a>
            <a href="#faq">Frequently asked questions</a>
          </div>
          <div>
            <h3>Get in touch</h3>
            <p>Business email coming soon.</p>
            <p>
              Contact details and social profiles will be added before launch.
            </p>
            <a href="#custom">Prepare an enquiry ↗</a>
          </div>
          <div>
            <h3>Before you order</h3>
            <p>
              Print specifications, lead times and delivery costs will be
              confirmed before payment.
            </p>
            <p>
              Delivery, returns and privacy information will be published before
              online orders open.
            </p>
          </div>
        </div>
        <div className="footer-bottom">
          <span>
            {"© "}
            {new Date().getFullYear()}
            {" 3D PRNT"}
          </span>
          <span>Designed to inspire. Made for real life.</span>
        </div>
      </div>
    </footer>
  );
}
