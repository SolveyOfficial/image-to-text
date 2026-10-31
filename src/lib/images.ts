import type { PDFPageProxy } from "pdfjs-dist";

import { UserError } from "./errors";
import type { InputFile } from "./files";
import { renderPage, safeScale } from "./render";
import { adjustPixels, rotatedSize, type Cleanup } from "./text";

/**
 * Opens an image file. The browser applies the EXIF orientation, so phone
 * photos come out upright. Very large images are made smaller.
 */
export const openImage = async (file: InputFile): Promise<HTMLCanvasElement> => {
  const blob = new Blob([file.bytes as BlobPart], { type: file.type });
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" });
  } catch {
    throw new UserError(`"${file.name}" is not an image this browser can open.`);
  }
  const scale = safeScale(bitmap.width, bitmap.height, 1, 25_000_000);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d")!;
  // transparent areas become white, like paper
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas;
};

/** Renders a PDF page at about 300 DPI (less for very large pages). */
export const renderForOcr = (page: PDFPageProxy) => {
  const { width, height } = page.getViewport({ scale: 1 });
  return renderPage(page, safeScale(width, height, 300 / 72, 25_000_000));
};

/** Copies a canvas, scaled by `scale` and turned by `degrees` clockwise. */
export const transformCanvas = (
  source: HTMLCanvasElement,
  degrees: number,
  scale = 1,
) => {
  const width = Math.max(1, Math.round(source.width * scale));
  const height = Math.max(1, Math.round(source.height * scale));
  const size = rotatedSize(width, height, degrees);
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext("2d")!;
  context.translate(size.width / 2, size.height / 2);
  context.rotate((degrees * Math.PI) / 180);
  context.drawImage(source, -width / 2, -height / 2, width, height);
  return canvas;
};

/** A copy of the canvas improved for recognition (see adjustPixels). */
export const cleanUp = (source: HTMLCanvasElement, cleanup: Cleanup) => {
  if (cleanup === "none") {
    return source;
  }
  const canvas = transformCanvas(source, 0);
  const context = canvas.getContext("2d", { willReadFrequently: true })!;
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  adjustPixels(image.data, cleanup);
  context.putImageData(image, 0, 0);
  return canvas;
};

/** Small copy of a canvas for previews. */
export const thumbnail = (source: HTMLCanvasElement, longSide = 240) =>
  transformCanvas(
    source,
    0,
    Math.min(1, longSide / Math.max(source.width, source.height)),
  );
