/* Taking the clock-in photograph with the phone's own camera.

   ── Why not just leave the file input alone ──────────────────────────────

   `<input type="file" capture="environment">` does open the camera inside a
   WKWebView, so the web code already half-works in the app. It was left in
   place for the web and replaced in the app for two reasons.

   The first is that it is not actually the camera: it is a sheet offering
   Photo Library, Take Photo and Browse. A cook arriving for a shift, on a
   phone they are holding in one hand, should get a viewfinder. The second is
   that Guideline 4.2 rejects apps that are a website in a frame, and what
   separates the two in a reviewer's hands is whether anything behaves like
   the device it is on. A native camera sheet is the clearest answer
   available, and it is the one feature this app uses that a bookmark cannot.

   ── The shape of the adapter ─────────────────────────────────────────────

   The downstream code is untouched: `prepareShot` takes a `File`, and so this
   produces one. Only how the bytes are obtained changes, which is the whole
   of the difference between the two platforms.

   The plugin is imported dynamically so that a browser never loads it. */

import { isNativePlatform } from "../platform.js";

export function nativeCameraAvailable(scope = globalThis) {
  return isNativePlatform(scope);
}

/* base64 → File, without a data: URL and without `fetch`.

   `CapacitorHttp` is enabled, which patches `fetch` to go through native
   networking, and handing that a `data:` URL is asking the wrong component a
   question it has no reason to answer. Decoding here keeps the photograph
   away from anything that could be routed over a network.

   Exported for its own test: a photograph that arrives corrupted produces a
   clock-in record with an unreadable image against somebody's name, which
   nobody discovers until a dispute. */
export function fileFromBase64(base64, { type = "image/jpeg", name = "clockin.jpg" } = {}) {
  if (typeof base64 !== "string" || base64 === "") return null;

  /* The plugin returns bare base64, but a data URL arriving here instead is
     a one-character fix rather than a corrupt photograph. */
  const bare = base64.includes(",") ? base64.slice(base64.indexOf(",") + 1) : base64;

  let binary;
  try {
    binary = atob(bare);
  } catch {
    return null;
  }

  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], name, { type });
}

/* Open the camera. Returns a File, or null if the person backed out.

   Null is not an error and must not be reported as one: closing the camera
   is how somebody changes their mind about which door they are standing at,
   and an error toast for it would be noise at the one moment the app is
   being used by somebody who did not choose to install it. */
export async function captureNative() {
  try {
    const { Camera, CameraResultType, CameraSource } = await import("@capacitor/camera");

    const photo = await Camera.getPhoto({
      quality: 85,
      /* The shot is downscaled to 1000px by `prepareShot` anyway, and asking
         for less here means less to hold in memory on an old phone in a hot
         kitchen. */
      width: 1600,
      allowEditing: false,
      resultType: CameraResultType.Base64,
      source: CameraSource.Camera,
      direction: "REAR",
      /* Without this an upside-down phone produces an upside-down record.
         The web path solves the same problem with
         `createImageBitmap(file, { imageOrientation: "from-image" })`. */
      correctOrientation: true,
      saveToGallery: false,
    });

    if (!photo?.base64String) return null;
    return fileFromBase64(photo.base64String, {
      type: photo.format ? `image/${photo.format}` : "image/jpeg",
      name: `clockin.${photo.format || "jpg"}`,
    });
  } catch {
    /* The plugin throws on cancellation as well as on a denied permission,
       and does not reliably distinguish them. Both end the same way: no
       photograph, no complaint, the button still there to press again. */
    return null;
  }
}
