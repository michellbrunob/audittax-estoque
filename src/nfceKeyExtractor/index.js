const { detectFileType, ensureFileExists } = require('./utils');
const { processImage } = require('./imageProcessor');
const { processPdf } = require('./pdfProcessor');

/**
 * Extrai a chave de acesso da NFC-e a partir de uma imagem (JPG/PNG) ou PDF.
 *
 * @param {string} filePath - Caminho absoluto para o arquivo (.jpg, .jpeg, .png, .pdf)
 * @returns {Promise<{ chave: string|null, fonte: 'qrcode'|'ocr'|null, raw: string }>}
 */
async function extractNFCeKey(filePath) {
  console.info('[nfce] iniciando processamento');
  const resolvedPath = ensureFileExists(filePath);
  const fileType = detectFileType(resolvedPath);
  console.info(`[nfce] tipo de arquivo detectado: ${fileType}`);

  const result = fileType === 'image'
    ? await processImage(resolvedPath)
    : await processPdf(resolvedPath);

  if (result && result.chave) {
    console.info(`[nfce] chave encontrada via ${result.fonte}`);
    return {
      chave: result.chave,
      fonte: result.fonte,
      raw: result.raw || '',
    };
  }

  console.info('[nfce] nenhuma chave valida encontrada');
  return {
    chave: null,
    fonte: null,
    raw: (result && result.raw) || '',
  };
}

module.exports = {
  extractNFCeKey,
};

// Exemplo de uso:
// const { extractNFCeKey } = require('./nfceKeyExtractor');
// (async () => {
//   const result = await extractNFCeKey('/caminho/para/cupom.jpg');
//   console.log(result);
//   // Exemplo de saida:
//   // { chave: '17260106057223057440650260000009551260014360', fonte: 'qrcode', raw: 'https://...' }
// })();
