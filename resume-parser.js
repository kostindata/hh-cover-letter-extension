(() => {
  "use strict";

  const SUPPORTED_EXTENSIONS = ["txt", "pdf", "doc", "docx"];
  const FORMAT_LABELS = { txt: "TXT", pdf: "PDF", doc: "DOC", docx: "DOCX" };

  function getExtension(filename) {
    return filename.toLowerCase().split(".").pop();
  }

  function normalizeText(text) {
    return String(text || "")
      .replace(/\r\n?/g, "\n")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{4,}/g, "\n\n\n")
      .trim();
  }

  function ensureUsefulText(text, format) {
    const normalized = normalizeText(text);
    if (!normalized) {
      const suffix = format === "pdf" ? " Возможно, это скан без текстового слоя." : "";
      throw new Error(`Не удалось извлечь текст из файла.${suffix}`);
    }
    if (new Blob([normalized]).size > 1024 * 1024) {
      throw new Error("Извлечённый текст больше 1 МБ. Сократите документ.");
    }
    return normalized;
  }

  async function extractPdf(arrayBuffer) {
    const pdfjs = await import(chrome.runtime.getURL("vendor/pdf.min.mjs"));
    pdfjs.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL("vendor/pdf.worker.min.mjs");
    const loadingTask = pdfjs.getDocument({
      data: new Uint8Array(arrayBuffer),
      isEvalSupported: false,
      useWorkerFetch: false
    });
    let pdf;
    try {
      pdf = await loadingTask.promise;
      const pages = [];
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
        const page = await pdf.getPage(pageNumber);
        const content = await page.getTextContent();
        const text = content.items.map((item) => `${item.str || ""}${item.hasEOL ? "\n" : " "}`).join("");
        pages.push(text.trim());
        page.cleanup();
      }
      return pages.filter(Boolean).join("\n\n");
    } finally {
      if (pdf) await pdf.destroy();
      else await loadingTask.destroy();
    }
  }

  async function extractDocx(arrayBuffer) {
    if (!globalThis.mammoth?.extractRawText) throw new Error("Модуль DOCX не загрузился.");
    const result = await globalThis.mammoth.extractRawText({ arrayBuffer });
    return result.value;
  }

  function extractLegacyDoc(arrayBuffer) {
    if (typeof globalThis.docToText !== "function") throw new Error("Модуль DOC не загрузился.");
    const text = globalThis.docToText(arrayBuffer);
    if (text === null) throw new Error("Этот DOC-файл зашифрован, повреждён или создан в неподдерживаемой старой версии Word.");
    return text;
  }

  async function parse(file) {
    const format = getExtension(file.name);
    if (!SUPPORTED_EXTENSIONS.includes(format)) {
      throw new Error(`«${file.name}»: поддерживаются TXT, PDF, DOC и DOCX.`);
    }
    if (file.size > 10 * 1024 * 1024) throw new Error(`«${file.name}» больше 10 МБ.`);

    try {
      let text;
      if (format === "txt") text = await file.text();
      else {
        const arrayBuffer = await file.arrayBuffer();
        if (format === "pdf") text = await extractPdf(arrayBuffer);
        if (format === "docx") text = await extractDocx(arrayBuffer);
        if (format === "doc") text = extractLegacyDoc(arrayBuffer);
      }
      return { text: ensureUsefulText(text, format), format, formatLabel: FORMAT_LABELS[format] };
    } catch (error) {
      if (error.message?.startsWith("«") || error.message?.includes("DOC-файл")) throw error;
      if (/password/i.test(error.name || "") || /password/i.test(error.message || "")) {
        throw new Error(`«${file.name}» защищён паролем.`);
      }
      throw new Error(`Не удалось прочитать «${file.name}»: ${error.message}`);
    }
  }

  globalThis.ResumeParser = { parse, supportedExtensions: SUPPORTED_EXTENSIONS, formatLabels: FORMAT_LABELS };
})();
