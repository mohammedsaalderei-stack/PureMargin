/* BrowserPrintAdapter: the browser's own print dialog.

   The one way to print that every browser has, and the answer for any printer
   the computer already has installed. It prints a picture of the receipt and
   a person presses Print — so it cannot open a cash drawer, cannot cut, and
   cannot tell whether anything came out. It says so (`capabilities`), and the
   settings screen and the job manager believe it. */

import { PrintError } from "../PrintJobManager.js";

export function createBrowserPrintAdapter() {
  return {
    id: "browser",
    capabilities: () => ({ raw: false, drawer: false, cut: false, silent: false, reports: false }),

    send(printer, { pictures, paper = 80 }) {
      if (typeof document === "undefined") return Promise.reject(new PrintError("nodialog"));
      return new Promise((resolve, reject) => {
        const frame = document.createElement("iframe");
        frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;";
        document.body.appendChild(frame);
        const doc = frame.contentWindow.document;
        doc.open();
        doc.write(`<!doctype html><html><head><style>@page{size:${paper}mm auto;margin:0}body{margin:0}img{width:${paper}mm;display:block}</style></head><body>${pictures.map((url) => `<img src="${url}">`).join("")}</body></html>`);
        doc.close();
        const images = [...doc.querySelectorAll("img")];
        let left = images.filter((img) => !img.complete).length;
        const go = () => {
          try {
            frame.contentWindow.focus();
            frame.contentWindow.print();
          } catch (err) {
            frame.remove();
            reject(new PrintError("nodialog", String(err?.message || err)));
            return;
          }
          setTimeout(() => { frame.remove(); resolve({ state: "dialog", confirmed: false }); }, 1000);
        };
        if (!left) go();
        else images.forEach((img) => { img.onload = img.onerror = () => { left -= 1; if (!left) go(); }; });
      });
    },
  };
}
