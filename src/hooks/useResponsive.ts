import * as React from "react";
export function useIsMobile() {
  const [mobile, setMobile] = React.useState(
    () => window.matchMedia("(max-width:600px)").matches,
  );
  React.useEffect(() => {
    const query = window.matchMedia("(max-width:600px)");
    const update = () => setMobile(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return mobile;
}
export function useMobileNavigation() {
  const [open, setOpen] = React.useState(false);
  const toggleRef = React.useRef<HTMLButtonElement>(null);
  React.useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        toggleRef.current?.focus();
      }
    };
    const query = window.matchMedia("(min-width:901px)");
    const onViewportChange = () => {
      if (query.matches) setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    query.addEventListener("change", onViewportChange);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      query.removeEventListener("change", onViewportChange);
    };
  }, [open]);
  return {
    open,
    toggleRef,
    toggle: () => setOpen((value) => !value),
    close: () => setOpen(false),
  };
}
