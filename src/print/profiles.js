/* What a model of printer can do, and what it is told to do it.

   Receipt printers mostly speak ESC/POS, and mostly is the word: a printer
   with no cutter must not be sent a cut, Star printers only understand any
   of this in their ESC/POS emulation, and not every printer answers when
   asked whether it has paper. A profile is those differences written down
   once, so the settings screen offers only what the printer has and the job
   is built for the printer it is going to.

   `verified` is whether somebody has watched paper come out of that model
   with this code. It is false until that has happened — being compatible on
   the maker's data sheet is a claim, not a test — and the settings screen
   says which it is. */

export const PROFILES = [
  /* Raster image, partial cut, drawer on pin 2, real-time status. What an
     unknown ESC/POS printer most likely is. */
  { id: "escpos", name: "ESC/POS", cut: "partial", drawer: true, status: true, verified: false },
  { id: "ice-irp200d", name: "iCE IRP-200D", cut: "partial", drawer: true, status: true, verified: false },
  { id: "epson-tm", name: "Epson TM", cut: "partial", drawer: true, status: true, verified: false },
  /* Star's own language is not ESC/POS; the printer has to be switched to
     ESC/POS emulation first. Its status answers differ, so it is not asked. */
  { id: "star-escpos", name: "Star", cut: "partial", drawer: true, status: false, verified: false, note: "star" },
  { id: "xprinter", name: "Xprinter", cut: "partial", drawer: true, status: true, verified: false },
  { id: "bixolon", name: "Bixolon", cut: "partial", drawer: true, status: true, verified: false },
  /* Tear-bar printers, most 58 mm ones: paper is fed past the bar, not cut. */
  { id: "nocutter", name: "ESC/POS", cut: null, drawer: true, status: true, verified: false, note: "nocutter" },
];

export const DEFAULT_PROFILE = "escpos";

export const profileOf = (printer) =>
  PROFILES.find((p) => p.id === printer?.profile) || PROFILES.find((p) => p.id === DEFAULT_PROFILE);
