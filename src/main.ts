import "./styles.css";

import type { PDFDocumentProxy } from "pdfjs-dist";

import { UserError } from "./lib/errors";
import { download, formatBytes, isImage, isPdf, type InputFile } from "./lib/files";
import {
  cleanUp,
  openImage,
  renderForOcr,
  thumbnail,
  transformCanvas,
} from "./lib/images";
import { prepare, recognise, type OcrProgress } from "./lib/ocr";
import {
  blobBytes,
  canvasToBlob,
  closePdf,
  openPdf,
  pageSize,
  renderPage,
} from "./lib/render";
import { buildSearchablePdf, type SearchablePage } from "./lib/searchable-pdf";
import {
  averageConfidence,
  confidenceLabel,
  DEFAULT_LANGUAGES,
  downloadBase,
  hasText,
  joinPages,
  LANGUAGES,
  normaliseRotation,
  pickLanguages,
  rotatedSize,
  textFromPieces,
  tidyText,
  type Cleanup,
} from "./lib/text";
import { choice, dropZone, h, iconButton, runTask, select, statusArea } from "./ui";

interface PageResult {
  text: string;
  /** null when the PDF's own text was used */
  confidence: number | null;
  pdf: SearchablePage | null;
}

interface PageItem {
  id: number;
  file: InputFile;
  label: string;
  /** 1-based page number for PDFs */
  pageNumber: number | null;
  /** text the PDF page already contains, if any */
  pdfText: string;
  /** canvas for images, kept so they need not be decoded again */
  image: HTMLCanvasElement | null;
  preview: HTMLCanvasElement;
  rotation: 0 | 90 | 180 | 270;
  result: PageResult | null;
  card: HTMLLIElement;
  state: HTMLElement;
  bar: HTMLProgressElement;
}

const storageKey = "image-to-text:languages";
const savedLanguages = () => {
  try {
    const saved = pickLanguages(JSON.parse(localStorage.getItem(storageKey) ?? "[]"));
    return saved.length ? saved : DEFAULT_LANGUAGES;
  } catch {
    return DEFAULT_LANGUAGES;
  }
};

const main = document.querySelector<HTMLElement>("#main")!;
let pages: PageItem[] = [];
let nextId = 1;
let stopRequested = false;

// Languages
const languageBoxes = LANGUAGES.map((language) => {
  const input = h("input", {
    type: "checkbox",
    value: language.code,
    checked: savedLanguages().includes(language.code),
    on: {
      change: () => {
        try {
          localStorage.setItem(storageKey, JSON.stringify(chosenLanguages()));
        } catch {
          // not saved, which only matters for the next visit
        }
      },
    },
  });
  return {
    input,
    element: h(
      "label",
      { class: "check" },
      input,
      h("span", {}, language.name, h("small", {}, `${language.size} MB`)),
    ),
  };
});
const chosenLanguages = () =>
  pickLanguages(
    languageBoxes.filter((box) => box.input.checked).map((box) => box.input.value),
  );
const languages = h(
  "fieldset",
  { class: "languages" },
  h("legend", {}, "Languages in your files"),
  h("div", { class: "languages__list" }, ...languageBoxes.map((box) => box.element)),
  h(
    "p",
    { class: "note" },
    "Pick only the languages you need: each extra one makes recognition slower.",
  ),
);

// Pages
const status = statusArea();
const pageList = h("ol", { class: "page-grid", "aria-label": "Pages" });
const summary = h("p", { class: "file-info" });
const cleanup = select<Cleanup>(
  "Clean up the images",
  [
    { value: "none", label: "No changes" },
    { value: "grey", label: "Greyscale" },
    { value: "contrast", label: "Greyscale and more contrast" },
  ],
  "none",
);
const pdfTextChoice = choice<"pdf" | "ocr">(
  "pdf-text",
  "Some PDF pages already contain text",
  [
    { value: "pdf", label: "Use the text in the PDF", hint: "Fast and exact" },
    {
      value: "ocr",
      label: "Recognise the page images",
      hint: "For PDFs whose text is wrong or garbled",
    },
  ],
  "pdf",
);
const runButton = h(
  "button",
  { type: "button", class: "primary", on: { click: () => void run() } },
  "Recognise text",
);
const stopButton = h(
  "button",
  {
    type: "button",
    hidden: true,
    on: {
      click: () => {
        stopRequested = true;
        stopButton.disabled = true;
      },
    },
  },
  "Stop",
);
const clearButton = h(
  "button",
  { type: "button", on: { click: () => clearAll() } },
  "Remove all",
);
const options = h(
  "div",
  { class: "options" },
  h("div", { class: "options__head" }, summary, clearButton),
  pageList,
  h("div", { class: "options--inline" }, cleanup.element),
  pdfTextChoice.element,
  h("div", { class: "actions" }, runButton, stopButton),
);
options.hidden = true;

// Results
const textBox = h("textarea", {
  id: "result-text",
  rows: 14,
  dir: "auto",
  spellcheck: false,
});
const confidence = h("p", { class: "confidence" });
const copyButton = h(
  "button",
  { type: "button", class: "primary", on: { click: () => void copyText() } },
  "Copy text",
);
const textButton = h(
  "button",
  { type: "button", on: { click: () => saveText() } },
  "Download .txt",
);
const pdfButton = h(
  "button",
  { type: "button", on: { click: () => void savePdf() } },
  "Download searchable PDF",
);
const results = h(
  "section",
  { class: "results", "aria-labelledby": "results-heading" },
  h("h3", { id: "results-heading" }, "Recognised text"),
  confidence,
  h("label", { class: "visually-hidden", for: "result-text" }, "Recognised text"),
  textBox,
  h("div", { class: "actions" }, copyButton, textButton, pdfButton),
  h(
    "p",
    { class: "note" },
    "You can correct the text above before copying it or saving it as a .txt file. The searchable PDF keeps the text as it was recognised.",
  ),
);
results.hidden = true;

const zone = dropZone({
  accept: "image/*,application/pdf,.pdf",
  multiple: true,
  label: "Choose images or PDFs",
  hint: "Photos, screenshots or scans (JPG, PNG, WebP, PDF), or drop them here",
  onFiles: (files) => addFiles(files),
});

main.append(
  h(
    "section",
    { class: "panel", "aria-labelledby": "tool-heading" },
    h("h2", { id: "tool-heading" }, "Turn images and scans into text"),
    h(
      "p",
      { class: "panel__description" },
      "Recognise the text in photos, screenshots and scanned PDFs, in English and ten Indian languages. Copy it, or save it as a text file or a searchable PDF.",
    ),
    h(
      "div",
      { class: "panel__body" },
      h(
        "div",
        { class: "privacy" },
        h("strong", {}, "Everything runs on your device."),
        " Your files are never uploaded. The first time, the text engine (about 4 MB) and the data for each language you pick (up to 2 MB each) are downloaded from this site; your browser keeps them for next time.",
      ),
      languages,
      zone.element,
      options,
      status.element,
      results,
    ),
  ),
);

// Pages dropped outside the drop area would otherwise be opened by the browser
for (const type of ["dragover", "drop"]) {
  addEventListener(type, (event) => event.preventDefault());
}

const showPreview = (page: PageItem) => {
  const preview = page.card.querySelector(".page-card__preview")!;
  const canvas = transformCanvas(page.preview, page.rotation);
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", `Preview of ${page.label}`);
  preview.replaceChildren(canvas);
};

const setState = (page: PageItem, text: string, progress?: number) => {
  page.state.textContent = text;
  page.bar.hidden = progress === undefined;
  if (progress !== undefined) {
    page.bar.value = progress;
  }
};

const resultState = (result: PageResult) =>
  result.confidence === null
    ? "Done · text from the PDF"
    : `Done · ${Math.round(result.confidence)}% confidence (${confidenceLabel(result.confidence)})`;

const updateSummary = () => {
  const files = new Set(pages.map((page) => page.file)).size;
  summary.replaceChildren(
    h("strong", {}, `${pages.length} page${pages.length === 1 ? "" : "s"}`),
    ` from ${files} file${files === 1 ? "" : "s"}`,
  );
  options.hidden = pages.length === 0;
  pdfTextChoice.element.hidden = !pages.some((page) => page.pdfText);
};

const createCard = (page: Omit<PageItem, "card" | "state" | "bar">): PageItem => {
  const state = h("span", { class: "page-card__state" }, "Ready");
  const bar = h("progress", { max: 1, value: 0, hidden: true, "aria-hidden": "true" });
  const card = h(
    "li",
    { class: "page-card" },
    h("div", { class: "page-card__preview" }),
    h(
      "div",
      { class: "page-card__label" },
      h("span", { title: page.label }, page.label),
      page.pdfText && h("small", {}, "Contains text"),
    ),
    bar,
    state,
  );
  const item: PageItem = { ...page, card, state, bar };
  const turn = (by: number) => {
    item.rotation = normaliseRotation(item.rotation + by);
    item.result = null;
    setState(item, "Ready");
    showPreview(item);
  };
  card.append(
    h(
      "div",
      { class: "page-card__actions" },
      iconButton(`Turn ${page.label} left`, "↺", () => turn(-90)),
      iconButton(`Turn ${page.label} right`, "↻", () => turn(90)),
      iconButton(
        `Remove ${page.label}`,
        "✕",
        () => {
          pages = pages.filter((candidate) => candidate !== item);
          card.remove();
          updateSummary();
          updateResults();
        },
        "danger",
      ),
    ),
  );
  return item;
};

const addFiles = (files: InputFile[]) =>
  runTask(status, [runButton], async () => {
    const added: PageItem[] = [];
    for (const file of files) {
      if (isPdf(file)) {
        status.progress(`Opening ${file.name}…`);
        const doc = await openPdf(file.bytes);
        try {
          for (let n = 1; n <= doc.numPages; n++) {
            const page = await doc.getPage(n);
            const { width, height } = pageSize(page);
            const scale = 240 / Math.max(width, height);
            const preview = await renderPage(page, scale);
            const text = textFromPieces((await page.getTextContent()).items);
            added.push(
              createCard({
                id: nextId++,
                file,
                label: doc.numPages === 1 ? file.name : `${file.name} · page ${n}`,
                pageNumber: n,
                pdfText: hasText(text) ? text : "",
                image: null,
                preview,
                rotation: 0,
                result: null,
              }),
            );
          }
        } finally {
          await closePdf(doc);
        }
      } else if (isImage(file)) {
        status.progress(`Opening ${file.name}…`);
        const image = await openImage(file);
        added.push(
          createCard({
            id: nextId++,
            file,
            label: file.name,
            pageNumber: null,
            pdfText: "",
            image,
            preview: thumbnail(image),
            rotation: 0,
            result: null,
          }),
        );
      } else {
        throw new UserError(`"${file.name}" is not an image or a PDF.`);
      }
    }
    for (const page of added) {
      pages.push(page);
      pageList.append(page.card);
      showPreview(page);
    }
    updateSummary();
    status.clear();
  });

const clearAll = () => {
  pages = [];
  pageList.replaceChildren();
  updateSummary();
  updateResults();
  status.clear();
};

const languageNames = (codes: string[]) =>
  codes.map((code) => LANGUAGES.find((language) => language.code === code)!.name);

const engineMessage = (progress: OcrProgress, languageList: string) => {
  if (progress.status.includes("core")) {
    return "Loading the text engine…";
  }
  if (progress.status.includes("traineddata")) {
    return `Loading the language data (${languageList})…`;
  }
  return "Starting the text engine…";
};

const updateResults = () => {
  const done = pages.filter((page) => page.result);
  results.hidden = done.length === 0;
  if (!done.length) {
    textBox.value = "";
    return;
  }
  textBox.value = joinPages(
    done.map((page) => ({ label: page.label, text: page.result!.text })),
  );
  const values = done
    .map((page) => page.result!.confidence)
    .filter((value): value is number => value !== null);
  const average = averageConfidence(values);
  confidence.replaceChildren(
    average === null
      ? "The text was taken from the PDF, so it is exact."
      : h(
          "span",
          {},
          `Average confidence: `,
          h("strong", {}, `${average}%`),
          ` (${confidenceLabel(average)}).`,
          average < 60
            ? " Try a sharper or straighter photo, turn the page upright, or clean up the images with more contrast."
            : "",
        ),
  );
  pdfButton.disabled = !done.some((page) => page.result!.pdf);
};

const pageJpeg = async (canvas: HTMLCanvasElement) =>
  blobBytes(await canvasToBlob(canvas, "image/jpeg", 0.85));

const run = () =>
  runTask(
    status,
    [runButton, clearButton, copyButton, textButton, pdfButton],
    async () => {
      const codes = chosenLanguages();
      if (!codes.length) {
        throw new UserError("Choose at least one language.");
      }
      if (!pages.length) {
        return;
      }
      const languageString = codes.join("+");
      const languageList = languageNames(codes).join(", ");
      const usePdfText = pdfTextChoice.value === "pdf";
      const mode = cleanup.value;
      const docs = new Map<InputFile, PDFDocumentProxy>();
      stopRequested = false;
      stopButton.hidden = false;
      stopButton.disabled = false;
      for (const page of pages) {
        page.result = null;
        setState(page, "Waiting");
      }
      updateResults();
      try {
        const needsEngine = pages.some((page) => !(usePdfText && page.pdfText));
        if (needsEngine) {
          status.progress("Starting the text engine…");
          await prepare(languageString, (progress) =>
            status.progress(engineMessage(progress, languageList)),
          );
        }
        for (const [index, page] of pages.entries()) {
          if (stopRequested) {
            break;
          }
          const position = `Page ${index + 1} of ${pages.length}`;
          status.progress(`${position}: ${page.label}…`);
          if (usePdfText && page.pdfText) {
            page.result = {
              text: page.pdfText,
              confidence: null,
              pdf: { kind: "copy", pdf: page.file.bytes, index: page.pageNumber! - 1 },
            };
            setState(page, resultState(page.result));
            updateResults();
            continue;
          }
          setState(page, "Preparing…", 0);
          let source: HTMLCanvasElement;
          let size: { width: number; height: number } | undefined;
          let dpi: number | undefined;
          if (page.pageNumber) {
            let doc = docs.get(page.file);
            if (!doc) {
              doc = await openPdf(page.file.bytes);
              docs.set(page.file, doc);
            }
            const pdfPage = await doc.getPage(page.pageNumber);
            const points = pageSize(pdfPage);
            size = rotatedSize(points.width, points.height, page.rotation);
            const rendered = await renderForOcr(pdfPage);
            dpi = Math.round((rendered.width / points.width) * 72);
            source = transformCanvas(rendered, page.rotation);
            rendered.width = rendered.height = 0;
          } else {
            source = transformCanvas(page.image!, page.rotation);
          }
          const input = cleanUp(source, mode);
          const result = await recognise(
            input,
            languageString,
            { dpi, pdf: true },
            (progress) => {
              if (progress.status.startsWith("recogniz")) {
                setState(
                  page,
                  `Recognising… ${Math.round(progress.progress * 100)}%`,
                  progress.progress,
                );
                status.progress(
                  `${position}: recognising ${page.label}… ${Math.round(progress.progress * 100)}%`,
                );
              }
            },
          );
          page.result = {
            text: tidyText(result.text),
            confidence: result.confidence,
            pdf: result.pdf
              ? {
                  kind: "ocr",
                  textPdf: result.pdf,
                  jpeg: await pageJpeg(source),
                  pixels: { width: source.width, height: source.height },
                  size,
                }
              : null,
          };
          source.width = source.height = input.width = input.height = 0;
          setState(page, resultState(page.result));
          updateResults();
        }
        const done = pages.filter((page) => page.result).length;
        if (stopRequested) {
          for (const page of pages) {
            if (!page.result) {
              setState(page, "Stopped");
            }
          }
          status.element.replaceChildren(
            h(
              "p",
              { class: "status__progress" },
              `Stopped after ${done} of ${pages.length} pages.`,
            ),
          );
        } else {
          status.clear();
        }
        if (done) {
          results.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }
      } catch (error) {
        for (const page of pages) {
          if (!page.result) {
            setState(page, "Not done");
          }
        }
        throw error;
      } finally {
        stopButton.hidden = true;
        for (const doc of docs.values()) {
          await closePdf(doc);
        }
      }
    },
  );

const names = () => pages.filter((page) => page.result).map((page) => page.file.name);

const flash = (button: HTMLButtonElement, text: string) => {
  const original = button.textContent;
  button.textContent = text;
  setTimeout(() => (button.textContent = original), 2000);
};

const copyText = async () => {
  try {
    await navigator.clipboard.writeText(textBox.value);
  } catch {
    textBox.select();
    document.execCommand("copy");
  }
  flash(copyButton, "Copied");
};

const saveText = () => {
  const text = textBox.value.replace(/\n*$/, "\n");
  download(
    new Blob([text], { type: "text/plain;charset=utf-8" }),
    `${downloadBase(names())}.txt`,
    "text/plain",
  );
};

const savePdf = () =>
  runTask(status, [pdfButton], async () => {
    const parts = pages
      .map((page) => page.result?.pdf)
      .filter((part): part is SearchablePage => !!part);
    if (!parts.length) {
      return;
    }
    status.progress("Making the searchable PDF…");
    const bytes = await buildSearchablePdf(parts);
    const name = `${downloadBase(names())}-searchable.pdf`;
    download(bytes, name, "application/pdf");
    status.element.replaceChildren(
      h(
        "p",
        { class: "status__progress" },
        `Saved ${name} (${formatBytes(bytes.length)}).`,
      ),
    );
  });
