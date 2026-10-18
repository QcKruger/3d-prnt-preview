import {
  PaymentNotice,
  PreviewNotice,
  Header,
  Footer,
} from "./components/Layout";
import { Hero, Services, Process, Faq } from "./components/HomeSections";
import { Shop } from "./features/catalogue";
import { CartDrawer } from "./features/cart";
import { CustomPrints } from "./features/enquiry";
import { useStore } from "./hooks/useStore";
import { usePageEffects } from "./hooks/usePageEffects";
import { useContent } from "./hooks/useContent";
import { Returns } from "./features/returns";
import { GuestTracking } from "./features/tracking";
function App() {
  const content = useContent();
  let store = useStore(content);
  let { progressRef, ambientRef } = usePageEffects();
  return (
    <>
      <div
        className="scroll-progress"
        id="scrollProgress"
        ref={progressRef}
        aria-hidden="true"
      />
      <div
        className="ambient"
        id="ambient"
        ref={ambientRef}
        aria-hidden="true"
      />
      <Header
        count={store.cartProducts.length}
        onOpenCart={() => store.setCartOpen(true)}
      />
      <main>
        <PreviewNotice />
        <PaymentNotice />
        <Hero />
        {content.products.length > 0 && <Shop store={store} />}
        <Services items={content.services} />
        <Process items={content.processSteps} />
        <CustomPrints notify={store.notify} />
        <Faq items={content.faqs} />
        <Returns />
        <GuestTracking />
      </main>
      <Footer />
      <div
        className={`toast${store.notification ? " show" : ""}`}
        id="toast"
        role="status"
        aria-live="polite"
      >
        {store.notification}
      </div>
      <CartDrawer store={store} />
    </>
  );
}
export default App;
