import * as pdfjs from "../vendor/pdfjs/pdf.mjs";
pdfjs.GlobalWorkerOptions.workerSrc = new URL("../vendor/pdfjs/pdf.worker.mjs", import.meta.url).href;
const pages = document.getElementById("pages");
const status = document.getElementById("status");
const input = document.getElementById("pageNumber");
let pdf, scale = 1, rotation = 0, selected = null, generation = 0;
const rendered = new Map();

function highlight() {
    document.querySelectorAll(".focus").forEach(node => node.remove());
    if (!selected) return;
    const loc = selected.location;
    const entry = rendered.get(Number(loc.page));
    if (!entry) return;
    const {page, viewport, element} = entry;
    // Contract: normalized top-left coordinates, preserved from SAP Document AI.
    const {x, y, width, height} = loc;
    if (![x, y, width, height].every(Number.isFinite) || x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > 1.001 || y + height > 1.001) return;
    const [left, bottom, right, top] = page.view;
    const rect = viewport.convertToViewportRectangle([
        left + x * (right - left), top - (y + height) * (top - bottom),
        left + (x + width) * (right - left), top - y * (top - bottom)
    ]);
    const box = document.createElement("div");
    box.className = "focus";
    Object.assign(box.style, {left: Math.min(rect[0], rect[2]) + "px", top: Math.min(rect[1], rect[3]) + "px", width: Math.abs(rect[2] - rect[0]) + "px", height: Math.abs(rect[3] - rect[1]) + "px"});
    element.append(box);
    box.scrollIntoView({block: "center", behavior: "smooth"});
    input.value = loc.page;
    status.textContent = "Source: " + selected.label + " · page " + loc.page;
}

async function render() {
    if (!pdf) return;
    const current = ++generation;
    pages.replaceChildren(); rendered.clear();
    status.textContent = "Rendering invoice…";
    for (let n = 1; n <= pdf.numPages; n++) {
        const page = await pdf.getPage(n);
        if (current !== generation) return;
        const base = page.getViewport({scale: 1, rotation: (page.rotate + rotation) % 360});
        const fit = Math.max(0.2, (document.documentElement.clientWidth - 32) / base.width);
        const viewport = page.getViewport({scale: fit * scale, rotation: (page.rotate + rotation) % 360});
        const element = document.createElement("div"); element.className = "page"; element.id = "page-" + n;
        const canvas = document.createElement("canvas"); canvas.setAttribute("aria-label", "Invoice page " + n);
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.floor(viewport.width * ratio); canvas.height = Math.floor(viewport.height * ratio);
        canvas.style.width = viewport.width + "px"; canvas.style.height = viewport.height + "px";
        element.append(canvas); pages.append(element);
        rendered.set(n, {page, viewport, element});
        await page.render({canvasContext: canvas.getContext("2d"), viewport, transform: [ratio, 0, 0, ratio, 0, 0]}).promise;
        if (current !== generation) return;
    }
    status.textContent = "Select an extracted field to focus its source.";
    document.getElementById("zoom").textContent = Math.round(scale * 100) + "%";
    highlight();
}
function redraw() { render().catch(error => { status.textContent = "Preview unavailable: " + error.message; }); }
document.getElementById("zoomIn").onclick = () => { scale = Math.min(3, scale + .25); redraw(); };
document.getElementById("zoomOut").onclick = () => { scale = Math.max(.5, scale - .25); redraw(); };
document.getElementById("rotate").onclick = () => { rotation = (rotation + 90) % 360; redraw(); };
document.getElementById("full").onclick = async () => {
    try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); }
    catch { status.textContent = "Full screen is unavailable in this browser. Use View PDF to open a larger preview."; }
};
input.onchange = () => { const n = Math.min(pdf?.numPages || 1, Math.max(1, Number(input.value) || 1)); input.value = n; document.getElementById("page-" + n)?.scrollIntoView({block: "start"}); };
window.addEventListener("message", event => {
    if (event.origin !== location.origin || event.source !== parent || event.data?.type !== "ap-field-focus") return;
    selected = event.data; highlight();
});
let resizeTimer;
window.addEventListener("resize", () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(redraw, 150); });
try {
    const url = decodeURIComponent(location.hash.slice(1));
    if (!url.startsWith("blob:" + location.origin + "/")) throw new Error("Invalid document source");
    pdf = await pdfjs.getDocument({url, cMapUrl: "../vendor/pdfjs/cmaps/", cMapPacked: true, standardFontDataUrl: "../vendor/pdfjs/standard_fonts/", wasmUrl: "../vendor/pdfjs/wasm/", isEvalSupported: false}).promise;
    input.max = pdf.numPages; document.getElementById("pageCount").textContent = "/ " + pdf.numPages;
    await render();
    parent.postMessage({type: "ap-pdf-ready"}, location.origin);
} catch (error) { status.textContent = "Preview unavailable: " + error.message; }
window.addEventListener("pagehide", () => { generation++; pdf?.destroy(); });
