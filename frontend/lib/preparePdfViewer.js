// Package the PDF renderer locally; documents never leave the AP Console origin.
const fs = require("fs");
const path = require("path");
const source = path.dirname(require.resolve("pdfjs-dist/package.json"));
const target = path.resolve(__dirname, "../webapp/vendor/pdfjs");
fs.mkdirSync(target, {recursive: true});
for (const name of ["pdf.mjs", "pdf.worker.mjs"]) {
    fs.copyFileSync(path.join(source, "build", name), path.join(target, name));
}
for (const name of ["cmaps", "standard_fonts", "wasm"]) {
    fs.cpSync(path.join(source, name), path.join(target, name), {recursive: true});
}
fs.copyFileSync(path.join(source, "LICENSE"), path.join(target, "LICENSE"));
