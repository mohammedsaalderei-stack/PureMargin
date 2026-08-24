import { useState } from "react";
import { useC } from "./theme.jsx";

/* A dish photo from the POS catalogue.

   Most POS catalogues carry an image on items, so these are the owner's own
   photographs of their own food — not stock imagery and not an emoji
   standing in for one. When an item has no photo, or the URL fails, it
   falls back to a tile carrying the item's initials rather than a broken
   image icon or an empty gap. */
export default function ItemPhoto({ name, src, size = 96, radius = 18 }) {
  const C = useC();
  const [failed, setFailed] = useState(false);

  const initials = String(name || "")
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();

  const box = {
    width: size,
    height: size,
    borderRadius: radius,
    flexShrink: 0,
    overflow: "hidden",
  };

  if (!src || failed) {
    return (
      <div
        style={{ ...box, background: C.irisWash }}
        className="flex items-center justify-center"
        aria-label={name}
      >
        <span
          className="display font-extrabold"
          style={{ color: C.iris, fontSize: Math.max(13, size / 3.4) }}
        >
          {initials || "•"}
        </span>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={name}
      loading="lazy"
      onError={() => setFailed(true)}
      style={{ ...box, objectFit: "cover", background: C.bone }}
    />
  );
}
