jest.mock('jimp', () => ({ read: jest.fn() }));
jest.mock('jsqr', () => jest.fn());
jest.mock('tesseract.js', () => ({ createWorker: jest.fn() }));

const Jimp = require('jimp');
const jsQR = require('jsqr');
const { createWorker } = require('tesseract.js');
const { processImage } = require('../src/nfceKeyExtractor/imageProcessor');

const VALID_KEY = '17260106057223057440650260000009551260014360';

function createFakeImage() {
  const image = {
    bitmap: {
      width: 120,
      height: 240,
      data: Buffer.alloc(120 * 240 * 4),
    },
    clone: jest.fn(() => image),
    greyscale: jest.fn(() => image),
    contrast: jest.fn(() => image),
    normalize: jest.fn(() => image),
    threshold: jest.fn(() => image),
    crop: jest.fn(() => image),
  };
  return image;
}

describe('processImage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Jimp.read.mockResolvedValue(createFakeImage());
  });

  test('retorna chave via qrcode quando o QR contem chNFe valida', async () => {
    jsQR.mockReturnValue({ data: `https://www.sefaz.to.gov.br/nfce/qrcode?chNFe=${VALID_KEY}` });

    const result = await processImage('/tmp/cupom.png');

    expect(result).toEqual({
      chave: VALID_KEY,
      fonte: 'qrcode',
      raw: `https://www.sefaz.to.gov.br/nfce/qrcode?chNFe=${VALID_KEY}`,
    });
    expect(createWorker).not.toHaveBeenCalled();
  });

  test('faz fallback para OCR quando o QR nao e encontrado', async () => {
    jsQR.mockReturnValue(null);
    const worker = {
      recognize: jest.fn().mockResolvedValue({ data: { text: `Consulte pela Chave de Acesso ${VALID_KEY}` } }),
      terminate: jest.fn().mockResolvedValue(undefined),
    };
    createWorker.mockResolvedValue(worker);

    const result = await processImage('/tmp/cupom.png');

    expect(result.chave).toBe(VALID_KEY);
    expect(result.fonte).toBe('ocr');
    expect(worker.recognize).toHaveBeenCalled();
    expect(worker.terminate).toHaveBeenCalled();
  });
});
