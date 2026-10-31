// Builds a searchable PDF: each page shows the page image, with the
// recognised text laid over it as invisible, selectable text.
import { PDFArray, PDFDocument } from "pdf-lib";

import { imagePageSize } from "./text";

export type SearchablePage =
  | {
      kind: "ocr";
      /** tesseract.js's one-page, text-only PDF */
      textPdf: Uint8Array;
      /** the upright page image as JPEG, without any clean-up */
      jpeg: Uint8Array;
      /** size of the image in pixels */
      pixels: { width: number; height: number };
      /** page size in points; images get a size from their pixels */
      size?: { width: number; height: number };
    }
  | {
      kind: "copy";
      /** a PDF that already has text: its page is copied as it is */
      pdf: Uint8Array;
      index: number;
    };

export const buildSearchablePdf = async (pages: SearchablePage[]) => {
  const out = await PDFDocument.create();
  const sources = new Map<Uint8Array, PDFDocument>();
  for (const page of pages) {
    if (page.kind === "copy") {
      let source = sources.get(page.pdf);
      if (!source) {
        source = await PDFDocument.load(page.pdf, {
          ignoreEncryption: true,
          updateMetadata: false,
        });
        sources.set(page.pdf, source);
      }
      const [copy] = await out.copyPages(source, [page.index]);
      out.addPage(copy);
      continue;
    }
    const textDoc = await PDFDocument.load(page.textPdf, { updateMetadata: false });
    const [copy] = await out.copyPages(textDoc, [0]);
    out.addPage(copy);
    const size = page.size ?? imagePageSize(page.pixels.width, page.pixels.height);
    const { width, height } = copy.getSize();
    copy.scale(size.width / width, size.height / height);
    const jpeg = await out.embedJpg(page.jpeg);
    copy.drawImage(jpeg, { x: 0, y: 0, width: size.width, height: size.height });
    // move the image to the start, so the invisible text sits on top of it
    const contents = copy.node.Contents();
    if (contents instanceof PDFArray && contents.size() > 1) {
      const image = contents.get(contents.size() - 1);
      contents.remove(contents.size() - 1);
      contents.insert(0, image);
    }
  }
  out.setTitle("Recognised text");
  out.setProducer("Solvey Image to Text");
  out.setCreator("Solvey Image to Text");
  return out.save();
};
