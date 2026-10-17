import * as React from "react";
export function usePageEffects() {
  const progressRef = React.useRef<HTMLDivElement>(null);
  const ambientRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("visible");
            observer.unobserve(entry.target);
          }
        });
      },
      {
        threshold: 0.1,
      },
    );
    document
      .querySelectorAll(".reveal")
      .forEach((element) => observer.observe(element));
    const updateProgress = () => {
      const height = document.documentElement.scrollHeight - window.innerHeight;
      if (progressRef.current)
        progressRef.current.style.width =
          (height > 0 ? (window.scrollY / height) * 100 : 0) + "%";
    };
    const moveAmbient = (event: PointerEvent) => {
      if (!ambientRef.current) return;
      ambientRef.current.style.left = event.clientX + "px";
      ambientRef.current.style.top = event.clientY + "px";
    };
    window.addEventListener("scroll", updateProgress, {
      passive: true,
    });
    window.addEventListener("resize", updateProgress);
    if (window.matchMedia("(pointer:fine)").matches)
      window.addEventListener("pointermove", moveAmbient, {
        passive: true,
      });
    updateProgress();
    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", updateProgress);
      window.removeEventListener("resize", updateProgress);
      window.removeEventListener("pointermove", moveAmbient);
    };
  }, []);
  return {
    progressRef,
    ambientRef,
  };
}
