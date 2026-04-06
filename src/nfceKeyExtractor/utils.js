const fs = require('fs');
const path = require('path');

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png']);
const PDF_EXTENSIONS = new Set(['.pdf']);

function detectFileType(filePath) {
  const extension = path.extname(String(filePath || '')).toLowerCase();

  if (IMAGE_EXTENSIONS.has(extension)) {
    return 'image';
  }

  if (PDF_EXTENSIONS.has(extension)) {
    return 'pdf';
  }

  throw new Error('Tipo de arquivo nao suportado. Use JPG, JPEG, PNG ou PDF.');
}

function ensureFileExists(filePath) {
  const normalizedPath = path.resolve(String(filePath || ''));
  const stats = fs.statSync(normalizedPath, { throwIfNoEntry: false });

  if (!stats || !stats.isFile()) {
    throw new Error(`Arquivo nao encontrado: ${normalizedPath}`);
  }

  return normalizedPath;
}

function getFileExtensionFromType(fileType) {
  return fileType === 'pdf' ? '.pdf' : '.png';
}

function requireDependency(packageName) {
  try {
    return require(packageName);
  } catch (primaryError) {
    try {
      const fallbackPath = path.resolve(__dirname, '../../backend/node_modules', packageName);
      return require(fallbackPath);
    } catch {
      const error = new Error(`Dependencia ausente: ${packageName}. Instale-a no projeto para usar o extrator NFC-e.`);
      error.cause = primaryError;
      throw error;
    }
  }
}

function extractKeyFromQrRaw(raw) {
  const text = String(raw || '').trim();
  if (!text) return null;

  try {
    const parsedUrl = new URL(text);
    const direct = parsedUrl.searchParams.get('chNFe');
    if (direct) return direct.replace(/\D/g, '');

    const packed = parsedUrl.searchParams.get('p');
    if (packed) {
      const match = packed.match(/\d{44}/);
      if (match) return match[0];
    }
  } catch {
    // QR nem sempre vem como URL perfeitamente parseavel; segue fallback por regex.
  }

  const fallback = text.match(/\d{44}/);
  return fallback ? fallback[0] : null;
}

function getReadableSnippet(text, key) {
  const source = String(text || '');
  const target = String(key || '').replace(/\D/g, '');
  if (!source || !target) return source;

  const compactSource = source.replace(/\s+/g, ' ');
  const digitsOnly = compactSource.replace(/\D/g, '');
  const index = digitsOnly.indexOf(target);
  if (index === -1) return compactSource.slice(0, 400);

  return compactSource.slice(Math.max(0, index - 80), index + 140);
}

module.exports = {
  detectFileType,
  ensureFileExists,
  getFileExtensionFromType,
  requireDependency,
  extractKeyFromQrRaw,
  getReadableSnippet,
};
