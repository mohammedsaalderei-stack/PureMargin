import { useEffect, useRef, useState } from "react";
import { prefersReducedMotion } from "./hooks.js";

/* Cross-fades between screens and slides in the direction of travel:
   moving down the tab list slides one way, moving back slides the other.
   The direction is the point — it tells you where you went. */
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
    }, 130);
    return () => clearTimeout(id);
  }, [screenKey, children, instant]);

  const offset = direction >= 0 ? 14 : -14;

  return (
    <div
      className="h-full"
      style={{
        opacity: phase === "out" ? 0 : 1,
        transform: phase === "out" ? `translateY(${offset * 0.5}px)` : "none",
        transition:
          phase === "out"
            ? "opacity .13s ease-in, transform .13s ease-in"
            : "opacity .3s ease-out, transform .34s cubic-bezier(.2,.75,.3,1)",
      }}
    >
      <div
        key={currentKey.current}
        style={
          instant
            ? undefined
            : {
                height: "100%",
                animation: `screen-enter .36s cubic-bezier(.2,.75,.3,1) both`,
                "--enter-from": `${offset}px`,
              }
        }
      >
        {shown}
      </div>
    </div>
  );
}
