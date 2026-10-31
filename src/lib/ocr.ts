// Text recognition with tesseract.js. The worker script (started through
// public/ocr-worker.js), its WebAssembly builds and the language data are
// all served by the app itself (see scripts/copy-assets.js), so nothing is
// fetched from another site. The browser keeps downloaded language data in
// IndexedDB for next time.
import { createWorker, OEM, type Worker } from "tesseract.js";

const root = new URL(import.meta.env.BASE_URL, location.href).href;
const base = `${root}tesseract/`;

export interface OcrProgress {
  status: string;
  progress: number;
}

export interface OcrResult {
  text: string;
  /** Mean word confidence, 0 to 100. */
  confidence: number;
  /** A one-page PDF with the recognised text as an invisible layer. */
  pdf: Uint8Array | null;
}

let listener: ((progress: OcrProgress) => void) | null = null;
let current: { languages: string; worker: Promise<Worker> } | null = null;

const startWorker = (languages: string) =>
  createWorker(languages.split("+"), OEM.LSTM_ONLY, {
    workerPath: `${root}ocr-worker.js`,
    corePath: `${base}core/`,
    langPath: `${base}lang`,
    workerBlobURL: false,
    gzip: true,
    logger: (message) =>
      listener?.({ status: message.status, progress: message.progress }),
  });

/** Starts the engine with the given languages (e.g. "eng+hin"), if needed. */
const workerFor = async (languages: string) => {
  if (current?.languages !== languages) {
    const previous = current;
    current = { languages, worker: startWorker(languages) };
    current.worker.catch(() => (current = null));
    void previous?.worker.then((worker) => worker.terminate()).catch(() => {});
  }
  return current.worker;
};

/** Prepares the engine before recognition, reporting download progress. */
export const prepare = async (
  languages: string,
  onProgress: (progress: OcrProgress) => void,
) => {
  listener = onProgress;
  try {
    await workerFor(languages);
  } finally {
    listener = null;
  }
};

export const recognise = async (
  image: HTMLCanvasElement,
  languages: string,
  options: { dpi?: number; pdf: boolean },
  onProgress: (progress: OcrProgress) => void,
): Promise<OcrResult> => {
  const worker = await workerFor(languages);
  listener = onProgress;
  try {
    await worker.setParameters({
      user_defined_dpi: options.dpi ? String(options.dpi) : "0",
    });
    const { data } = await worker.recognize(
      image,
      { pdfTextOnly: true, pdfTitle: "Recognised text" },
      { text: true, pdf: options.pdf },
    );
    return {
      text: data.text,
      confidence: data.confidence,
      pdf: data.pdf ? new Uint8Array(data.pdf) : null,
    };
  } finally {
    listener = null;
  }
};
