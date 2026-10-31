// Copies the files loaded at run time into public/, so the app serves them
// itself and never fetches anything from another site:
// - pdf.js character maps, standard fonts, colour profiles and decoders
// - the tesseract.js worker and its WebAssembly builds
// - the language data in tessdata/ (from tessdata_fast, gzip-compressed)
// Each folder keeps its licence files.
import fs from "node:fs";
import path from "node:path";

const copy = (from, to) => {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
};

// pdf.js
const pdfjs = path.join("node_modules", "pdfjs-dist");
const pdfjsTarget = path.join("public", "pdfjs");
// the JavaScript sandbox is only needed for PDF scripting, which is disabled
const skip = /^quickjs-eval\./;
fs.rmSync(pdfjsTarget, { recursive: true, force: true });
for (const folder of ["cmaps", "iccs", "standard_fonts", "wasm"]) {
  for (const name of fs.readdirSync(path.join(pdfjs, folder))) {
    if (!skip.test(name)) {
      copy(path.join(pdfjs, folder, name), path.join(pdfjsTarget, folder, name));
    }
  }
}

// tesseract.js
const target = path.join("public", "tesseract");
fs.rmSync(target, { recursive: true, force: true });
const dist = path.join("node_modules", "tesseract.js", "dist");
copy(path.join(dist, "worker.min.js"), path.join(target, "worker.min.js"));
copy(
  path.join("node_modules", "tesseract.js", "LICENSE.md"),
  path.join(target, "LICENSE"),
);

// The app only uses the LSTM engine (the fast language data has no data for
// the older engine), so tesseract.js picks one of these builds depending on
// what the browser supports. The .wasm.js files include the WebAssembly.
const core = path.join("node_modules", "tesseract.js-core");
for (const name of fs.readdirSync(core)) {
  if (/-lstm\.wasm\.js$/.test(name) || name === "LICENSE") {
    copy(path.join(core, name), path.join(target, "core", name));
  }
}
for (const name of fs.readdirSync("licences")) {
  copy(path.join("licences", name), path.join(target, "core", "licences", name));
}

for (const name of fs.readdirSync("tessdata")) {
  copy(path.join("tessdata", name), path.join(target, "lang", name));
}

console.log(`Copied run-time files to ${pdfjsTarget} and ${target}`);
