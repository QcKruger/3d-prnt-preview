import { MobileDisclosure } from "./Layout";
import type { StorefrontContent } from "../content";
import {
  PRINT_LAYERS,
  usePrinterAnimation,
} from "../hooks/usePrinterAnimation";
export function Hero() {
  const { machineRef, layer, percent, reducedMotion } = usePrinterAnimation();
  return (
    <section className="hero" id="home">
      <div className="container hero-grid">
        <div>
          <div className="eyebrow">✦ YOUR IDEAS. MADE REAL.</div>
          <h1>
            Imagine it.
            <br />
            <span className="gradient">We'll print it.</span>
          </h1>
          <p>
            3D printed gifts, home accessories and practical everyday pieces,
            made in South Africa. Find something you love or create something
            entirely your own.
          </p>
          <div className="cta">
            <a className="btn primary" href="#shop">
              SHOP PRODUCTS ↗
            </a>
            <a className="btn secondary" href="#custom">
              REQUEST A CUSTOM PRINT
            </a>
          </div>
          <div className="metrics">
            <div>
              <strong>Made for you</strong>
              <small>Personalised creations</small>
            </div>
            <div>
              <strong>Local</strong>
              <small>Printed in South Africa</small>
            </div>
          </div>
        </div>
        <div
          className="machine"
          ref={machineRef}
          aria-label="Illustrative 3D printer animation"
        >
          <div className="machine-glow" />
          <div className="printer">
            <div className="rail" />
            <div className="head" />
            <div className="print-object" />
            <div className="bed" />
          </div>
          <div className="printer-status">
            <div className="printer-status-heading">
              <span className="pulse" />
              <strong>
                {reducedMotion
                  ? "Printer preview"
                  : layer === PRINT_LAYERS
                    ? "Print complete"
                    : "Print in progress"}
              </strong>
              <span>{percent}%</span>
            </div>
            <div
              className="printer-status-track"
              role="progressbar"
              aria-label="Illustrative print progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent}
              aria-valuetext={`Layer ${layer} of ${PRINT_LAYERS}. Animated demonstration.`}
            >
              <span />
            </div>
            <small>
              Layer {layer} of {PRINT_LAYERS} ·{" "}
              {reducedMotion ? "Reduced motion" : "Printer animation"}
            </small>
          </div>
        </div>
      </div>
    </section>
  );
}
export function Services({ items }: { items: StorefrontContent["services"] }) {
  if (!items.length) return null;
  return (
    <section className="section services-section" id="services">
      <div className="container">
        <div className="eyebrow">WHAT WE DO</div>
        <h2 className="reveal">
          More than just <span className="gradient">printing.</span>
        </h2>
        <MobileDisclosure title="Explore our services">
          <div className="services">
            {items.map((item) => (
              <div className="service" key={item.id}>
                <div className="service-icon">{item.icon}</div>
                <h3>{item.title}</h3>
                <p>{item.description}</p>
              </div>
            ))}
          </div>
        </MobileDisclosure>
      </div>
    </section>
  );
}
export function Process({
  items,
}: {
  items: StorefrontContent["processSteps"];
}) {
  if (!items.length) return null;
  return (
    <section className="section" id="process">
      <div className="container">
        <div className="eyebrow">SIMPLE FROM START TO FINISH</div>
        <h2 className="reveal">
          From idea to <span className="gradient">your doorstep.</span>
        </h2>
        <p className="section-desc">
          A straightforward experience, whether you choose from the shop or
          bring your own design.
        </p>
        <MobileDisclosure title="How your print comes to life">
          <div className="steps">
            {items.map((item, index) => (
              <div className="step" key={item.id}>
                <div className="step-num">
                  {String(index + 1).padStart(2, "0")} /
                </div>
                <h3>{item.title}</h3>
                <p>{item.description}</p>
              </div>
            ))}
          </div>
        </MobileDisclosure>
      </div>
    </section>
  );
}
export function Faq({ items }: { items: StorefrontContent["faqs"] }) {
  if (!items.length) return null;
  return (
    <section className="section" id="faq">
      <div className="container faq">
        <div className="eyebrow">A LITTLE CLARITY</div>
        <h2 className="reveal">
          Good questions.
          <br />
          <span className="gradient">Straight answers.</span>
        </h2>
        {items.map((item) => (
          <details key={item.id}>
            <summary>{item.question}</summary>
            <p>{item.answer}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
