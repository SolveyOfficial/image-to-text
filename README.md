# Solvey Image to Text

Free text recognition (OCR) that runs entirely in your browser.

Live: https://solveyofficial.github.io/image-to-text/

- **Images and PDFs**: photos, screenshots and scans (JPG, PNG, WebP and other
  formats the browser opens) and PDFs, several files at once; phone photos are
  turned upright
- **PDFs**: pages are rendered at about 300 DPI and recognised, or, when a PDF
  already contains text, that text is used directly (you choose)
- **Languages**: English, Hindi, Marathi, Bengali, Tamil, Telugu, Gujarati,
  Kannada, Malayalam, Punjabi and Urdu; only the languages you pick are loaded
- **Results**: editable text with a copy button, download as .txt or as a
  searchable PDF (the page images with invisible, selectable text), and the
  recognition confidence for each page
- **Clean-up**: greyscale or stronger contrast, and turning pages, for better
  results

## Private by design

Your files are never uploaded. The app has no analytics or tracking, and it
serves everything itself: fonts, the PDF renderer, the text engine and the
language data. The first time, the text engine and the data for the chosen
languages are downloaded from the site; the browser keeps them for next time.

Built with [tesseract.js](https://github.com/naptha/tesseract.js) (the
Tesseract OCR engine compiled to WebAssembly), Mozilla's
[pdf.js](https://mozilla.github.io/pdf.js/) and
[pdf-lib](https://pdf-lib.js.org). The language data in `tessdata/` is the
"fast" data from [tessdata_fast](https://github.com/tesseract-ocr/tessdata_fast)
release 4.1.0 (Apache-2.0), compressed with gzip. This software is based in part
on the work of the Independent JPEG Group.

## Development

You need Node.js 22.13 or later.

```sh
npm install
npm run dev        # development server
npm run lint       # Prettier and ESLint
npm run typecheck  # TypeScript
npm test           # unit tests
npm run build      # production build in dist/
```

Set `BASE_PATH` (for example `BASE_PATH=/image-to-text/`) when the app is served
from a sub-path. `npm run assets` (run by `dev` and `build`) copies the files
loaded at run time into `public/`. The build also writes
`THIRD_PARTY_NOTICES.md`, listing every bundled package, font, WebAssembly
build and data file with its licence; the app links to it as "Licences". The
licences of the libraries inside the tesseract.js WebAssembly builds are kept
in `licences/`.

When the repository is public, every push to `main` is published to GitHub
Pages.

## Licence

MIT, see LICENSE.
