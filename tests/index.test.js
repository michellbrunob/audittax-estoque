const fs = require('fs');
const os = require('os');
const path = require('path');

jest.mock('../src/nfceKeyExtractor/imageProcessor', () => ({ processImage: jest.fn() }));
jest.mock('../src/nfceKeyExtractor/pdfProcessor', () => ({ processPdf: jest.fn() }));

const { processImage } = require('../src/nfceKeyExtractor/imageProcessor');
const { processPdf } = require('../src/nfceKeyExtractor/pdfProcessor');
const { extractNFCeKey } = require('../src/nfceKeyExtractor');

const VALID_KEY = '17260106057223057440650260000009551260014360';

describe('extractNFCeKey', () => {
  test('delegates image files to processImage', async () => {
    const filePath = path.join(os.tmpdir(), 'nfce-image-test.png');
    fs.writeFileSync(filePath, 'fake');
    processImage.mockResolvedValue({ chave: VALID_KEY, fonte: 'qrcode', raw: 'https://sefaz/chNFe=' + VALID_KEY });

    const result = await extractNFCeKey(filePath);

    expect(processImage).toHaveBeenCalledWith(path.resolve(filePath));
    expect(result.chave).toBe(VALID_KEY);
    fs.unlinkSync(filePath);
  });

  test('delegates pdf files to processPdf', async () => {
    const filePath = path.join(os.tmpdir(), 'nfce-pdf-test.pdf');
    fs.writeFileSync(filePath, 'fake');
    processPdf.mockResolvedValue({ chave: VALID_KEY, fonte: 'ocr', raw: VALID_KEY });

    const result = await extractNFCeKey(filePath);

    expect(processPdf).toHaveBeenCalledWith(path.resolve(filePath));
    expect(result).toEqual({ chave: VALID_KEY, fonte: 'ocr', raw: VALID_KEY });
    fs.unlinkSync(filePath);
  });
});
