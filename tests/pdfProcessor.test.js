const { processPdf, __private } = require('../src/nfceKeyExtractor/pdfProcessor');

const VALID_KEY = '17260106057223057440650260000009551260014360';

describe('processPdf', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('usa texto nativo do PDF quando a chave ja esta presente', async () => {
    __private.deps.loadPdfjs = jest.fn().mockResolvedValue({
      getDocument: jest.fn().mockReturnValue({
        promise: Promise.resolve({
          numPages: 1,
          getPage: async () => ({
            getTextContent: async () => ({ items: [{ str: `Consulte pela Chave de Acesso ${VALID_KEY}` }] }),
          }),
        }),
      }),
    });
    __private.deps.processImage = jest.fn();

    const result = await processPdf('/tmp/documento.pdf');

    expect(result.chave).toBe(VALID_KEY);
    expect(result.fonte).toBe('ocr');
    expect(__private.deps.processImage).not.toHaveBeenCalled();
  });
});
