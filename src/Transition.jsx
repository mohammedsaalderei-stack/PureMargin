import { useEffect, useRef, useState } from "react";
import { prefersReducedMotion } from "./hooks.js";

/* Cross-fades between screens and slides in the direction of travel:
   moving down the tab list slides one way, moving back slides the other.
   The direction is the point — it tells you where you went.

   Tuned for a premium, fluid hand-off: a brief blur-out as the old screen
   recedes, then a spring-eased settle with a subtle scale for the new one. */
export default function Transition({ screenKey, direction = 1, children }) {
  const instant = prefersReducedMotion();
  const [shown, setShown] = useState(children);
  const [phase, setPhase] = useState("in");
  const currentKey = useRef(screenKey);

  useEffect(() => {
    if (screenKey === currentKey.current) {
      setShown(children);
      return;
    }
    if (instant) {
      currentKey.current = screenKey;
      setShown(children);
      return;
    }
    setPhase("out");
    const id = setTimeout(() => {
      currentKey.current = screenKey;
      setShown(children);
      setPhase("in");
    }, 150);
    return () => clearTimeout(id);
  }, [screenKey, children, instant]);

  const offset = direction >= 0 ? 16 : -16;

  const outStyle = {
    opacity: 0,
    transform: `translateY(${offset * 0.4}px) scale(0.992)`,
    filter: "blur(4px)",
    transition: "opacity .15s ease-in, transform .15s ease-in, filter .15s ease-in",
  };
  const inStyle = {
    opacity: 1,
    transform: "none",
    filter: "none",
    transition:
      "opacity .42s cubic-bezier(.2,.75,.3,1), transform .5s cubic-bezier(.2,.75,.3,1), filter .3s ease-out",
  };

  return (
    <div className="h-full" style={phase === "out" ? outStyle : inStyle}>
      <div
        key={currentKey.current}
        style={
          instant
            ? { height: "100%" }
            : {
                height: "100%",
                animation: `screen-enter .42s cubic-bezier(.2,.75,.3,1) both`,
                "--enter-from": `${offset}px`,
              }
        }
      >
        {shown}
      </div>
    </div>
  );
}
