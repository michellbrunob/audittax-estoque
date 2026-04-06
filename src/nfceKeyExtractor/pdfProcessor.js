const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { requireDependency, getReadableSnippet } = require('./utils');
const { processImage } = require('./imageProcessor');
const { findFirstValidKey } = require('./keyValidator');

const deps = {
  fs,
  os,
  path,
  processImage,
  getFromPath: () => requireDependency('pdf2pic').fromPath,
  loadPdfjs: async () => {
    try {
      return await import('pdfjs-dist/legacy/build/pdf.mjs');
    } catch {
      const fallback = pathToFileURL(path.resolve(__dirname, '../../node_modules/pdfjs-dist/legacy/build/pdf.mjs')).href;
      return import(fallback);
    }
  },
};

async function extractNativePdfText(filePath) {
  const pdfjs = await deps.loadPdfjs();
  const loadingTask = pdfjs.getDocument(filePath);
  const document = await loadingTask.promise;
  const chunks = [];

  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    const text = content.items.map((item) => item.str).join(' ');
    chunks.push(text);
  }

  return chunks.join('\n');
}

async function convertPdfFirstPageToImage(filePath) {
  const tempDir = await deps.fs.mkdtemp(path.join(deps.os.tmpdir(), 'nfce-key-'));
  const fromPath = deps.getFromPath();
  const converter = fromPath(filePath, {
    density: 220,
    savePath: tempDir,
    format: 'png',
    quality: 100,
    width: 1800,
    height: 2600,
  });

  const result = await converter(1, { responseType: 'image' });
  const imagePath = result.path || path.join(tempDir, result.name);
  return { imagePath, tempDir };
}

async function processPdf(filePath) {
  console.info('[nfce] processando PDF para extracao de chave');

  const nativeText = await extractNativePdfText(filePath);
  const nativeKey = findFirstValidKey(nativeText);
  if (nativeKey) {
    console.info('[nfce] chave encontrada em texto nativo do PDF');
    return { chave: nativeKey, fonte: 'ocr', raw: getReadableSnippet(nativeText, nativeKey) || nativeText };
  }

  console.info('[nfce] texto nativo nao trouxe chave, convertendo primeira pagina em imagem');
  let converted;
  try {
    converted = await convertPdfFirstPageToImage(filePath);
    return await deps.processImage(converted.imagePath);
  } finally {
    if (converted && converted.tempDir) {
      await deps.fs.rm(converted.tempDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

module.exports = {
  processPdf,
  __private: {
    deps,
    extractNativePdfText,
    convertPdfFirstPageToImage,
  },
};
