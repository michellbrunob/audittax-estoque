const {
  cleanKey,
  calcDigitoVerificador,
  isValidKey,
  extractKeysFromText,
  findFirstValidKey,
} = require('../src/nfceKeyExtractor/keyValidator');

const VALID_KEY = '17260106057223057440650260000009551260014360';

describe('keyValidator', () => {
  test('cleanKey remove espacos e caracteres nao numericos', () => {
    expect(cleanKey('1726 0106 0572-2305 7440')).toBe('17260106057223057440');
  });

  test('calcDigitoVerificador calcula o digito correto para a base da chave', () => {
    expect(calcDigitoVerificador(VALID_KEY.slice(0, 43))).toBe(Number(VALID_KEY[43]));
  });

  test('isValidKey aceita uma chave valida', () => {
    expect(isValidKey(VALID_KEY)).toBe(true);
  });

  test('isValidKey rejeita uma chave com digito verificador incorreto', () => {
    expect(isValidKey('17260106057223057440650260000009551260014361')).toBe(false);
  });

  test('extractKeysFromText encontra chaves continuas e com espacos', () => {
    const source = [
      'Chave continua: 17260106057223057440650260000009551260014360',
      'Chave espacada: 1726 0106 0572 2305 7440 6502 6000 0009 5512 6001 4360',
    ].join('\n');

    expect(extractKeysFromText(source)).toContain(VALID_KEY);
  });

  test('findFirstValidKey retorna a primeira chave valida encontrada', () => {
    expect(findFirstValidKey(`texto qualquer ${VALID_KEY} final`)).toBe(VALID_KEY);
  });
});
