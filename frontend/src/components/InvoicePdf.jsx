import { useEffect, useRef, useState } from "react";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";

GlobalWorkerOptions.workerSrc = pdfWorker;

/**
 * Renders invoice PDFs to canvas so Review never depends on brittle
 * browser iframe/blob PDF chrome (often blank/dark in Chromium).
 */
export default function InvoicePdf({ blobUrl, fileName }) {
  const hostRef = useRef(null);
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");
  const [pageCount, setPageCount] = useState(0);

  useEffect(() => {
    if (!blobUrl) {
      setStatus("empty");
      return undefined;
    }

    let cancelled = false;
    const host = hostRef.current;
    if (host) host.innerHTML = "";

    setStatus("loading");
    setError("");
    setPageCount(0);

    (async () => {
      try {
        const loadingTask = getDocument({ url: blobUrl, withCredentials: false });
        const pdf = await loadingTask.promise;
        if (cancelled) {
          pdf.destroy();
          return;
        }

        setPageCount(pdf.numPages);
        const target = hostRef.current;
        if (!target) return;

        const width = Math.max(target.clientWidth || 640, 320);

        for (let pageNum = 1; pageNum <= pdf.numPages; pageNum += 1) {
          const page = await pdf.getPage(pageNum);
          if (cancelled) return;

          const unscaled = page.getViewport({ scale: 1 });
          const scale = Math.min(2.2, (width - 8) / unscaled.width);
          const viewport = page.getViewport({ scale });

          const canvas = document.createElement("canvas");
          canvas.className = "pdf-page";
          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          canvas.setAttribute("role", "img");
          canvas.setAttribute(
            "aria-label",
            `${fileName || "Invoice"} — page ${pageNum} of ${pdf.numPages}`,
          );

          const ctx = canvas.getContext("2d", { alpha: false });
          await page.render({ canvasContext: ctx, viewport }).promise;
          if (cancelled) return;
          target.appendChild(canvas);
        }

        setStatus("ready");
        pdf.destroy();
      } catch (err) {
        if (cancelled) return;
        setStatus("error");
        setError(err?.message || "Could not open this PDF");
      }
    })();

    return () => {
      cancelled = true;
      if (hostRef.current) hostRef.current.innerHTML = "";
    };
  }, [blobUrl, fileName]);

  if (!blobUrl) {
    return (
      <div className="pdf-state">
        <p>Document unavailable</p>
        <span>Re-upload the invoice or open it from your records.</span>
      </div>
    );
  }

  return (
    <div className="pdf-stage">
      {status === "loading" ? (
        <div className="pdf-state pdf-state--loading" aria-live="polite">
          <div className="pdf-skeleton" />
          <p>Opening invoice…</p>
        </div>
      ) : null}
      {status === "error" ? (
        <div className="pdf-state">
          <p>Couldn’t display this PDF here</p>
          <span>{error}</span>
          <a className="btn btn-ghost" href={blobUrl} target="_blank" rel="noreferrer">
            Open in new tab
          </a>
        </div>
      ) : null}
      <div
        ref={hostRef}
        className={`pdf-pages${status === "ready" ? " is-ready" : ""}`}
        data-pages={pageCount || undefined}
      />
    </div>
  );
}
