import { useEffect, useRef } from "react";

/* The back button closes what is open.

   Tabs already live in the URL, so back moves between them and always has. An
   overlay does not: the drawer, the chat list, the notifications sheet and the
   command palette are React state, so pressing back with one of them open
   skipped past it to the previous tab — or on a phone, left the app entirely
   from what looked to the user like a menu they had just opened.

   That is the wrong instinct to fight. On Android the back gesture is how
   people close things, and an app that exits instead feels broken in a way
   nobody reports because it looks like their own mistake.

   So an open overlay pushes a history entry it owns, and back pops that entry
   rather than the tab. Closing by any other means — tapping the scrim, the X,
   choosing an item — goes back one step itself, so the entry never outlives
   the thing it stood for and the history does not fill with ghosts.

   `replace: false` is deliberate: this is a stop the person chose to make, and
   back should return them to it, not past it. */

export default function useBackToClose(isOpen, close) {
  /* Whether this hook is the reason the current entry exists, so it only
     unwinds its own and never somebody else's. */
  const owns = useRef(false);

  useEffect(() => {
    if (isOpen && !owns.current) {
      owns.current = true;
      window.history.pushState({ overlay: true }, "");
      return undefined;
    }

    if (!isOpen && owns.current) {
      /* Closed by a tap rather than by back: take the entry away again, or the
         next back press would spend itself on an overlay already gone. */
      owns.current = false;
      if (window.history.state?.overlay) window.history.back();
      return undefined;
    }

    return undefined;
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return undefined;

    const onPop = () => {
      /* The entry is already gone by the time this fires — the browser popped
         it. Just close, and do not push or pop again. */
      owns.current = false;
      close();
    };

    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [isOpen, close]);
}
