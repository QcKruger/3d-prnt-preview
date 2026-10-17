import { MobileDisclosure } from "./Layout";
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
export function Services() {
  return (
    <section className="section services-section" id="services">
      <div className="container">
        <div className="eyebrow">WHAT WE DO</div>
        <h2 className="reveal">
          {"More than just "}
          <span className="gradient">printing.</span>
        </h2>
        <MobileDisclosure title="Explore our services">
          <div className="services">
            <div className="service">
              <div className="service-icon">◈</div>
              <h3>Custom 3D Printing</h3>
              <p>
                Got an STL file? Send it over and we'll turn your digital model
                into something you can hold.
              </p>
            </div>
            <div className="service">
              <div className="service-icon">✧</div>
              <h3>Personalised Gifts</h3>
              <p>
                Names, colours and custom details that make every piece uniquely
                yours.
              </p>
            </div>
            <div className="service">
              <div className="service-icon">⬡</div>
              <h3>{"Prototypes & Parts"}</h3>
              <p>
                Bring ideas to life with functional prototypes, replacement
                parts and practical solutions.
              </p>
            </div>
          </div>
        </MobileDisclosure>
      </div>
    </section>
  );
}
export function Process() {
  return (
    <section className="section" id="process">
      <div className="container">
        <div className="eyebrow">SIMPLE FROM START TO FINISH</div>
        <h2 className="reveal">
          {"From idea to "}
          <span className="gradient">your doorstep.</span>
        </h2>
        <p className="section-desc">
          A straightforward experience, whether you choose from the shop or
          bring your own design.
        </p>
        <MobileDisclosure title="How your print comes to life">
          <div className="steps">
            <div className="step">
              <div className="step-num">01 /</div>
              <h3>Choose or create</h3>
              <p>
                Browse the collection or upload your own 3D model to request a
                custom print.
              </p>
            </div>
            <div className="step">
              <div className="step-num">02 /</div>
              <h3>Make it yours</h3>
              <p>
                Tell us your preferred size, colour and material. We'll confirm
                the details before printing.
              </p>
            </div>
            <div className="step">
              <div className="step-num">03 /</div>
              <h3>We bring it to life</h3>
              <p>
                Once approved, your design moves from a digital file to a
                physical object.
              </p>
            </div>
          </div>
        </MobileDisclosure>
      </div>
    </section>
  );
}
export const faqItems = [
  [
    "Can I request a custom print without a model?",
    "Yes. Start with a description of your idea in the enquiry form. Dimensions, intended use and a preferred colour help define the project. Design feasibility and any modelling work will need to be confirmed.",
  ],
  [
    "Which model files can I select?",
    "You can select STL, OBJ and 3MF files. At this stage, files stay on your device. The saved enquiry brief includes the filename, so keep the model separately for when contact channels open.",
  ],
  [
    "Can I choose a colour, material or size?",
    "You can include your preferences in your enquiry. Final material, colour availability, dimensions and pricing will be confirmed before printing.",
  ],
  [
    "How long will printing and delivery take?",
    "Timing depends on the model, quantity and finishing requirements. Production lead times, delivery options and costs will be confirmed with your order before payment.",
  ],
  [
    "Can I place an online order today?",
    "You can try PayFast sandbox checkout using test funds, explore products, and save a custom enquiry brief. Sandbox transactions do not create real orders. Completing or cancelling checkout returns to our preview website; payment notifications are not connected yet.",
  ],
];
export function Faq() {
  return (
    <section className="section" id="faq">
      <div className="container faq">
        <div className="eyebrow">A LITTLE CLARITY</div>
        <h2 className="reveal">
          Good questions.
          <br />
          <span className="gradient">Straight answers.</span>
        </h2>
        {faqItems.map(([e, t]) => (
          <details key={e}>
            <summary>{e}</summary>
            <p>{t}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
