/**
 * Client-side image downscaling + re-encoding for the capture page.
 *
 * Phone cameras routinely produce 5–12 MB photos (and iPhones default to HEIC),
 * which the upload path used to reject outright. We downscale to a sane max
 * dimension and re-encode as JPEG so a handwritten-notes photo is legible but
 * lands well under the storage cap. Runs entirely in the browser — never call
 * from server code (it touches `document` / `canvas`).
 */

// Claude's vision API downsamples images to ~1568px on the long edge before it
// ever reads them, so uploading anything larger costs mobile-upload time for
// zero gain in OCR accuracy. 1600px @ 0.75 keeps handwriting legible while
// landing most phone photos under ~600 KB.
const MAX_DIM = 1600;
const JPEG_QUALITY = 0.75;

/**
 * Downscale + re-encode an image File to JPEG. Returns the original File
 * untouched on any failure (non-image, decode error, no canvas) so the caller's
 * own size/type guards still apply as a fallback.
 */
export async function compressImage(file: File): Promise<File> {
  if (!file.type.startsWith("image/")) return file;

  try {
    const source = await loadDecodable(file);
    const srcW = "width" in source ? source.width : 0;
    const srcH = "height" in source ? source.height : 0;
    if (!srcW || !srcH) return file;

    const scale = Math.min(1, MAX_DIM / Math.max(srcW, srcH));
    const w = Math.round(srcW * scale);
    const h = Math.round(srcH * scale);

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(source as CanvasImageSource, 0, 0, w, h);
    if (typeof ImageBitmap !== "undefined" && source instanceof ImageBitmap) {
      source.close();
    }

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY),
    );
    if (!blob) return file;

    // If re-encoding somehow grew an already-small JPEG, keep the original.
    if (file.type === "image/jpeg" && blob.size >= file.size) return file;

    const name = file.name.replace(/\.[^.]+$/, "") + ".jpg";
    return new File([blob], name, {
      type: "image/jpeg",
      lastModified: Date.now(),
    });
  } catch {
    return file;
  }
}

/** Decode a File to something canvas can draw, honoring EXIF orientation. */
async function loadDecodable(
  file: File,
): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      /* HEIC / unsupported codec — fall back to <img> */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("decode failed"));
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}
