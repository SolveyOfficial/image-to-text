// Pure helpers for languages, page text and images, kept free of browser
// APIs so they can be unit tested.

export interface Language {
  /** Tesseract language code, also the name of the data file. */
  code: string;
  name: string;
  /** Approximate download size of the language data in MB. */
  size: number;
}

export const LANGUAGES: Language[] = [
  { code: "eng", name: "English", size: 1.9 },
  { code: "hin", name: "Hindi", size: 0.9 },
  { code: "mar", name: "Marathi", size: 1 },
  { code: "ben", name: "Bengali", size: 0.6 },
  { code: "tam", name: "Tamil", size: 1.3 },
  { code: "tel", name: "Telugu", size: 1.2 },
  { code: "guj", name: "Gujarati", size: 0.7 },
  { code: "kan", name: "Kannada", size: 1.8 },
  { code: "mal", name: "Malayalam", size: 2.1 },
  { code: "pan", name: "Punjabi", size: 0.3 },
  { code: "urd", name: "Urdu", size: 1 },
];

export const DEFAULT_LANGUAGES = ["eng", "hin"];

/**
 * Keeps the known language codes, in the order of LANGUAGES, without
 * duplicates. Returns an empty list when none is known.
 */
export const pickLanguages = (codes: readonly string[]) =>
  LANGUAGES.filter((language) => codes.includes(language.code)).map(
    (language) => language.code,
  );

/** Turns any angle in degrees into 0, 90, 180 or 270. */
export const normaliseRotation = (degrees: number) =>
  ((((Math.round(degrees / 90) * 90) % 360) + 360) % 360) as 0 | 90 | 180 | 270;

/** Size of an image after turning it by `degrees`. */
export const rotatedSize = (width: number, height: number, degrees: number) =>
  normaliseRotation(degrees) % 180 === 0
    ? { width, height }
    : { width: height, height: width };

export type Cleanup = "none" | "grey" | "contrast";

/**
 * Improves an image for recognition, in place. "grey" turns RGBA pixels
 * into greyscale; "contrast" also stretches the grey levels so the darkest
 * 1% become black and the lightest 1% white.
 */
export const adjustPixels = (data: Uint8ClampedArray, cleanup: Cleanup) => {
  if (cleanup === "none") {
    return;
  }
  const histogram = new Uint32Array(256);
  for (let i = 0; i < data.length; i += 4) {
    const grey = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
    data[i] = data[i + 1] = data[i + 2] = grey;
    histogram[grey]++;
  }
  if (cleanup !== "contrast") {
    return;
  }
  const pixels = data.length / 4;
  const cut = Math.floor(pixels * 0.01);
  let low = 0;
  for (let seen = 0; low < 255 && seen + histogram[low] <= cut; low++) {
    seen += histogram[low];
  }
  let high = 255;
  for (let seen = 0; high > 0 && seen + histogram[high] <= cut; high--) {
    seen += histogram[high];
  }
  if (high - low < 1) {
    return;
  }
  const scale = 255 / (high - low);
  const map = new Uint8ClampedArray(256);
  for (let value = 0; value < 256; value++) {
    map[value] = Math.round((value - low) * scale);
  }
  for (let i = 0; i < data.length; i += 4) {
    data[i] = data[i + 1] = data[i + 2] = map[data[i]];
  }
};

/** A piece of text as pdf.js returns it from `getTextContent`. */
export interface TextPiece {
  str: string;
  hasEOL?: boolean;
}

/** Joins the text pieces of a PDF page into lines. */
export const textFromPieces = (pieces: readonly (TextPiece | object)[]) =>
  pieces
    .filter((piece): piece is TextPiece => "str" in piece)
    .map((piece) => piece.str + (piece.hasEOL ? "\n" : ""))
    .join("")
    .split("\n")
    .map((line) => line.replace(/\s+$/, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

/** Whether a PDF page's own text is worth using (scans have none). */
export const hasText = (text: string) => (text.match(/[\p{L}\p{N}]/gu) ?? []).length >= 5;

/** Tidies recognised text: no trailing spaces or runs of blank lines. */
export const tidyText = (text: string) =>
  text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+$/, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\n+|\s+$/g, "");

/** Puts the text of several pages together, with a heading for each page. */
export const joinPages = (pages: readonly { label: string; text: string }[]) =>
  pages.length === 1
    ? pages[0].text
    : pages.map(({ label, text }) => `--- ${label} ---\n${text}`).join("\n\n");

/** Mean of the confidences (0 to 100), rounded, or null for none. */
export const averageConfidence = (values: readonly number[]) =>
  values.length
    ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
    : null;

/** Describes a confidence value for people. */
export const confidenceLabel = (value: number) =>
  value >= 85 ? "high" : value >= 60 ? "medium" : "low";

/**
 * Page size in points for an image in the searchable PDF: the image's pixel
 * size, made smaller if needed so the longer side fits an A4 page.
 */
export const imagePageSize = (width: number, height: number, longSide = 842) => {
  const scale = Math.min(1, longSide / Math.max(width, height));
  return { width: width * scale, height: height * scale };
};

/** Base name for downloads: the file name when there is one file. */
export const downloadBase = (names: readonly string[]) => {
  const unique = [...new Set(names)];
  return unique.length === 1
    ? unique[0].replace(/\.[^.]+$/, "") || "document"
    : "image-to-text";
};
