/* Whether a full-screen app frame (the back office or the register) is on
   screen, as a class on <html>.

   In the iPhone app the page's body is padded clear of the status bar and the
   home indicator, which is right for the pages that scroll as a document —
   sign-in, the landing page. For a full-screen frame it left a strip of bare
   background above the header and below the tab bar, so neither reached the
   edge of the glass. With this class set, the frame takes the whole screen and
   its header and tab bar carry the insets themselves (`index.css`). Counted,
   so a frame unmounting while another mounts does not clear it. */

import { useEffect } from "react";

let frames = 0;

export function useAppFrame() {
  useEffect(() => {
    frames += 1;
    document.documentElement.classList.add("app-frame-on");
    return () => {
      frames -= 1;
      if (frames <= 0) {
        frames = 0;
        document.documentElement.classList.remove("app-frame-on");
      }
    };
  }, []);
}
