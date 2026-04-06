const fs = require('fs');
const {
  requireDependency,
  extractKeyFromQrRaw,
  getReadableSnippet,
} = require('./utils');
const {
  cleanKey,
  findFirstValidKey,
  isValidKey,
} = require('./keyValidator');

const deps = {
  fs,
  getJimp: () => requireDependency('jimp'),
  getJsQR: () => requireDependency('jsqr'),
  getCreateWorker: () => requireDependency('tesseract.js').createWorker,
};

function preprocessImage(image) {
  return image
    .clone()
    .greyscale()
    .contrast(0.55)
    .normalize()
    .threshold({ max: 128 });
}

function buildQrVariants(image) {
  const { width, height } = image.bitmap;
  const lowerHalfY = Math.max(0, Math.floor(height * 0.5));
  const lowerThirdY = Math.max(0, Math.floor(height * 0.62));

  return [
    image,
    preprocessImage(image),
    image.clone().crop(0, lowerHalfY, width, height - lowerHalfY),
    preprocessImage(image).crop(0, lowerHalfY, width, height - lowerHalfY),
    image.clone().crop(0, lowerThirdY, width, height - lowerThirdY),
    preprocessImage(image).crop(0, lowerThirdY, width, height - lowerThirdY),
  ];
}

function decodeQrFromImage(image) {
  const jsQR = deps.getJsQR();
  const rgba = new Uint8ClampedArray(image.bitmap.data);
  return jsQR(rgba, image.bitmap.width, image.bitmap.height);
}

async function readQrCode(filePath) {
  const Jimp = deps.getJimp();
  const image = await Jimp.read(filePath);
  const variants = buildQrVariants(image);

  for (const variant of variants) {
    const code = decodeQrFromImage(variant);
    if (!code || !code.data) continue;

    const extracted = cleanKey(extractKeyFromQrRaw(code.data));
    if (isValidKey(extracted)) {
      return { chave: extracted, raw: code.data };
    }
  }

  return { chave: null, raw: '' };
}

async function runOcr(filePath) {
  const createWorker = deps.getCreateWorker();
  const worker = await createWorker('por');
  try {
    const { data } = await worker.recognize(filePath);
    return String(data && data.text ? data.text : '');
  } finally {
    await worker.terminate();
  }
}

async function processImage(filePath) {
  console.info('[nfce] processando imagem para extracao de chave');

  const qrResult = await readQrCode(filePath);
  if (qrResult.chave) {
    console.info('[nfce] chave encontrada via QR Code');
    return { chave: qrResult.chave, fonte: 'qrcode', raw: qrResult.raw };
  }

  console.info('[nfce] QR falhou, iniciando OCR');
  const text = await runOcr(filePath);
  const key = findFirstValidKey(text);

  if (key) {
    console.info('[nfce] chave encontrada via OCR');
    return { chave: key, fonte: 'ocr', raw: getReadableSnippet(text, key) || text };
  }

  console.info('[nfce] nenhuma chave valida encontrada na imagem');
  return { chave: null, fonte: null, raw: '' };
}

module.exports = {
  processImage,
  __private: {
    deps,
    preprocessImage,
    buildQrVariants,
    decodeQrFromImage,
    readQrCode,
    runOcr,
  },
};
