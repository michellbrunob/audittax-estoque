require('dotenv').config();

const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const sharp = require('sharp');
const jsQR = require('jsqr');
const tesseract = require('node-tesseract-ocr');
const pdfParse = require('pdf-parse');
const pdfPoppler = require('pdf-poppler');

let readBarcodes;
const zxingReady = import('zxing-wasm/reader').then((mod) => {
  readBarcodes = mod.readBarcodes;
}).catch((err) => {
  console.warn('[ZXing] Falha ao carregar zxing-wasm:', err.message);
});

const app = express();
const upload = multer({ storage: multer.memoryStorage() });
const PORT = process.env.PORT || 3333;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514';

app.use(cors());
app.use(express.json());

const TESSERACT_CONFIG = {
  lang: 'por',
  oem: 3,
  psm: 6,
};

function apenasDigitos(valor) {
  return String(valor || '').replace(/\D/g, '');
}

function extrairSequencias44(texto) {
  const matches = String(texto || '').match(/\d{44}/g) || [];
  return [...new Set(matches)];
}

function verificarComandoDisponivel(comando) {
  return new Promise((resolve) => {
    const processo = spawn('where', [comando], {
      windowsHide: true,
      stdio: 'ignore',
    });

    processo.on('error', () => resolve(false));
    processo.on('close', (code) => resolve(code === 0));
  });
}

async function diagnosticarAmbiente() {
  const [tesseractInstalado, popplerInstalado] = await Promise.all([
    verificarComandoDisponivel('tesseract'),
    verificarComandoDisponivel('pdftoppm'),
  ]);

  return {
    anthropic: {
      configured: Boolean(ANTHROPIC_API_KEY),
      model: ANTHROPIC_MODEL,
      requiredFor: ['claude-vision-imagem', 'claude-vision-pdf'],
      installHint: ANTHROPIC_API_KEY
        ? ''
        : 'Configure a variavel ANTHROPIC_API_KEY no backend para habilitar a leitura por Claude Vision.',
    },
    tesseract: {
      installed: tesseractInstalado,
      requiredFor: ['ocr-imagem', 'ocr-pdf-escaneado'],
      installHint: tesseractInstalado
        ? ''
        : 'Instale o Tesseract OCR e adicione o executavel ao PATH do Windows.',
    },
    zxing: {
      loaded: Boolean(readBarcodes),
      requiredFor: ['qrcode-foto', 'qrcode-robusto'],
      installHint: readBarcodes ? '' : 'zxing-wasm nao carregou corretamente.',
    },
    poppler: {
      installed: popplerInstalado,
      requiredFor: ['pdf-escaneado'],
      installHint: popplerInstalado
        ? ''
        : 'Instale o Poppler para Windows e adicione o comando pdftoppm ao PATH.',
    },
  };
}

function validarChaveAcesso(chave) {
  const normalizada = apenasDigitos(chave);

  if (normalizada.length !== 44) {
    return false;
  }

  if (normalizada.slice(20, 22) !== '65') {
    return false;
  }

  const base = normalizada.slice(0, 43);
  const pesos = [2, 3, 4, 5, 6, 7, 8, 9];
  let soma = 0;
  let pesoIndex = 0;

  for (let i = base.length - 1; i >= 0; i -= 1) {
    soma += Number(base[i]) * pesos[pesoIndex];
    pesoIndex = (pesoIndex + 1) % pesos.length;
  }

  const resto = soma % 11;
  const dv = resto < 2 ? 0 : 11 - resto;
  return dv === Number(normalizada[43]);
}

function extrairChavesDoTexto(texto) {
  const textoBruto = String(texto || '');
  const linhas = textoBruto
    .split(/\r?\n/)
    .map((linha) => linha.trim())
    .filter(Boolean);

  const candidatas = new Set();
  extrairSequencias44(apenasDigitos(textoBruto)).forEach((chave) => candidatas.add(chave));

  for (let index = 0; index < linhas.length; index += 1) {
    const linha = linhas[index];
    const linhaSomenteDigitos = apenasDigitos(linha);

    if (linhaSomenteDigitos.length === 44) {
      candidatas.add(linhaSomenteDigitos);
    }

    if (/chave\s+de\s+acesso/i.test(linha)) {
      const janela = linhas.slice(index, index + 4).join(' ');
      const digitosJanela = apenasDigitos(janela);

      for (let inicio = 0; inicio <= digitosJanela.length - 44; inicio += 1) {
        candidatas.add(digitosJanela.slice(inicio, inicio + 44));
      }
    }
  }

  const candidatasOrdenadas = [...candidatas];
  const validas = candidatasOrdenadas.filter(validarChaveAcesso);

  return {
    candidatas: candidatasOrdenadas,
    validas,
  };
}

function extrairChaveDeUrl(qrData) {
  const texto = String(qrData || '');

  // Tenta parâmetro chNFe na URL (formato padrão SEFAZ)
  const matchChNFe = texto.match(/[?&](?:chNFe|p)=(\d{44})/i);
  if (matchChNFe && validarChaveAcesso(matchChNFe[1])) {
    return matchChNFe[1];
  }

  // Tenta extrair do path da URL (algumas SEFAZ colocam no path)
  const matchPath = texto.match(/\/(\d{44})(?:[/?&#]|$)/);
  if (matchPath && validarChaveAcesso(matchPath[1])) {
    return matchPath[1];
  }

  // Tenta parâmetro p= com pipe-separated (formato compacto NFC-e)
  const matchP = texto.match(/[?&]p=([^&]+)/i);
  if (matchP) {
    const valorP = decodeURIComponent(matchP[1]);
    const digitos = apenasDigitos(valorP);
    if (digitos.length >= 44) {
      const chave = digitos.slice(0, 44);
      if (validarChaveAcesso(chave)) {
        return chave;
      }
    }
  }

  return '';
}

function slug(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function parseMoneyValue(valor) {
  return Number(String(valor || '0').replace(/\./g, '').replace(',', '.'));
}

function parseCompactQtyUnit(raw) {
  const clean = String(raw || '').replace(/[^\d.,]/g, '');
  const match = clean.match(/^(\d{1,3})\.(\d{1,3}[.,]\d{1,2})$/);

  if (!match) {
    return null;
  }

  return {
    quantidade: Number(match[1]),
    precoUnitario: Number(match[2].replace(',', '.')),
  };
}

function parsePdfReceiptText(texto) {
  const lines = String(texto || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const draftItems = [];

  for (let index = 0; index < lines.length; index += 1) {
    if (!/^Qtde\.:VL\. Unit\.:C.*digo:/i.test(lines[index])) {
      continue;
    }

    const codigo = lines[index].match(/(\d{4,})/)?.[1] || '';
    const totalLine = lines[index - 1] || '';
    const compactLine = lines[index - 2] || '';
    const nameLine = (lines[index + 1] || '').replace(/VL\. Total$/i, '').trim();
    const qtyUnit = parseCompactQtyUnit(compactLine);
    const total = Number(String(totalLine || '').replace(',', '.'));

    if (!qtyUnit || !nameLine) {
      continue;
    }

    draftItems.push({
      id: draftItems.length + 1,
      include: true,
      nome: nameLine,
      quantidade: qtyUnit.quantidade,
      unidade: 'un',
      preco_unitario: qtyUnit.precoUnitario || (qtyUnit.quantidade ? Number((total / qtyUnit.quantidade).toFixed(2)) : 0),
      item_cadastrado: null,
      matchedItemId: '',
      confidence: 0.98,
      rawLine: `PDF texto nativo${codigo ? ` - codigo ${codigo}` : ''}`,
    });
  }

  const uniqueItems = draftItems.filter((entry, idx, arr) => idx === arr.findIndex((item) =>
    slug(item.nome) === slug(entry.nome)
    && item.preco_unitario === entry.preco_unitario
    && item.quantidade === entry.quantidade));

  const accessKeys = extrairChavesDoTexto(texto);
  const totalMatch = String(texto || '').match(/Valor pago:\s*\d+R\$\s*([\d.,]+)/i);
  const dateMatch = String(texto || '').match(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}:\d{2}:\d{2})/);
  const mercado = lines.find((line) => /SENDAS DISTRIBUIDORA|DANFE NFC-e/i.test(line)) || 'Emitente nao identificado';

  return {
    mercado: mercado.trim() || 'Emitente nao identificado',
    data: dateMatch ? `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}` : new Date().toISOString().slice(0, 10),
    total: totalMatch ? parseMoneyValue(totalMatch[1]) : 0,
    accessKey: accessKeys.validas[0] || '',
    accessKeySource: accessKeys.validas.length ? 'PDF texto' : '',
    accessKeyValid: Boolean(accessKeys.validas.length),
    accessKeyCandidates: accessKeys.validas.length ? accessKeys.validas : accessKeys.candidatas,
    items: uniqueItems,
    sourceMode: 'pdf-texto',
    queryUrl: /http:\/\/www\.sefaz\.to\.gov\.br\/nfce\/consulta\.jsf/i.test(texto) ? 'http://www.sefaz.to.gov.br/nfce/consulta.jsf' : '',
  };
}
function extrairJson(texto) {
  const bruto = String(texto || '').trim();
  const inicio = bruto.indexOf('{');
  const fim = bruto.lastIndexOf('}');

  if (inicio === -1 || fim === -1 || fim <= inicio) {
    return null;
  }

  try {
    return JSON.parse(bruto.slice(inicio, fim + 1));
  } catch {
    return null;
  }
}

function processarResultadoQr(rawData, fonte) {
  // Tenta extrair chave via parâmetros da URL primeiro
  const chaveUrl = extrairChaveDeUrl(rawData);
  if (chaveUrl) {
    console.log(`[QR] Chave extraida via URL (${fonte})`);
    return { raw: rawData, chave: chaveUrl, candidatas: [chaveUrl], erro: '' };
  }

  // Fallback: busca sequências de 44 dígitos no texto bruto
  const candidatas = extrairSequencias44(rawData);
  const digitosPuros = apenasDigitos(rawData);
  if (digitosPuros.length >= 44) {
    for (let inicio = 0; inicio <= digitosPuros.length - 44; inicio += 1) {
      const seq = digitosPuros.slice(inicio, inicio + 44);
      if (!candidatas.includes(seq)) {
        candidatas.push(seq);
      }
    }
  }

  const validas = candidatas.filter(validarChaveAcesso);
  console.log(`[QR] ${fonte}: ${validas.length} chaves validas, ${candidatas.length} candidatas`);

  return {
    raw: rawData,
    chave: validas[0] || candidatas[0] || '',
    candidatas,
    erro: validas.length || candidatas.length ? '' : 'QR Code lido, mas sem chave identificada.',
  };
}

async function lerQrCodeZXing(bufferImagem) {
  await zxingReady;
  if (!readBarcodes) return null;

  const metadata = await sharp(bufferImagem).metadata();
  const { width, height } = metadata;
  if (!width || !height) return null;

  // Variantes de imagem para tentar com ZXing
  const variantes = [
    // 1. Imagem original como PNG (ZXing aceita buffer direto)
    () => sharp(bufferImagem).png().toBuffer(),

    // 2. Metade inferior recortada (onde fica o QR na NFC-e)
    () => sharp(bufferImagem)
      .extract({ left: 0, top: Math.floor(height * 0.45), width, height: Math.floor(height * 0.55) })
      .png().toBuffer(),

    // 3. Terço inferior + upscale 2x (QR pequeno)
    () => {
      const cropH = Math.floor(height * 0.35);
      return sharp(bufferImagem)
        .extract({ left: 0, top: height - cropH, width, height: cropH })
        .resize({ width: width * 2, height: cropH * 2, fit: 'fill' })
        .sharpen()
        .png().toBuffer();
    },

    // 4. Grayscale + normalize (melhor contraste)
    () => sharp(bufferImagem).greyscale().normalize().png().toBuffer(),
  ];

  for (let i = 0; i < variantes.length; i += 1) {
    try {
      const pngBuffer = await variantes[i]();
      const results = await readBarcodes(pngBuffer, {
        formats: ['QRCode'],
        tryHarder: true,
        tryRotate: true,
        tryInvert: true,
        tryDownscale: true,
      });

      if (results.length > 0 && results[0].text) {
        console.log(`[ZXing] QR detectado na variante ${i + 1} de ${variantes.length}`);
        return processarResultadoQr(results[0].text, `zxing-variante-${i + 1}`);
      }
    } catch {
      // Variante falhou, próxima
    }
  }

  return null;
}

async function tentarJsQR(sharpInstance) {
  const { data, info } = await sharpInstance
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return jsQR(new Uint8ClampedArray(data), info.width, info.height);
}

async function lerQrCodeJsQR(bufferImagem) {
  const metadata = await sharp(bufferImagem).metadata();
  const { width, height } = metadata;
  if (!width || !height) return null;

  const tentativas = [
    () => tentarJsQR(sharp(bufferImagem)),
    () => tentarJsQR(sharp(bufferImagem).greyscale().normalize().threshold(128)),
    () => tentarJsQR(
      sharp(bufferImagem)
        .extract({ left: 0, top: Math.floor(height * 0.5), width, height: Math.floor(height * 0.5) })
        .greyscale().normalize().threshold(128)
    ),
    () => {
      const cropH = Math.floor(height * 0.35);
      return tentarJsQR(
        sharp(bufferImagem)
          .extract({ left: 0, top: height - cropH, width, height: cropH })
          .resize({ width: width * 2, height: cropH * 2, fit: 'fill' })
          .greyscale().normalize().threshold(128)
      );
    },
    () => tentarJsQR(sharp(bufferImagem).greyscale().negate().normalize().threshold(128)),
  ];

  for (let i = 0; i < tentativas.length; i += 1) {
    try {
      const qr = await tentativas[i]();
      if (qr?.data) {
        console.log(`[jsQR] Detectado na tentativa ${i + 1}`);
        return processarResultadoQr(qr.data, `jsqr-tentativa-${i + 1}`);
      }
    } catch {
      // próxima
    }
  }

  return null;
}

async function lerQrCodeDaImagem(bufferImagem) {
  try {
    // 1. Tenta ZXing primeiro (mais robusto para fotos reais)
    const resultadoZxing = await lerQrCodeZXing(bufferImagem);
    if (resultadoZxing && (resultadoZxing.chave || resultadoZxing.candidatas.length)) {
      return resultadoZxing;
    }

    // 2. Fallback para jsQR com pré-processamento
    const resultadoJsQR = await lerQrCodeJsQR(bufferImagem);
    if (resultadoJsQR) {
      return resultadoJsQR;
    }

    return {
      raw: '',
      chave: '',
      candidatas: [],
      erro: 'QR Code nao encontrado (ZXing + jsQR com multiplas variantes).',
    };
  } catch (error) {
    return {
      raw: '',
      chave: '',
      candidatas: [],
      erro: `Falha ao ler QR Code: ${error.message}`,
    };
  }
}

async function executarOCR(bufferImagem) {
  const metadata = await sharp(bufferImagem).metadata();
  const { width, height } = metadata;

  const cropTop = Math.floor(height * 0.55);
  const cropHeight = Math.max(1, height - cropTop);

  const bufferProcessado = await sharp(bufferImagem)
    .extract({ left: 0, top: cropTop, width, height: cropHeight })
    .greyscale()
    .normalize()
    .blur(1)
    .threshold(185)
    .png()
    .toBuffer();

  const texto = await tesseract.recognize(bufferProcessado, TESSERACT_CONFIG);

  return texto;
}

async function extrairTextoPdf(bufferPdf) {
  try {
    const parsed = await pdfParse(bufferPdf);
    return parsed.text || '';
  } catch {
    return '';
  }
}

async function converterPdfParaImagem(caminhoPdf) {
  const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nfce-pdf-'));

  const options = {
    format: 'png',
    out_dir: outputDir,
    out_prefix: 'pagina',
    page: 1,
  };

  await pdfPoppler.convert(caminhoPdf, options);

  const arquivos = await fs.readdir(outputDir);
  const primeiraImagem = arquivos.find((arquivo) => arquivo.toLowerCase().endsWith('.png'));

  if (!primeiraImagem) {
    throw new Error('Nao foi possivel converter o PDF para imagem.');
  }

  const caminhoImagem = path.join(outputDir, primeiraImagem);
  const bufferImagem = await fs.readFile(caminhoImagem);

  return { bufferImagem, outputDir };
}

async function consultarClaudeVision({ bufferArquivo, mediaType, originalname }) {
  if (!ANTHROPIC_API_KEY) {
    return {
      chave: '',
      candidatas: [],
      confianca: 'baixa',
      erro: 'Anthropic API nao configurada.',
    };
  }

  const base64 = bufferArquivo.toString('base64');
  const block = mediaType === 'application/pdf'
    ? {
        type: 'document',
        source: {
          type: 'base64',
          media_type: 'application/pdf',
          data: base64,
        },
      }
    : {
        type: 'image',
        source: {
          type: 'base64',
          media_type: mediaType || 'image/jpeg',
          data: base64,
        },
      };

  const prompt = [
    'Analise este cupom fiscal NFC-e brasileiro.',
    `Arquivo: ${originalname || 'upload'}`,
    'Extraia a chave de acesso de 44 digitos com a maior precisao possivel.',
    'Priorize o QR Code e a area com a frase "Consulte pela Chave de Acesso".',
    'Retorne somente JSON valido neste formato:',
    '{"chaveAcesso":"","candidatas":[],"confianca":"alta|media|baixa","observacoes":""}',
    'Se nao tiver certeza, informe candidatas provaveis em candidatas.',
  ].join(' ');

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 512,
      temperature: 0,
      messages: [
        {
          role: 'user',
          content: [
            block,
            { type: 'text', text: prompt },
          ],
        },
      ],
    }),
  });

  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error?.message || 'Falha ao consultar Claude Vision.');
  }

  const texto = (payload.content || [])
    .filter((item) => item.type === 'text')
    .map((item) => item.text)
    .join('\n');

  const parsed = extrairJson(texto) || {};
  const retornoTexto = [
    texto,
    parsed.chaveAcesso,
    ...(Array.isArray(parsed.candidatas) ? parsed.candidatas : []),
  ].join(' ');
  const extracao = extrairChavesDoTexto(retornoTexto);

  return {
    chave: extracao.validas[0] || '',
    candidatas: extracao.candidatas,
    confianca: parsed.confianca || 'media',
    rawText: texto,
    erro: extracao.validas.length ? '' : 'Claude nao retornou uma chave valida.',
  };
}

function escolherMelhorChave({ qrResult, pdfInfo, claudeInfo, ocrInfo }) {
  if (qrResult?.chave && validarChaveAcesso(qrResult.chave)) {
    return {
      chaveAcesso: qrResult.chave,
      fonte: 'qrcode',
      candidatas: [
        ...new Set([
          qrResult.chave,
          ...(claudeInfo?.candidatas || []),
          ...(pdfInfo?.candidatas || []),
          ...(ocrInfo?.candidatas || []),
        ]),
      ],
      confianca: 'alta',
    };
  }

  if (pdfInfo?.validas?.length) {
    return {
      chaveAcesso: pdfInfo.validas[0],
      fonte: 'pdf-texto',
      candidatas: [...new Set(pdfInfo.candidatas)],
      confianca: 'alta',
    };
  }

  if (claudeInfo?.chave && validarChaveAcesso(claudeInfo.chave)) {
    return {
      chaveAcesso: claudeInfo.chave,
      fonte: 'claude',
      candidatas: [
        ...new Set([
          claudeInfo.chave,
          ...(claudeInfo.candidatas || []),
          ...(ocrInfo?.candidatas || []),
        ]),
      ],
      confianca: claudeInfo.confianca || 'media',
    };
  }

  if (ocrInfo?.validas?.length) {
    let priorizada = ocrInfo.validas[0];
    const linhas = String(ocrInfo.texto || '')
      .split(/\r?\n/)
      .map((linha) => linha.trim())
      .filter(Boolean);

    for (let index = 0; index < linhas.length; index += 1) {
      if (/chave\s+de\s+acesso/i.test(linhas[index])) {
        const janela = apenasDigitos(linhas.slice(index, index + 4).join(' '));
        const encontrada = ocrInfo.validas.find((chave) => janela.includes(chave));
        if (encontrada) {
          priorizada = encontrada;
          break;
        }
      }
    }

    return {
      chaveAcesso: priorizada,
      fonte: 'ocr',
      candidatas: [...new Set(ocrInfo.candidatas)],
      confianca: 'media',
    };
  }

  return null;
}

async function processarImagem(bufferImagem, meta) {
  const dependencies = await diagnosticarAmbiente();
  const qrResult = await lerQrCodeDaImagem(bufferImagem);
  let claudeInfo = null;
  let ocrInfo = null;

  if (dependencies.anthropic.configured) {
    try {
      claudeInfo = await consultarClaudeVision({
        bufferArquivo: bufferImagem,
        mediaType: meta.mimetype,
        originalname: meta.originalname,
      });
    } catch (error) {
      claudeInfo = {
        chave: '',
        candidatas: [],
        confianca: 'baixa',
        erro: `Falha no Claude Vision: ${error.message}`,
      };
    }
  }

  if (dependencies.tesseract.installed) {
    const textoOcr = await executarOCR(bufferImagem);
    ocrInfo = {
      texto: textoOcr,
      ...extrairChavesDoTexto(textoOcr),
    };
  }

  return { qrResult, claudeInfo, ocrInfo, dependencies };
}

async function processarPdf(bufferPdf, meta) {
  const dependencies = await diagnosticarAmbiente();
  const textoPdf = await extrairTextoPdf(bufferPdf);
  const pdfInfo = {
    texto: textoPdf,
    ...extrairChavesDoTexto(textoPdf),
  };
  const parsedReceipt = parsePdfReceiptText(textoPdf);

  let claudeInfo = null;
  if (dependencies.anthropic.configured) {
    try {
      claudeInfo = await consultarClaudeVision({
        bufferArquivo: bufferPdf,
        mediaType: 'application/pdf',
        originalname: meta.originalname,
      });
    } catch (error) {
      claudeInfo = {
        chave: '',
        candidatas: [],
        confianca: 'baixa',
        erro: `Falha no Claude Vision: ${error.message}`,
      };
    }
  }

  if (pdfInfo.validas.length || (claudeInfo?.chave && validarChaveAcesso(claudeInfo.chave))) {
    return { pdfInfo, claudeInfo, qrResult: null, ocrInfo: null, dependencies, parsedReceipt };
  }

  if (!dependencies.tesseract.installed || !dependencies.poppler.installed) {
    return { pdfInfo, claudeInfo, qrResult: null, ocrInfo: null, dependencies, parsedReceipt };
  }

  const tempPdfPath = path.join(os.tmpdir(), `nfce-${Date.now()}.pdf`);
  let outputDir = '';

  try {
    await fs.writeFile(tempPdfPath, bufferPdf);
    const conversao = await converterPdfParaImagem(tempPdfPath);
    outputDir = conversao.outputDir;
    const resultadoImagem = await processarImagem(conversao.bufferImagem, {
      mimetype: 'image/png',
      originalname: `${meta.originalname || 'documento'}.png`,
    });

    return {
      pdfInfo,
      claudeInfo,
      qrResult: resultadoImagem.qrResult,
      ocrInfo: resultadoImagem.ocrInfo,
      dependencies,
      parsedReceipt,
    };
  } finally {
    await fs.rm(tempPdfPath, { force: true }).catch(() => {});
    if (outputDir) {
      await fs.rm(outputDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

app.get('/nfce/health', async (_req, res) => {
  try {
    const dependencies = await diagnosticarAmbiente();
    const ready = dependencies.anthropic.configured || (dependencies.tesseract.installed && dependencies.poppler.installed);

    return res.json({
      status: ready ? 'ok' : 'warning',
      dependencies,
      message: ready
        ? 'Ambiente pronto. O modulo pode usar Claude Vision e/ou OCR local.'
        : 'Falta configurar Anthropic API ou instalar dependencias locais para OCR/PDF.',
    });
  } catch (error) {
    return res.status(500).json({
      status: 'error',
      error: `Falha ao verificar dependencias: ${error.message}`,
    });
  }
});

app.post('/nfce/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      console.log('[nfce/upload] requisicao sem arquivo');
      return res.status(400).json({ error: 'Nenhum arquivo enviado.' });
    }

    const { mimetype, originalname, buffer } = req.file;
    console.log('[nfce/upload] arquivo recebido: ' + (originalname || 'sem-nome') + ' (' + (mimetype || 'desconhecido') + ')');
    const nome = String(originalname || '').toLowerCase();
    const isPdf = mimetype === 'application/pdf' || nome.endsWith('.pdf');
    const isImage = mimetype.startsWith('image/') || /\.(png|jpe?g)$/i.test(nome);

    if (!isPdf && !isImage) {
      return res.status(400).json({ error: 'Formato nao suportado. Envie JPG, PNG ou PDF.' });
    }

    let qrResult = null;
    let ocrInfo = null;
    let pdfInfo = null;
    let claudeInfo = null;
    let parsedReceipt = null;
    let dependencies = await diagnosticarAmbiente();

    if (isPdf) {
      const resultadoPdf = await processarPdf(buffer, { mimetype, originalname });
      qrResult = resultadoPdf.qrResult;
      ocrInfo = resultadoPdf.ocrInfo;
      pdfInfo = resultadoPdf.pdfInfo;
      parsedReceipt = resultadoPdf.parsedReceipt;
      claudeInfo = resultadoPdf.claudeInfo;
      dependencies = resultadoPdf.dependencies;
    } else {
      const resultadoImagem = await processarImagem(buffer, { mimetype, originalname });
      qrResult = resultadoImagem.qrResult;
      ocrInfo = resultadoImagem.ocrInfo;
      claudeInfo = resultadoImagem.claudeInfo;
      parsedReceipt = null;
      dependencies = resultadoImagem.dependencies;
    }

    if (
      !dependencies.anthropic.configured &&
      !dependencies.tesseract.installed &&
      !(isPdf && pdfInfo?.validas?.length)
    ) {
      return res.status(503).json({
        error: 'Nenhum motor de leitura esta disponivel. Configure a Anthropic API ou instale o Tesseract OCR.',
        dependencies,
      });
    }

    const melhor = escolherMelhorChave({ qrResult, pdfInfo, claudeInfo, ocrInfo });

    if (!melhor) {
      const erros = [];

      if (isImage) {
        erros.push(qrResult?.erro || 'Nao conseguiu ler QR Code.');
        if (claudeInfo?.erro) {
          erros.push(claudeInfo.erro);
        }
        if (ocrInfo && !ocrInfo.candidatas.length) {
          erros.push('Nao encontrou sequencia de 44 digitos no OCR.');
        }
      }

      if (isPdf) {
        if (!pdfInfo?.candidatas?.length) {
          erros.push('Nao encontrou sequencia de 44 digitos no texto do PDF.');
        }
        if (claudeInfo?.erro) {
          erros.push(claudeInfo.erro);
        }
        if (!dependencies.poppler.installed) {
          erros.push('Poppler nao instalado para converter PDF escaneado em imagem.');
        }
      }

      return res.status(422).json({
        error: erros.join(' | ') || 'Nenhuma chave valida foi localizada.',
        dependencies,
        candidatas: [
          ...new Set([
            ...(qrResult?.candidatas || []),
            ...(claudeInfo?.candidatas || []),
            ...(ocrInfo?.candidatas || []),
            ...(pdfInfo?.candidatas || []),
          ]),
        ],
      });
    }

    return res.json({
      chaveAcesso: melhor.chaveAcesso,
      fonte: melhor.fonte,
      confianca: melhor.confianca,
      candidatas: melhor.candidatas,
      parsedReceipt,
      dependencies,
    });
  } catch (error) {
    return res.status(500).json({
      error: `Falha ao processar o arquivo: ${error.message}`,
    });
  }
});

app.listen(PORT, () => {
  console.log(`API NFC-e pronta em http://localhost:${PORT}`);
});








