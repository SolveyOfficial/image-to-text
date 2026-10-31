import { describe, expect, it } from "vitest";

import { formatBytes, isImage, isPdf, outputName } from "../src/lib/files";
import {
  adjustPixels,
  averageConfidence,
  confidenceLabel,
  DEFAULT_LANGUAGES,
  downloadBase,
  hasText,
  imagePageSize,
  joinPages,
  LANGUAGES,
  normaliseRotation,
  pickLanguages,
  rotatedSize,
  textFromPieces,
  tidyText,
} from "../src/lib/text";

const pixels = (...values: number[][]) => new Uint8ClampedArray(values.flat());

describe("languages", () => {
  it("lists the eleven languages with English and Hindi by default", () => {
    expect(LANGUAGES.map((language) => language.code)).toEqual([
      "eng",
      "hin",
      "mar",
      "ben",
      "tam",
      "tel",
      "guj",
      "kan",
      "mal",
      "pan",
      "urd",
    ]);
    expect(DEFAULT_LANGUAGES).toEqual(["eng", "hin"]);
  });

  it("keeps known codes in a fixed order without duplicates", () => {
    expect(pickLanguages(["urd", "eng", "xyz", "eng"])).toEqual(["eng", "urd"]);
    expect(pickLanguages([])).toEqual([]);
  });
});

describe("rotation", () => {
  it("normalises angles to quarter turns", () => {
    expect(normaliseRotation(0)).toBe(0);
    expect(normaliseRotation(-90)).toBe(270);
    expect(normaliseRotation(450)).toBe(90);
    expect(normaliseRotation(-540)).toBe(180);
    expect(normaliseRotation(89)).toBe(90);
  });

  it("swaps width and height for quarter turns", () => {
    expect(rotatedSize(100, 50, 90)).toEqual({ width: 50, height: 100 });
    expect(rotatedSize(100, 50, 180)).toEqual({ width: 100, height: 50 });
    expect(rotatedSize(100, 50, -90)).toEqual({ width: 50, height: 100 });
  });
});

describe("adjustPixels", () => {
  it("leaves pixels alone for no clean-up", () => {
    const data = pixels([10, 20, 30, 255]);
    adjustPixels(data, "none");
    expect([...data]).toEqual([10, 20, 30, 255]);
  });

  it("turns colours into grey and keeps alpha", () => {
    const data = pixels([255, 0, 0, 255], [0, 0, 255, 128]);
    adjustPixels(data, "grey");
    expect([...data]).toEqual([76, 76, 76, 255, 29, 29, 29, 128]);
  });

  it("stretches grey levels to full black and white", () => {
    const data = pixels(
      ...Array.from({ length: 50 }, () => [100, 100, 100, 255]),
      ...Array.from({ length: 50 }, () => [150, 150, 150, 255]),
    );
    adjustPixels(data, "contrast");
    expect(data[0]).toBe(0);
    expect(data[data.length - 4]).toBe(255);
  });

  it("ignores the extreme 1% when stretching", () => {
    const data = pixels(
      [0, 0, 0, 255],
      ...Array.from({ length: 99 }, (_, i) =>
        i < 50 ? [100, 100, 100, 255] : [200, 200, 200, 255],
      ),
    );
    adjustPixels(data, "contrast");
    expect(data[4]).toBe(0);
    expect(data[data.length - 4]).toBe(255);
  });

  it("keeps a flat image as it is", () => {
    const data = pixels([120, 120, 120, 255], [120, 120, 120, 255]);
    adjustPixels(data, "contrast");
    expect([...data]).toEqual([120, 120, 120, 255, 120, 120, 120, 255]);
  });
});

describe("PDF text", () => {
  it("joins text pieces into lines", () => {
    expect(
      textFromPieces([
        { str: "Hello", hasEOL: false },
        { str: " ", hasEOL: false },
        { str: "world  ", hasEOL: true },
        { type: "beginMarkedContent" },
        { str: "Second line", hasEOL: true },
        { str: "", hasEOL: true },
        { str: "", hasEOL: true },
        { str: "", hasEOL: true },
        { str: "End", hasEOL: false },
      ]),
    ).toBe("Hello world\nSecond line\n\nEnd");
  });

  it("tells pages with text from scans", () => {
    expect(hasText("")).toBe(false);
    expect(hasText(" . - ")).toBe(false);
    expect(hasText("Page 1")).toBe(true);
    expect(hasText("नमस्ते दुनिया")).toBe(true);
  });
});

describe("text output", () => {
  it("tidies recognised text", () => {
    expect(tidyText("  Hello  \r\nworld \n\n\n\nEnd\n\n")).toBe("  Hello\nworld\n\nEnd");
  });

  it("adds page headings only for several pages", () => {
    expect(joinPages([{ label: "a.png", text: "One" }])).toBe("One");
    expect(
      joinPages([
        { label: "a.pdf · page 1", text: "One" },
        { label: "a.pdf · page 2", text: "Two" },
      ]),
    ).toBe("--- a.pdf · page 1 ---\nOne\n\n--- a.pdf · page 2 ---\nTwo");
  });

  it("averages confidences", () => {
    expect(averageConfidence([])).toBeNull();
    expect(averageConfidence([90, 81.5])).toBe(86);
  });

  it("labels confidence", () => {
    expect(confidenceLabel(95)).toBe("high");
    expect(confidenceLabel(85)).toBe("high");
    expect(confidenceLabel(70)).toBe("medium");
    expect(confidenceLabel(10)).toBe("low");
  });

  it("names downloads after a single file", () => {
    expect(downloadBase(["scan.pdf", "scan.pdf"])).toBe("scan");
    expect(downloadBase(["a.png", "b.png"])).toBe("image-to-text");
    expect(downloadBase([".png"])).toBe("document");
  });
});

describe("imagePageSize", () => {
  it("keeps small images at their pixel size", () => {
    expect(imagePageSize(400, 300)).toEqual({ width: 400, height: 300 });
  });

  it("fits large images on an A4-sized page", () => {
    expect(imagePageSize(3000, 4000)).toEqual({ width: 631.5, height: 842 });
  });
});

describe("files", () => {
  it("recognises PDFs and images", () => {
    expect(isPdf({ name: "a.PDF", type: "" })).toBe(true);
    expect(isPdf({ name: "a", type: "application/pdf" })).toBe(true);
    expect(isImage({ name: "photo.webp", type: "" })).toBe(true);
    expect(isImage({ name: "x", type: "image/heic" })).toBe(true);
    expect(isImage({ name: "notes.txt", type: "text/plain" })).toBe(false);
  });

  it("names outputs and formats sizes", () => {
    expect(outputName("scan.pdf", "text", "txt")).toBe("scan-text.txt");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(3 * 1024 * 1024)).toBe("3.0 MB");
  });
});
