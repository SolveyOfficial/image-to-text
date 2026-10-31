/* global importScripts */
// Starts the tesseract.js worker. The fast language data contains settings
// for the older engine, which the LSTM-only engine reports as missing on
// every start; those harmless notices are left out of the console.
const consoleError = console.error.bind(console);
console.error = (...args) => {
  if (!/^Warning: Parameter not found: /.test(String(args[0]))) {
    consoleError(...args);
  }
};
importScripts("tesseract/worker.min.js");
