import { useEffect, useRef, useState } from "react";

export const PRINT_LAYERS = 187;

export function usePrinterAnimation() {
  const machineRef = useRef<HTMLDivElement>(null);
  const [layer, setLayer] = useState(142);
  const [reducedMotion, setReducedMotion] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(preference.matches);
    preference.addEventListener("change", update);
    return () => preference.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (reducedMotion) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        setLayer((previous) => (previous >= PRINT_LAYERS ? 1 : previous + 1));
      }
    }, 160);
    return () => window.clearInterval(timer);
  }, [reducedMotion]);

  useEffect(() => {
    // CSSOM updates keep the animation compatible with the strict style CSP.
    machineRef.current?.style.setProperty(
      "--print-progress",
      String(layer / PRINT_LAYERS),
    );
  }, [layer]);

  return {
    machineRef,
    layer,
    percent: Math.round((layer / PRINT_LAYERS) * 100),
    reducedMotion,
  };
}
