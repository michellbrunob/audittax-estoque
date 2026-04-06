const regexSpaced = /(\d{4}\s){10}\d{4}/g;
const regexContinuous = /\b\d{44}\b/g;

const VALID_UF_CODES = new Set([
  '11', '12', '13', '14', '15', '16', '17',
  '21', '22', '23', '24', '25', '26', '27', '28', '29',
  '31', '32', '33', '35',
  '41', '42', '43',
  '50', '51', '52', '53',
]);

function cleanKey(key) {
  return String(key || '').replace(/\D/g, '');
}

function isValidUF(code) {
  return VALID_UF_CODES.has(String(code || ''));
}

function calcDigitoVerificador(chave43) {
  const digits = cleanKey(chave43);
  if (digits.length !== 43) {
    throw new Error('A base para calculo do digito verificador deve ter 43 digitos.');
  }

  let soma = 0;
  let peso = 2;

  for (let index = digits.length - 1; index >= 0; index -= 1) {
    soma += Number(digits[index]) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }

  const resto = soma % 11;
  let dv = 11 - resto;
  if (dv === 0 || dv === 10 || dv === 11) {
    dv = 0;
  }

  return dv;
}

function isValidKey(chave) {
  const normalized = cleanKey(chave);
  if (normalized.length !== 44) return false;
  if (!/^\d{44}$/.test(normalized)) return false;
  if (!isValidUF(normalized.slice(0, 2))) return false;

  const expected = calcDigitoVerificador(normalized.slice(0, 43));
  return expected === Number(normalized[43]);
}

function extractKeysFromText(text) {
  const source = String(text || '');
  const keys = [];

  for (const match of source.matchAll(regexSpaced)) {
    keys.push(cleanKey(match[0]));
  }

  for (const match of source.matchAll(regexContinuous)) {
    keys.push(cleanKey(match[0]));
  }

  return [...new Set(keys)];
}

function findFirstValidKey(text) {
  const candidates = extractKeysFromText(text);
  for (const candidate of candidates) {
    if (isValidKey(candidate)) {
      return candidate;
    }
  }
  return null;
}

module.exports = {
  regexSpaced,
  regexContinuous,
  cleanKey,
  isValidUF,
  calcDigitoVerificador,
  isValidKey,
  extractKeysFromText,
  findFirstValidKey,
};
