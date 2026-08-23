import { useReveal } from "../hooks.js";
import "./motion.css";

/* Vide Infra-style reveals. Each component observes itself and plays once
   when it enters view, so sections animate as you reach them rather than
   all firing on load. `delay` staggers siblings into a sequence. */

/* Type that rises from behind a hard clipping edge. Use for headings —
   `as` keeps the right heading level for the document outline. */
export function LineReveal({ children, delay = 0, className = "", as: Tag = "span", style }) {
  const [ref, shown] = useReveal(0.2);
  return (
    <span ref={ref} className="vi-mask">
      <Tag
        className={`vi-line ${shown ? "is-in" : ""} ${className}`}
        style={{ "--vi-delay": `${delay}ms`, ...style }}
      >
        {children}
      </Tag>
    </span>
  );
}

/* Supporting content that lifts into place behind the heading. */
export function Rise({ children, delay = 0, className = "", style }) {
  const [ref, shown] = useReveal(0.15);
  return (
    <div
      ref={ref}
      className={`vi-up ${shown ? "is-in" : ""} ${className}`}
      style={{ "--vi-delay": `${delay}ms`, ...style }}
    >
      {children}
    </div>
  );
}

/* A hairline that draws itself across as the section arrives. */
export function RuleReveal({ delay = 0, className = "", style }) {
  const [ref, shown] = useReveal(0.4);
  return (
    <div
      ref={ref}
      className={`vi-rule ${shown ? "is-in" : ""} ${className}`}
      style={{ "--vi-delay": `${delay}ms`, ...style }}
    />
  );
}
