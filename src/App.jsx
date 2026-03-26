import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createWorker } from 'tesseract.js';
import QrScanner from 'qr-scanner';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker?url';
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

const STORAGE_KEY = 'controle-limpeza-react-v1';
const todayString = () => new Date().toISOString().split('T')[0];
const formatDate = (value) => new Date(`${value}T12:00:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
const formatDateTime = (value) => new Date(value).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const timestampString = () => new Date().toISOString();
const addDays = (dateString, days) => { const date = new Date(`${dateString}T12:00:00`); date.setDate(date.getDate() + days); return date; };
const diffDays = (a, b) => Math.ceil((a - b) / 86400000);
const currency = (value) => Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const slug = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const downloadDataUrl = (dataUrl, fileName) => {
  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = fileName || 'comprovante';
  document.body.appendChild(link);
  link.click();
  link.remove();
};
const TO_NFCE_CONSULT_URL = 'https://www.sefaz.to.gov.br/nfce/consulta.jsf';
const DEFAULT_NFCE_API_BASE_URL = typeof window !== 'undefined' && ['localhost', '127.0.0.1'].includes(window.location.hostname)
  ? 'http://127.0.0.1:3333'
  : '';
const NFCE_API_BASE_URL = (import.meta.env.VITE_NFCE_API_URL || DEFAULT_NFCE_API_BASE_URL || '').replace(/\/$/, '');
const NFCE_EXTRACT_API_URL = NFCE_API_BASE_URL ? (NFCE_API_BASE_URL + '/nfce/upload') : '';
const openToNfcePortalWithKey = (accessKey) => {
  const key = extractAccessKey(accessKey);
  if (!key) return false;
  const form = document.createElement('form');
  form.method = 'post';
  form.action = TO_NFCE_CONSULT_URL;
  form.target = '_blank';
  const input = document.createElement('input');
  input.type = 'hidden';
  input.name = 'nfce';
  input.value = key;
  form.appendChild(input);
  document.body.appendChild(form);
  form.submit();
  form.remove();
  return true;
};

const detectAccessKeyWithBackend = async (file) => {
  if (!NFCE_EXTRACT_API_URL) {
    throw new Error('Backend NFC-e nao configurado neste ambiente.');
  }
  const formData = new FormData();
  formData.append('file', file);
  const response = await fetch(NFCE_EXTRACT_API_URL, { method: 'POST', body: formData });
  const data = await response.json().catch(() => ({}));
  if (!response.ok && !data.bestEffortKey && !(data.candidatas || []).length) throw new Error(data.error || 'Falha ao consultar o backend da NFC-e.');
  return { ...data, backendOk: response.ok };
};
const backendSourceLabel = (source) => ({ qrcode: 'QR Code', 'pdf-texto': 'PDF texto', claude: 'Claude Vision', ocr: 'OCR backend' }[source] || source || 'OCR local');

const UNIT_OPTIONS = [
  { value: 'un', label: 'Unidade (un)', family: 'count', factor: 1 },
  { value: 'pct', label: 'Pacote (pct)', family: 'count', factor: 1 },
  { value: 'cx', label: 'Caixa (cx)', family: 'count', factor: 1 },
  { value: 'fd', label: 'Fardo (fd)', family: 'count', factor: 1 },
  { value: 'fr', label: 'Frasco (fr)', family: 'count', factor: 1 },
  { value: 'gl', label: 'Galao (gl)', family: 'count', factor: 1 },
  { value: 'rl', label: 'Rolo (rl)', family: 'count', factor: 1 },
  { value: 'dz', label: 'Duzia (dz)', family: 'count', factor: 1 },
  { value: 'kg', label: 'Quilograma (kg)', family: 'weight', factor: 1 },
  { value: 'g', label: 'Grama (g)', family: 'weight', factor: 0.001 },
  { value: 'mg', label: 'Miligramas (mg)', family: 'weight', factor: 0.000001 },
  { value: 'l', label: 'Litro (L)', family: 'volume', factor: 1 },
  { value: 'ml', label: 'Mililitro (mL)', family: 'volume', factor: 0.001 },
  { value: 'm', label: 'Metro (m)', family: 'length', factor: 1 },
  { value: 'cm', label: 'Centimetro (cm)', family: 'length', factor: 0.01 }
];
const UNIT_MAP = Object.fromEntries(UNIT_OPTIONS.map((unit) => [unit.value, unit]));
const normalizeUnit = (raw) => {
  const value = slug(raw).replace(/[^a-z]/g, '');
  const aliases = {
    unidade: 'un', und: 'un', unid: 'un', pc: 'pct', pacote: 'pct', pacotec: 'pct', caixa: 'cx', fardo: 'fd', frasco: 'fr', galao: 'gl', rolo: 'rl', duzia: 'dz', quilo: 'kg', kilos: 'kg', quilograma: 'kg', grama: 'g', gramas: 'g', miligrama: 'mg', litro: 'l', litros: 'l', mililitro: 'ml', mililitros: 'ml', metro: 'm', metros: 'm', centimetro: 'cm', centimetros: 'cm'
  };
  return UNIT_MAP[value] ? value : (aliases[value] || 'un');
};
const computeLineTotal = (quantity, unitPrice, unit) => {
  const normalizedUnit = normalizeUnit(unit);
  const factor = UNIT_MAP[normalizedUnit]?.factor || 1;
  return Number((Number(quantity || 0) * factor * Number(unitPrice || 0)).toFixed(2));
};
const getUnitOptionsMarkup = () => UNIT_OPTIONS.map((unit) => <option key={unit.value} value={unit.value}>{unit.label}</option>);

const initialState = {
  items: [
    { id: 1, name: 'Detergente', unit: 'L', quantity: 3, minStock: 2, weeklyConsumption: 1 },
    { id: 2, name: 'Agua sanitaria', unit: 'L', quantity: 1, minStock: 3, weeklyConsumption: 0.5 },
    { id: 3, name: 'Sabao em po', unit: 'kg', quantity: 5, minStock: 2, weeklyConsumption: 0.3 },
    { id: 4, name: 'Desinfetante', unit: 'L', quantity: 4, minStock: 2, weeklyConsumption: 0.5 },
    { id: 5, name: 'Papel toalha', unit: 'pct', quantity: 2, minStock: 4, weeklyConsumption: 1 },
    { id: 6, name: 'Esponja', unit: 'un', quantity: 6, minStock: 3, weeklyConsumption: 0.5 }
  ],
  movements: [
    { id: 1, type: 'entrada', itemId: 1, quantity: 5, date: '2026-03-10', notes: 'Compra mensal' },
    { id: 2, type: 'saida', itemId: 1, quantity: 2, date: '2026-03-15', notes: 'Uso cozinha' },
    { id: 3, type: 'entrada', itemId: 2, quantity: 4, date: '2026-03-01', notes: 'NF 1021' },
    { id: 4, type: 'saida', itemId: 2, quantity: 3, date: '2026-03-20', notes: 'Limpeza geral' }
  ],
  priceHistory: [
    { id: 1, itemId: 1, market: 'Atacadao', price: 4.9, date: '2026-02-10' },
    { id: 2, itemId: 1, market: 'Assai', price: 5.2, date: '2026-03-01' },
    { id: 3, itemId: 2, market: 'Carrefour', price: 3.8, date: '2026-03-01' },
    { id: 4, itemId: 5, market: 'Assai', price: 11.5, date: '2026-03-15' }
  ],
  extraPurchases: [
    { id: 1, itemId: 2, quantity: 2, date: '2026-03-14', cost: 7, reason: 'Uso intenso no fim do mes', location: 'Mercadinho Central' },
    { id: 2, itemId: 5, quantity: 1, date: '2026-03-19', cost: 13.5, reason: 'Estoque acabou antes do previsto', location: 'Atacadao' }
  ],
  receipts: [
    { id: 1, title: 'NF-001 Marco', value: 87.5, date: '2026-03-01', notes: 'Compra semanal' },
    { id: 2, title: 'NF-002 Marco', value: 145, date: '2026-03-15', notes: 'Reposicao geral' }
  ],
  suppliers: [
    { id: 1, name: 'Atacadao', tradeName: 'Atacadao', type: 'atacado', city: 'Sao Paulo', state: 'SP', cnpj: '', notes: '', active: true },
    { id: 2, name: 'Assai', tradeName: 'Assai', type: 'atacado', city: 'Sao Paulo', state: 'SP', cnpj: '', notes: '', active: true },
    { id: 3, name: 'Carrefour', tradeName: 'Carrefour', type: 'mercado', city: 'Sao Paulo', state: 'SP', cnpj: '', notes: '', active: true }
  ],
  cycle: { lastPurchaseDate: '2026-03-06', intervalDays: 60 },
  settings: { receiptPassword: '1234', anthropicApiKey: '' },
  counters: { item: 7, movement: 5, price: 5, extraPurchase: 3, receipt: 3, supplier: 4 }
};

const hydrateState = (raw) => {
  if (!raw || typeof raw !== 'object') return initialState;
  return {
    ...initialState,
    ...raw,
    items: Array.isArray(raw.items) ? raw.items : initialState.items,
    movements: Array.isArray(raw.movements) ? raw.movements : initialState.movements,
    priceHistory: Array.isArray(raw.priceHistory) ? raw.priceHistory : initialState.priceHistory,
    extraPurchases: Array.isArray(raw.extraPurchases) ? raw.extraPurchases : initialState.extraPurchases,
    receipts: Array.isArray(raw.receipts) ? raw.receipts : initialState.receipts,
    suppliers: Array.isArray(raw.suppliers) ? raw.suppliers : initialState.suppliers,
    cycle: raw.cycle && typeof raw.cycle === 'object' ? { ...initialState.cycle, ...raw.cycle } : initialState.cycle,
    settings: raw.settings && typeof raw.settings === 'object' ? { ...initialState.settings, ...raw.settings } : initialState.settings,
    counters: raw.counters && typeof raw.counters === 'object' ? { ...initialState.counters, ...raw.counters } : initialState.counters
  };
};

const parseMoneyValue = (raw) => Number(String(raw || '0').replace(/\./g, '').replace(',', '.'));
const parseQuantityValue = (raw) => Number(String(raw || '1').replace(',', '.'));
const isReceiptNoise = (line) => /subtotal|desconto|troco|pix|cartao|debito|credito|dinheiro|pagamento|recebido|cnpj|cupom|extrato|caixa|operador|cliente|documento|ie\b|valor pago|senha|nsu/i.test(line);
const findExistingItem = (name, items) => {
  const target = slug(name);
  const exact = items.find((item) => slug(item.name) === target);
  if (exact) return exact;
  const partial = items.find((item) => target.includes(slug(item.name)) || slug(item.name).includes(target));
  return partial || null;
};
const findExistingSupplier = (name, suppliers) => {
  const target = slug(name);
  if (!target) return null;
  const exact = suppliers.find((supplier) => slug(supplier.name) === target || slug(supplier.tradeName) === target);
  if (exact) return exact;
  const partial = suppliers.find((supplier) => target.includes(slug(supplier.name)) || slug(supplier.name).includes(target) || target.includes(slug(supplier.tradeName)) || slug(supplier.tradeName).includes(target));
  return partial || null;
};
const consolidateDraftItems = (entries, catalogItems = []) => {
  const groups = new Map();
  (entries || []).forEach((entry) => {
    if (!entry?.nome) return;
    const normalizedUnit = normalizeUnit(entry.unidade || 'un');
    const normalizedPrice = Number(Number(entry.preco_unitario || 0).toFixed(2));
    const key = [slug(entry.nome), normalizedUnit, normalizedPrice].join('|');
    const quantity = Number(entry.quantidade || 0);
    const matchedItem = entry.matchedItemId ? catalogItems.find((item) => item.id === Number(entry.matchedItemId)) : findExistingItem(entry.item_cadastrado || entry.nome, catalogItems);
    if (!groups.has(key)) {
      groups.set(key, {
        ...entry,
        id: groups.size + 1,
        unidade: normalizedUnit,
        quantidade: quantity,
        preco_unitario: normalizedPrice,
        item_cadastrado: matchedItem?.name || entry.item_cadastrado || null,
        matchedItemId: matchedItem?.id ? String(matchedItem.id) : (entry.matchedItemId || ''),
        confidence: Number(entry.confidence || 0),
        rawLine: entry.rawLine || '',
        lineCount: 1
      });
      return;
    }
    const current = groups.get(key);
    current.quantidade = Number((current.quantidade + quantity).toFixed(2));
    current.confidence = Math.max(Number(current.confidence || 0), Number(entry.confidence || 0));
    current.lineCount += 1;
    if (!current.rawLine && entry.rawLine) current.rawLine = entry.rawLine;
    if (!current.item_cadastrado && matchedItem?.name) {
      current.item_cadastrado = matchedItem.name;
      current.matchedItemId = String(matchedItem.id);
    }
  });
  return [...groups.values()].map((entry, index) => ({
    ...entry,
    id: index + 1,
    rawLine: entry.lineCount > 1 ? ((entry.rawLine || 'Item agrupado') + ' - agrupado de ' + entry.lineCount + ' linha(s)') : entry.rawLine
  }));
};

const scoreConfidence = ({ name, quantity, unitPrice, rawLine, matchedItem }) => {
  let score = 0.35;
  if (name && name.length >= 5) score += 0.2;
  if (quantity > 0) score += 0.15;
  if (unitPrice > 0) score += 0.15;
  if (/\d{1,3}(?:\.\d{3})*,\d{2}/.test(rawLine)) score += 0.1;
  if (matchedItem) score += 0.1;
  return Math.max(0.05, Math.min(0.99, Number(score.toFixed(2))));
};
const extractStructuredLine = (line, items) => {
  if (isReceiptNoise(line)) return null;
  const clean = line.replace(/\s+/g, ' ').trim();
  if (!clean || clean.length < 4) return null;
  const values = [...clean.matchAll(/\d{1,3}(?:\.\d{3})*,\d{2}/g)].map((match) => match[0]);
  if (!values.length) return null;
  const unitPrice = parseMoneyValue(values.at(-1));
  if (!unitPrice || unitPrice > 99999) return null;
  let quantity = 1;
  let unit = 'un';
  let name = clean.replace(/\d{1,3}(?:\.\d{3})*,\d{2}\s*$/, '').trim();
  const qtyUnitPrice = clean.match(/^(.*?)(\d+[.,]?\d*)\s*(un|und|unid|pct|pc|kg|g|mg|l|lt|ml|cx|fd|fr|gl|rl|dz|m|mt|cm)?\s+(\d{1,3}(?:\.\d{3})*,\d{2})$/i);
  const qtyTimesPrice = clean.match(/^(.*?)(\d+[.,]?\d*)\s*[xX]\s*(\d{1,3}(?:\.\d{3})*,\d{2})$/i);
  if (qtyUnitPrice) {
    name = qtyUnitPrice[1].trim();
    quantity = parseQuantityValue(qtyUnitPrice[2]);
    unit = qtyUnitPrice[3] || 'un';
  } else if (qtyTimesPrice) {
    name = qtyTimesPrice[1].trim();
    quantity = parseQuantityValue(qtyTimesPrice[2]);
  }
  name = name.replace(/^[\d\-.\s]+/, '').replace(/\s{2,}/g, ' ').trim();
  if (!name || name.length < 3) return null;
  const matchedItem = findExistingItem(name, items);
  const confidence = scoreConfidence({ name, quantity, unitPrice, rawLine: clean, matchedItem });
  return {
    nome: name,
    quantidade: quantity || 1,
    unidade: normalizeUnit(unit.toLowerCase()),
    preco_unitario: unitPrice,
    item_cadastrado: matchedItem?.name || null,
    matchedItemId: matchedItem?.id || '',
    confidence,
    rawLine: clean
  };
};
const parseReceiptText = (text, items) => {
  const lines = String(text || '').split(/\r?\n/).map((line) => line.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const market = lines.find((line) => /[A-Za-z]{3,}/.test(line) && !/cnpj|cupom|documento|extrato/i.test(line)) || 'Estabelecimento nao identificado';
  const dateMatch = text.match(/(\d{2})[\/.-](\d{2})[\/.-](\d{2,4})/);
  const date = dateMatch ? `${dateMatch[3].length === 2 ? `20${dateMatch[3]}` : dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}` : todayString();
  const totalCandidates = [...text.matchAll(/(?:total\s*(?:r\$)?\s*)(\d{1,3}(?:\.\d{3})*,\d{2})/gi)].map((match) => parseMoneyValue(match[1]));
  const genericValues = [...text.matchAll(/\b\d{1,3}(?:\.\d{3})*,\d{2}\b/g)].map((match) => parseMoneyValue(match[0]));
  const total = totalCandidates.length ? Math.max(...totalCandidates) : (genericValues.length ? Math.max(...genericValues) : 0);
  const draft = lines.map((line) => extractStructuredLine(line, items)).filter(Boolean);
  const unique = draft.filter((entry, index, array) => index === array.findIndex((candidate) => slug(candidate.nome) === slug(entry.nome) && candidate.preco_unitario === entry.preco_unitario && candidate.quantidade === entry.quantidade));
  return { mercado: market, data: date, total, items: unique };
};
const readFileAsText = (file) => new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result || '')); reader.onerror = () => reject(new Error('Falha ao ler o XML.')); reader.readAsText(file); });
const xmlNodeText = (parent, tags) => {
  for (const tag of tags) {
    const node = parent.getElementsByTagName(tag)[0];
    if (node?.textContent) return node.textContent.trim();
  }
  return '';
};
const parseFiscalXml = (xmlText, items) => {
  const parser = new DOMParser();
  const xml = parser.parseFromString(xmlText, 'application/xml');
  if (xml.getElementsByTagName('parsererror').length) throw new Error('XML fiscal invalido.');
  const emit = xml.getElementsByTagName('emit')[0];
  const ide = xml.getElementsByTagName('ide')[0];
  const totalNode = xml.getElementsByTagName('ICMSTot')[0];
  const accessKey = xmlNodeText(xml, ['chNFe']) || (xml.getElementsByTagName('infNFe')[0]?.getAttribute('Id') || '').replace(/^NFe/, '');
  const rawDate = xmlNodeText(ide || xml, ['dhEmi', 'dEmi']);
  const normalizedDate = rawDate ? rawDate.slice(0, 10) : todayString();
  const market = xmlNodeText(emit || xml, ['xFant', 'xNome']) || 'Emitente nao identificado';
  const total = parseMoneyValue(xmlNodeText(totalNode || xml, ['vNF']) || '0');
  const draftItems = [...xml.getElementsByTagName('det')].map((det, index) => {
    const prod = det.getElementsByTagName('prod')[0] || det;
    const nome = xmlNodeText(prod, ['xProd']);
    const quantidade = Number((xmlNodeText(prod, ['qCom']) || '0').replace(',', '.'));
    const unidade = normalizeUnit(xmlNodeText(prod, ['uCom']) || 'un');
    const preco = Number((xmlNodeText(prod, ['vUnCom']) || '0').replace(',', '.'));
    const matchedItem = findExistingItem(nome, items);
    return {
      id: index + 1,
      include: true,
      nome,
      quantidade,
      unidade,
      preco_unitario: preco,
      item_cadastrado: matchedItem?.name || null,
      matchedItemId: matchedItem?.id || '',
      confidence: 0.99,
      rawLine: 'XML fiscal estruturado'
    };
  }).filter((entry) => entry.nome);
  if (!draftItems.length) throw new Error('Nenhum item foi encontrado no XML fiscal.');
  return { mercado: market, data: normalizedDate, total, accessKey, items: draftItems, sourceMode: 'xml', queryUrl: '' };
};
const extractPdfTextFromFile = async (file) => {
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  const allLines = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const text = await page.getTextContent();
    const rows = new Map();
    for (const item of text.items) {
      const y = Math.round(item.transform?.[5] || 0);
      if (!rows.has(y)) rows.set(y, []);
      rows.get(y).push({ x: item.transform?.[4] || 0, text: item.str || '' });
    }
    const ordered = [...rows.entries()].sort((a, b) => b[0] - a[0]);
    for (const [, cols] of ordered) {
      const line = cols.sort((a, b) => a.x - b.x).map((col) => col.text).join('').replace(/\s+/g, ' ').trim();
      if (line) allLines.push(line);
    }
  }
  return allLines.join('\n');
};
const parseCompactQtyUnit = (raw) => {
  const clean = String(raw || '').replace(/[^\d.,]/g, '');
  const match = clean.match(/^(\d{1,3})\.(\d{1,3}[.,]\d{1,2})$/);
  if (!match) return null;
  return { quantidade: Number(match[1]), preco_unitario: Number(match[2].replace(',', '.')) };
};
const parseNativePdfReceiptText = (text, items) => {
  const lines = String(text || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const draftItems = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (!/^Qtde\\.:VL\\. Unit\\.:C.*digo:/i.test(lines[index])) continue;
    const code = lines[index].match(/(\d{4,})/)?.[1] || '';
    const totalLine = lines[index - 1] || '';
    const compactLine = lines[index - 2] || '';
    const nameLine = (lines[index + 1] || '').replace(/VL\. Total$/i, '').trim();
    const qtyUnit = parseCompactQtyUnit(compactLine);
    const total = Number(String(totalLine || '').replace(',', '.'));
    if (!qtyUnit || !nameLine) continue;
    const matchedItem = findExistingItem(nameLine, items);
    draftItems.push({
      id: draftItems.length + 1,
      include: true,
      nome: nameLine,
      quantidade: qtyUnit.quantidade,
      unidade: 'un',
      preco_unitario: qtyUnit.preco_unitario || (qtyUnit.quantidade ? Number((total / qtyUnit.quantidade).toFixed(2)) : 0),
      item_cadastrado: matchedItem?.name || null,
      matchedItemId: matchedItem?.id || '',
      confidence: 0.98,
      rawLine: 'PDF texto nativo' + (code ? ' - codigo ' + code : '')
    });
  }
  const unique = draftItems.filter((entry, idx, arr) => idx === arr.findIndex((item) => slug(item.nome) === slug(entry.nome) && item.preco_unitario === entry.preco_unitario && item.quantidade === entry.quantidade));
  const market = lines.find((line) => /SENDAS DISTRIBUIDORA|DANFE NFC-e/i.test(line)) || 'Emitente nao identificado';
  const dateMatch = String(text || '').match(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}:\d{2}:\d{2})/);
  const totalMatch = String(text || '').match(/Valor pago:\s*\d+R\$\s*([\d.,]+)/i);
    const validAccessKeys = extractAccessKeyCandidates(text).filter((candidate) => validateAccessKey(candidate));
  const accessKey = validAccessKeys[0] || '';
  return {
    mercado: market.trim() || 'Emitente nao identificado',
    data: dateMatch ? (dateMatch[3] + '-' + dateMatch[2] + '-' + dateMatch[1]) : todayString(),
    total: totalMatch ? parseMoneyValue(totalMatch[1]) : 0,
    accessKey,
    accessKeySource: accessKey ? 'PDF texto' : '',
    accessKeyValid: accessKey ? validateAccessKey(accessKey) : false,
    accessKeyCandidates: validAccessKeys.length ? validAccessKeys : extractAccessKeyCandidates(text),
    items: unique,
    sourceMode: 'pdf-texto',
    queryUrl: /http:\/\/www\.sefaz\.to\.gov\.br\/nfce\/consulta\.jsf/i.test(text) ? 'http://www.sefaz.to.gov.br/nfce/consulta.jsf' : ''
  };
};
const extractAccessKey = (raw) => String(raw || '').replace(/\D/g, '').match(/\d{44}/)?.[0] || '';
// Corrige erros OCR leves em trechos que já são predominantemente dígitos
const fixOcrInDigitRun = (text) => String(text || '').replace(/[\]|!]/g, '1');

// Verifica se uma linha é predominantemente dígitos (>70% dos não-espaço são dígitos)
const isDigitLine = (line) => {
  const chars = line.replace(/\s/g, '');
  if (chars.length < 30) return false;
  const digitCount = (chars.match(/\d/g) || []).length;
  return digitCount / chars.length > 0.7;
};

const extractAccessKeyCandidates = (raw) => {
  const text = String(raw || '');
  const candidates = [];

  // 1. Busca direta por 44 dígitos consecutivos (ex: chave sem espaços)
  const directMatches = text.match(/\d{44}/g) || [];
  directMatches.forEach((m) => candidates.push(m));

  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  // 2. Linhas predominantemente numéricas (padrão visual: "1726 0111 1642 4800 ...")
  // APENAS extrai de linhas que já são >70% dígitos — evita falsos positivos
  for (const line of lines) {
    if (isDigitLine(line)) {
      const fixed = fixOcrInDigitRun(line);
      const digits = fixed.replace(/\D/g, '');
      if (digits.length >= 44) {
        // Sliding window APENAS dentro desta linha de dígitos
        for (let j = 0; j <= digits.length - 44; j += 1) {
          candidates.push(digits.slice(j, j + 44));
        }
      }
    }
  }

  // 3. Busca contextual: linha de dígitos logo após "chave" / "acesso"
  for (let i = 0; i < lines.length; i += 1) {
    if (/chave|acesso/i.test(lines[i])) {
      // Procura a próxima linha que é predominantemente numérica
      for (let k = i + 1; k < Math.min(i + 5, lines.length); k += 1) {
        if (isDigitLine(lines[k])) {
          const fixed = fixOcrInDigitRun(lines[k]);
          const digits = fixed.replace(/\D/g, '');
          if (digits.length >= 44) {
            for (let j = 0; j <= digits.length - 44; j += 1) {
              candidates.push(digits.slice(j, j + 44));
            }
          }
        }
      }
    }
  }

  // NÃO faz sliding window no texto inteiro — causa falsos positivos
  return [...new Set(candidates)];
};
const validateAccessKey = (key) => {
  const normalized = String(key || '').replace(/\D/g, '');
  if (normalized.length !== 44) return false;
  if (normalized.slice(20, 22) !== '65') return false;
  const base = normalized.slice(0, 43).split('').reverse();
  let weight = 2;
  const sum = base.reduce((acc, digit) => {
    const next = acc + Number(digit) * weight;
    weight = weight === 9 ? 2 : weight + 1;
    return next;
  }, 0);
  const mod = sum % 11;
  const dv = mod < 2 ? 0 : 11 - mod;
  return dv === Number(normalized[43]);
};
const loadImageFromDataUrl = (dataUrl) => new Promise((resolve, reject) => { const image = new Image(); image.onload = () => resolve(image); image.onerror = () => reject(new Error('Falha ao carregar imagem para leitura do QR Code.')); image.src = dataUrl; });
const detectQrWithQrScanner = async (variants) => {
  for (const variant of variants) {
    try {
      const result = await QrScanner.scanImage(variant, { returnDetailedScanResult: true });
      if (result?.data) {
        return {
          rawValue: result.data,
          boundingBox: result.cornerPoints?.length ? {
            x: Math.min(...result.cornerPoints.map((point) => point.x)),
            y: Math.min(...result.cornerPoints.map((point) => point.y)),
            width: Math.max(...result.cornerPoints.map((point) => point.x)) - Math.min(...result.cornerPoints.map((point) => point.x)),
            height: Math.max(...result.cornerPoints.map((point) => point.y)) - Math.min(...result.cornerPoints.map((point) => point.y))
          } : null
        };
      }
    } catch {}
  }
  return { rawValue: '', boundingBox: null };
};
const detectQrDataFromDataUrl = async (dataUrl) => {
  if (!dataUrl) return { rawValue: '', boundingBox: null };
  try {
    const image = await loadImageFromDataUrl(dataUrl);
    const variants = [
      image,
      createImageCanvas(image, { x: 0, y: image.height * 0.58, width: image.width, height: image.height * 0.42 }, 1.8),
      createImageCanvas(image, { x: image.width * 0.45, y: image.height * 0.58, width: image.width * 0.55, height: image.height * 0.42 }, 2.2),
      createImageCanvas(image, { x: 0, y: image.height * 0.5, width: image.width, height: image.height * 0.5 }, 2, 'grayscale(1) contrast(1.6) brightness(1.05)')
    ];
    const qrScannerResult = await detectQrWithQrScanner(variants);
    if (qrScannerResult.rawValue) return qrScannerResult;
    if (typeof BarcodeDetector !== 'undefined') {
      const detector = new BarcodeDetector({ formats: ['qr_code'] });
      for (const variant of variants) {
        const codes = await detector.detect(variant);
        if (codes?.[0]?.rawValue) return { rawValue: codes[0].rawValue || '', boundingBox: codes[0].boundingBox || null };
      }
    }
    return { rawValue: '', boundingBox: null };
  } catch {
    return { rawValue: '', boundingBox: null };
  }
};
const buildProcessedCrop = async (dataUrl, crop = null) => {
  const image = await loadImageFromDataUrl(dataUrl);
  const sx = Math.max(0, crop?.x || 0);
  const sy = Math.max(0, crop?.y || 0);
  const sw = Math.max(1, Math.min(image.width - sx, crop?.width || image.width));
  const sh = Math.max(1, Math.min(image.height - sy, crop?.height || image.height));
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  canvas.width = sw * 2;
  canvas.height = sh * 2;
  context.filter = 'grayscale(1) contrast(1.55) brightness(1.08)';
  context.drawImage(image, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  for (let index = 0; index < imageData.data.length; index += 4) {
    const value = imageData.data[index] > 155 ? 255 : 0;
    imageData.data[index] = value;
    imageData.data[index + 1] = value;
    imageData.data[index + 2] = value;
  }
  context.putImageData(imageData, 0, 0);
  return canvas.toDataURL('image/png');
};
const buildSoftCrop = async (dataUrl, crop, scaleFactor = 3) => {
  const image = await loadImageFromDataUrl(dataUrl);
  const sx = Math.max(0, crop?.x || 0);
  const sy = Math.max(0, crop?.y || 0);
  const sw = Math.max(1, Math.min(image.width - sx, crop?.width || image.width));
  const sh = Math.max(1, Math.min(image.height - sy, crop?.height || image.height));
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  canvas.width = sw * scaleFactor;
  canvas.height = sh * scaleFactor;
  // Grayscale + alto contraste, SEM threshold duro (preserva dígitos pequenos)
  context.filter = 'grayscale(1) contrast(2.0) brightness(1.1)';
  context.drawImage(image, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/png');
};
const buildOcrVariants = async (dataUrl, qrBox = null) => {
  const image = await loadImageFromDataUrl(dataUrl);
  const variants = [
    { label: 'full', crop: null },
    { label: 'header', crop: { x: 0, y: 0, width: image.width, height: image.height * 0.28 } },
    { label: 'footer', crop: { x: 0, y: image.height * 0.62, width: image.width, height: image.height * 0.38 } },
    { label: 'access-key-zone', crop: { x: 0, y: image.height * 0.72, width: image.width, height: image.height * 0.18 } }
  ];
  if (qrBox) {
    variants.push({
      label: 'qr-zone',
      crop: {
        x: Math.max(0, qrBox.x - (qrBox.width * 0.8)),
        y: Math.max(0, qrBox.y - (qrBox.height * 0.8)),
        width: Math.min(image.width, qrBox.width * 2.6),
        height: Math.min(image.height, qrBox.height * 2.6)
      }
    });
  }
  const rendered = [];
  for (const variant of variants) {
    rendered.push({ label: variant.label, dataUrl: await buildProcessedCrop(dataUrl, variant.crop) });
  }
  // Variante dedicada para zona da chave: 55-80% da altura, upscale 3x, SEM threshold duro
  rendered.push({ label: 'chave-soft-3x', dataUrl: await buildSoftCrop(dataUrl, { x: 0, y: image.height * 0.55, width: image.width, height: image.height * 0.25 }, 3) });
  return rendered;
};
const extractChaveFromUrl = (url) => {
  const text = String(url || '');
  const matchChNFe = text.match(/[?&](?:chNFe|p)=(\d{44})/i);
  if (matchChNFe && validateAccessKey(matchChNFe[1])) return matchChNFe[1];
  const matchPath = text.match(/\/(\d{44})(?:[/?&#]|$)/);
  if (matchPath && validateAccessKey(matchPath[1])) return matchPath[1];
  const matchP = text.match(/[?&]p=([^&]+)/i);
  if (matchP) {
    const digits = decodeURIComponent(matchP[1]).replace(/\D/g, '');
    if (digits.length >= 44 && validateAccessKey(digits.slice(0, 44))) return digits.slice(0, 44);
  }
  return '';
};
const chooseBestAccessKey = ({ ocrText, qrRawValue }) => {
  console.log('[chooseBestAccessKey] qrRawValue:', qrRawValue ? qrRawValue.slice(0, 120) : '(vazio)');

  // 1. Tenta extrair chave da URL do QR Code
  if (qrRawValue) {
    const urlKey = extractChaveFromUrl(qrRawValue);
    if (urlKey) {
      console.log('[chooseBestAccessKey] Chave extraida da URL do QR:', urlKey);
      return { key: urlKey, source: 'QR Code (URL)', valid: true, candidates: [urlKey] };
    }
  }

  // 2. Tenta candidatas do QR (sequencias de 44 digitos)
  const qrRawCandidates = extractAccessKeyCandidates(qrRawValue);
  const qrCandidates = qrRawCandidates.filter(validateAccessKey);
  console.log('[chooseBestAccessKey] QR candidatas:', qrRawCandidates.length, 'validas:', qrCandidates.length);
  if (qrCandidates.length) return { key: qrCandidates[0], source: 'QR Code', valid: true, candidates: qrRawCandidates };

  // 3. Tenta candidatas do OCR
  const ocrRawCandidates = extractAccessKeyCandidates(ocrText);
  const ocrCandidates = ocrRawCandidates.filter(validateAccessKey);
  console.log('[chooseBestAccessKey] OCR candidatas:', ocrRawCandidates.length, 'validas:', ocrCandidates.length);

  if (ocrCandidates.length) {
    // Prioriza chave encontrada perto do rótulo "Chave de Acesso"
    const lines = String(ocrText || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    for (let i = 0; i < lines.length; i += 1) {
      if (/chave\s+de\s+acesso/i.test(lines[i])) {
        const window = lines.slice(i, i + 5).join(' ');
        const windowDigits = window.replace(/\D/g, '');
        const contextKey = ocrCandidates.find((k) => windowDigits.includes(k));
        if (contextKey) {
          console.log('[chooseBestAccessKey] Chave contextual (perto de "Chave de Acesso"):', contextKey);
          return { key: contextKey, source: 'OCR', valid: true, candidates: ocrRawCandidates };
        }
      }
    }
    return { key: ocrCandidates[0], source: 'OCR', valid: true, candidates: ocrRawCandidates };
  }

  // 4. Fallback: apenas candidatas que parecem NFC-e (posição 20-21 = "65")
  // Nunca retorna sequências aleatórias de dígitos como chave
  const looksLikeNfce = (k) => String(k).length === 44 && String(k).slice(20, 22) === '65';
  const allCandidates = [...new Set([...qrRawCandidates, ...ocrRawCandidates])];
  const nfceCandidates = allCandidates.filter(looksLikeNfce);

  if (nfceCandidates.length) {
    console.log('[chooseBestAccessKey] Candidata com modelo 65 (sem checksum):', nfceCandidates[0]);
    return { key: nfceCandidates[0], source: 'OCR (modelo 65)', valid: false, candidates: nfceCandidates };
  }

  console.log('[chooseBestAccessKey] Nenhuma chave NFC-e encontrada (0 candidatas com modelo 65)');
  return { key: '', source: '', valid: false, candidates: [] };
};
const fileToDataUrl = (file) => new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error('Falha ao ler o arquivo.')); reader.readAsDataURL(file); });
const renderPdfFirstPage = async (file) => {
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  const page = await pdf.getPage(1);
  const viewport = page.getViewport({ scale: 2 });
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  await page.render({ canvasContext: context, viewport }).promise;
  const dataUrl = canvas.toDataURL('image/png');
  return { dataUrl, blob: await (await fetch(dataUrl)).blob() };
};
const screens = [
  ['dashboard', 'Dashboard', 'Visao geral'],
  ['cycle', 'Ciclo de compras', 'Visao geral'],
  ['timeline', 'Linha do tempo', 'Visao geral'],
  ['items', 'Itens', 'Estoque'],
  ['entry', 'Entrada', 'Estoque'],
  ['output', 'Saida', 'Estoque'],
  ['extra', 'Reposicao avulsa', 'Estoque'],
  ['history', 'Historico', 'Estoque'],
  ['prices', 'Precos', 'Analise'],
  ['duration', 'Duracao', 'Analise'],
  ['receipts', 'Comprovantes', 'Administracao'],
  ['suppliers', 'Fornecedores', 'Administracao'],
  ['settings', 'Configuracoes', 'Administracao']
];

function App() {
  const [state, setState] = useState(() => { try { const stored = localStorage.getItem(STORAGE_KEY); return stored ? hydrateState(JSON.parse(stored)) : initialState; } catch { localStorage.removeItem(STORAGE_KEY); return initialState; } });
  const [screen, setScreen] = useState('dashboard');
  const [flash, setFlash] = useState(null);
  const [historyFilter, setHistoryFilter] = useState('');
  const [priceFilter, setPriceFilter] = useState('');
  const [receiptPassword, setReceiptPassword] = useState('');
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [reader, setReader] = useState({ loading: false, error: '', fileName: '', fileDataUrl: '', fileMimeType: '', preview: '', parsed: null, draftItems: [], supplierId: '', accessKey: '', queryUrl: '' });
  const timer = useRef(null);

  useEffect(() => { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }, [state]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const itemsById = useMemo(() => Object.fromEntries(state.items.map((item) => [item.id, item])), [state.items]);

  const suppliersById = useMemo(() => Object.fromEntries(state.suppliers.map((supplier) => [supplier.id, supplier])), [state.suppliers]);
  const priceMap = useMemo(() => state.priceHistory.reduce((acc, entry) => {
    if (!acc[entry.itemId]) acc[entry.itemId] = [];
    acc[entry.itemId].push(entry);
        acc[entry.itemId].sort((a, b) => new Date(`${a.date}T12:00:00`) - new Date(`${b.date}T12:00:00`));
    return acc;
  }, {}), [state.priceHistory]);
  const nextPurchaseDate = useMemo(() => addDays(state.cycle.lastPurchaseDate, Number(state.cycle.intervalDays || 60)), [state.cycle.lastPurchaseDate, state.cycle.intervalDays]);
  const daysUntilNextPurchase = Math.max(0, diffDays(nextPurchaseDate, new Date()));
  const durationForItem = (item) => {
    const weekly = Number(item?.weeklyConsumption || 0);
    const quantity = Number(item?.quantity || 0);
    if (!weekly) return Number.POSITIVE_INFINITY;
    return Math.max(0, Math.ceil((quantity / weekly) * 7));
  };
  const lowStockItems = useMemo(() => state.items.filter((item) => Number(item.quantity || 0) <= Number(item.minStock || 0)), [state.items]);
  const vulnerableItems = useMemo(() => state.items.filter((item) => durationForItem(item) < daysUntilNextPurchase), [state.items, daysUntilNextPurchase]);

  const showFlash = (message, tone = 'success') => { setFlash({ message, tone }); clearTimeout(timer.current); timer.current = setTimeout(() => setFlash(null), 3200); };

  const appendState = (updater, successMessage) => { setState((current) => updater(current)); if (successMessage) showFlash(successMessage); };

  const addItem = (payload) => appendState((current) => ({ ...current, items: [...current.items, { id: current.counters.item, ...payload }], counters: { ...current.counters, item: current.counters.item + 1 } }), 'Item cadastrado.');

  const registerMovement = (payload) => {
    const item = itemsById[payload.itemId];
    if (payload.type === 'saida' && payload.quantity > item.quantity) return showFlash('Quantidade maior que o estoque atual.', 'error');
    appendState((current) => ({
      ...current,
      items: current.items.map((entry) => entry.id === payload.itemId ? { ...entry, quantity: Number((entry.quantity + (payload.type === 'saida' ? -payload.quantity : payload.quantity)).toFixed(2)) } : entry),
      movements: [...current.movements, { id: current.counters.movement, ...payload }],
      counters: { ...current.counters, movement: current.counters.movement + 1 }
    }), `${payload.type === 'entrada' ? 'Entrada' : 'Saida'} registrada.`);
  };

  const registerExtra = (payload) => appendState((current) => {
    const supplierName = current.suppliers.find((supplier) => supplier.id === Number(payload.supplierId))?.name || payload.location || '';
    return {
      ...current,
      items: current.items.map((entry) => entry.id === payload.itemId ? { ...entry, quantity: Number((entry.quantity + payload.quantity).toFixed(2)) } : entry),
      extraPurchases: [...current.extraPurchases, { id: current.counters.extraPurchase, ...payload, location: supplierName }],
      movements: [...current.movements, { id: current.counters.movement, type: 'avulso', itemId: payload.itemId, quantity: payload.quantity, date: payload.date, notes: `Reposicao avulsa: ${payload.reason}` }],
      counters: { ...current.counters, extraPurchase: current.counters.extraPurchase + 1, movement: current.counters.movement + 1 }
    };
  }, 'Reposicao avulsa registrada.');

  const addPrice = (payload) => appendState((current) => ({ ...current, priceHistory: [...current.priceHistory, { id: current.counters.price, ...payload, market: current.suppliers.find((supplier) => supplier.id === Number(payload.supplierId))?.name || payload.market || 'Fornecedor nao informado' }], counters: { ...current.counters, price: current.counters.price + 1 } }), 'Preco registrado.');
  const addReceipt = (payload) => appendState((current) => ({ ...current, receipts: [...current.receipts, { id: current.counters.receipt, ...payload }], counters: { ...current.counters, receipt: current.counters.receipt + 1 } }), 'Comprovante salvo.');
  const addSupplier = (payload) => appendState((current) => ({ ...current, suppliers: [...current.suppliers, { id: current.counters.supplier, ...payload }], counters: { ...current.counters, supplier: current.counters.supplier + 1 } }), 'Fornecedor cadastrado.');
  const updateSupplier = (supplierId, payload) => appendState((current) => ({
    ...current,
    suppliers: current.suppliers.map((supplier) => supplier.id === supplierId ? { ...supplier, ...payload } : supplier),
    priceHistory: current.priceHistory.map((entry) => entry.supplierId === supplierId ? { ...entry, market: payload.name || entry.market } : entry),
    extraPurchases: current.extraPurchases.map((entry) => entry.supplierId === supplierId ? { ...entry, location: payload.name || entry.location } : entry)
  }), 'Fornecedor atualizado.');
  const deleteSupplier = (supplierId) => {
    const usageCount = state.priceHistory.filter((entry) => entry.supplierId === supplierId).length + state.extraPurchases.filter((entry) => entry.supplierId === supplierId).length;
    if (usageCount) return showFlash('Este fornecedor ja possui historico vinculado e nao pode ser excluido.', 'error');
    appendState((current) => ({ ...current, suppliers: current.suppliers.filter((supplier) => supplier.id !== supplierId) }), 'Fornecedor excluido.');
  };
  const updateCycle = (payload) => appendState((current) => ({ ...current, cycle: payload }), 'Ciclo atualizado.');
  const saveSettings = (payload) => appendState((current) => ({ ...current, settings: { ...current.settings, ...payload } }), 'Configuracoes salvas.');
  const updateConsumption = (itemId, weeklyConsumption) => setState((current) => ({ ...current, items: current.items.map((item) => item.id === itemId ? { ...item, weeklyConsumption } : item) }));

  const analyzeReceipt = async (file) => {
    let previewDataUrl = '';
    let sourceForOcr = file;
    let fileDataUrl = '';
    const lowerName = file.name.toLowerCase();
    const isXml = file.type.includes('xml') || lowerName.endsWith('.xml');
    const fileMimeType = file.type || (lowerName.endsWith('.pdf') ? 'application/pdf' : isXml ? 'application/xml' : 'image/*');
    setReader({ loading: true, error: '', fileName: file.name, fileDataUrl: '', fileMimeType: '', preview: '', parsed: null, draftItems: [], supplierId: '', accessKey: '', queryUrl: '' });
    let worker;
    try {
      fileDataUrl = String(await fileToDataUrl(file));
      if (isXml) {
        const parsed = parseFiscalXml(await readFileAsText(file), state.items);
        setReader({ loading: false, error: '', fileName: file.name, fileDataUrl, fileMimeType, preview: '', parsed, draftItems: parsed.items || [], supplierId: '', accessKey: parsed.accessKey || '', queryUrl: parsed.queryUrl || '' });
        showFlash('XML fiscal importado com sucesso.');
        return;
      }
      if (file.type === 'application/pdf' || lowerName.endsWith('.pdf')) {
        let backendPdfResult = null;
        try {
          backendPdfResult = await detectAccessKeyWithBackend(file);
        } catch (_backendError) {
          backendPdfResult = null;
        }
        if (backendPdfResult?.parsedReceipt?.items?.length) {
          const parsedPdf = { ...backendPdfResult.parsedReceipt, sourceMode: 'pdf-texto' };
          const draftItems = consolidateDraftItems(parsedPdf.items, state.items);
          const supplierMatch = findExistingSupplier(parsedPdf.mercado, state.suppliers);
          setReader({ loading: false, error: '', fileName: file.name, fileDataUrl, fileMimeType, preview: '', parsed: { ...parsedPdf, items: draftItems }, draftItems, supplierId: supplierMatch?.id ? String(supplierMatch.id) : '', accessKey: parsedPdf.accessKey || backendPdfResult.chaveAcesso || '', queryUrl: parsedPdf.queryUrl || '' });
          showFlash(parsedPdf.accessKey ? 'PDF textual importado com chave e itens.' : 'PDF textual importado. Confira a chave antes de importar.', parsedPdf.accessKey ? 'success' : 'warn');
          return;
        }
        const pdfText = await extractPdfTextFromFile(file);
        const parsedPdf = parseNativePdfReceiptText(pdfText, state.items);
        if (parsedPdf.items?.length) {
          const draftItems = consolidateDraftItems(parsedPdf.items, state.items);
          const supplierMatch = findExistingSupplier(parsedPdf.mercado, state.suppliers);
          setReader({ loading: false, error: '', fileName: file.name, fileDataUrl, fileMimeType, preview: '', parsed: { ...parsedPdf, items: draftItems }, draftItems, supplierId: supplierMatch?.id ? String(supplierMatch.id) : '', accessKey: parsedPdf.accessKey || '', queryUrl: parsedPdf.queryUrl || '' });
          showFlash(parsedPdf.accessKey ? 'PDF textual importado com chave e itens.' : 'PDF textual importado. Confira a chave antes de importar.', parsedPdf.accessKey ? 'success' : 'warn');
          return;
        }
        const rendered = await renderPdfFirstPage(file);
        previewDataUrl = rendered.dataUrl;
        sourceForOcr = rendered.blob;
      } else {
        previewDataUrl = fileDataUrl;
      }
      const qrData = await detectQrDataFromDataUrl(previewDataUrl || fileDataUrl);
      let backendKeyResult = null;
      let backendWarning = '';
      try {
        backendKeyResult = await detectAccessKeyWithBackend(file);
        console.log('[Entrada] Backend respondeu:', JSON.stringify({ chaveAcesso: backendKeyResult?.chaveAcesso, fonte: backendKeyResult?.fonte, candidatas: backendKeyResult?.candidatas?.length, backendOk: backendKeyResult?.backendOk }));
      } catch (backendError) {
        backendWarning = backendError.message || 'Falha ao consultar o backend da NFC-e.';
        console.warn('[Entrada] Backend falhou:', backendWarning);
      }
      const variants = await buildOcrVariants(previewDataUrl || fileDataUrl, qrData.boundingBox);
      worker = await createWorker('por');
      const ocrTexts = [];
      for (const variant of variants) {
        const result = await worker.recognize(variant.dataUrl);
        const variantText = result.data.text || '';
        ocrTexts.push(variantText);
        // Log das variantes que contêm dígitos relevantes
        const variantDigits = variantText.replace(/\D/g, '');
        if (variantDigits.length >= 44) {
          console.log(`[OCR] ${variant.label}: ${variantText.length} chars, ${variantDigits.length} digitos`);
          if (/chave|acesso|consulte|sefaz/i.test(variantText)) {
            console.log(`[OCR] ${variant.label}: contem contexto de chave!`);
          }
        }
      }
      const combinedOcrText = ocrTexts.join('\n');
      console.log('[OCR] Texto combinado:', combinedOcrText.length, 'chars,', combinedOcrText.replace(/\D/g, '').length, 'digitos');
      console.log('[Entrada] QR detectado:', qrData.rawValue ? 'Sim (' + qrData.rawValue.slice(0, 80) + '...)' : 'Nao');
      const bestKey = chooseBestAccessKey({ ocrText: combinedOcrText, qrRawValue: qrData.rawValue });
      const resolvedAccessKey = backendKeyResult?.chaveAcesso || backendKeyResult?.bestEffortKey || backendKeyResult?.candidatas?.[0] || bestKey.key;
      console.log('[Entrada] Chave resolvida:', resolvedAccessKey || '(nenhuma)', '| Fonte:', backendKeyResult?.fonte || bestKey.source || '(nenhuma)');
      const resolvedAccessKeySource = backendKeyResult?.fonte ? backendSourceLabel(backendKeyResult.fonte) : bestKey.source;
      const resolvedAccessKeyValid = backendKeyResult?.validada !== undefined ? backendKeyResult.validada : (backendKeyResult?.chaveAcesso ? true : bestKey.valid);
      const resolvedAccessKeyCandidates = [...new Set([...(backendKeyResult?.candidatas || []), ...(bestKey.candidates || [])])];
      const parsed = { ...parseReceiptText(combinedOcrText, state.items), accessKey: resolvedAccessKey, accessKeySource: resolvedAccessKeySource, accessKeyValid: resolvedAccessKeyValid, accessKeyCandidates: resolvedAccessKeyCandidates, queryUrl: qrData.rawValue.startsWith('http') ? qrData.rawValue : '', sourceMode: 'ocr', backendWarning };
      const draftItems = (parsed.items || []).map((entry, index) => ({
        id: index + 1,
        include: true,
        nome: entry.nome || '',
        quantidade: Number(entry.quantidade || 0),
        unidade: entry.unidade || 'un',
        preco_unitario: Number(entry.preco_unitario || 0),
        item_cadastrado: entry.item_cadastrado || null,
        matchedItemId: entry.matchedItemId || '',
        confidence: Number(entry.confidence || 0.3),
        rawLine: entry.rawLine || ''
      }));
      if (!draftItems.length) throw new Error('Nao foi possivel identificar itens com confianca. Tente uma foto mais nitida, reta e com melhor iluminacao.');
      setReader({ loading: false, error: '', fileName: file.name, fileDataUrl, fileMimeType, preview: previewDataUrl, parsed, draftItems, supplierId: '', accessKey: parsed.accessKey || '', queryUrl: parsed.queryUrl || '' });
      showFlash(parsed.accessKey ? ('Chave sugerida via ' + (parsed.accessKeySource || 'OCR local') + (parsed.accessKeyValid ? '.' : ' (confira antes de importar).')) : (backendWarning || 'Comprovante lido, mas a chave precisa de conferencia manual.'), parsed.accessKey ? (parsed.accessKeyValid ? 'success' : 'warn') : 'error');
    } catch (error) {
      setReader((current) => ({ ...current, loading: false, error: error.message || 'Falha ao processar comprovante.', parsed: null, draftItems: [] }));
      showFlash('Falha na leitura do comprovante.', 'error');
    } finally {
      if (worker) await worker.terminate();
    }
  };


  const confirmReaderImport = () => {
    if (!reader.draftItems?.length) return;
    appendState((current) => {
      const next = structuredClone(current);
      const market = next.suppliers.find((supplier) => supplier.id === Number(reader.supplierId || 0))?.name || reader.parsed.mercado || 'Mercado nao identificado';
      const date = reader.parsed.data || todayString();
      const importedAt = timestampString();
      const importedItems = reader.draftItems.filter((entry) => entry.include && entry.nome);
      const importedTotal = importedItems.reduce((sum, entry) => sum + computeLineTotal(entry.quantidade, entry.preco_unitario, entry.unidade), 0);
      importedItems.forEach((entry) => {
        const matchName = slug(entry.item_cadastrado || entry.nome);
        let item = next.items.find((candidate) => slug(candidate.name) === matchName);
        if (!item) { item = { id: next.counters.item, name: entry.nome, unit: entry.unidade || 'un', quantity: 0, minStock: 1, weeklyConsumption: 0 }; next.items.push(item); next.counters.item += 1; }
        item.quantity = Number((item.quantity + Number(entry.quantidade || 0)).toFixed(2));
        next.movements.push({ id: next.counters.movement, type: 'entrada', itemId: item.id, quantity: Number(entry.quantidade || 0), date, notes: `NF - ${market}` });
        next.counters.movement += 1;
        if (entry.preco_unitario) { next.priceHistory.push({ id: next.counters.price, itemId: item.id, supplierId: Number(reader.supplierId || 0) || undefined, market, price: Number(entry.preco_unitario), date }); next.counters.price += 1; }
      });
      next.receipts.push({
        id: next.counters.receipt,
        title: `Cupom ${market}`,
        value: Number(reader.parsed?.total || importedTotal || 0),
        date,
        importedAt,
        notes: `Importado pelo modulo de entrada com ${importedItems.length} item(ns).`,
        supplierId: Number(reader.supplierId || 0) || undefined,
        fileName: reader.fileName || `comprovante-${date}`,
        mimeType: reader.fileMimeType || '',
        dataUrl: reader.fileDataUrl || '',
        preview: reader.preview || '',
        accessKey: reader.accessKey || reader.parsed?.accessKey || '',
        queryUrl: reader.queryUrl || reader.parsed?.queryUrl || '',
        source: reader.parsed?.sourceMode === 'xml' ? 'xml-fiscal' : reader.parsed?.sourceMode === 'pdf-texto' ? 'pdf-texto' : 'entrada-ocr'
      });
      next.counters.receipt += 1;
      return next;
    }, 'Itens importados do comprovante.');
    setReader({ loading: false, error: '', fileName: '', fileDataUrl: '', fileMimeType: '', preview: '', parsed: null, draftItems: [], supplierId: '', accessKey: '', queryUrl: '' });
  };

  const cycleProgress = Math.max(0, Math.min(100, (diffDays(new Date(), new Date(`${state.cycle.lastPurchaseDate}T00:00:00`)) / Number(state.cycle.intervalDays || 1)) * 100));
  const groups = ['Visao geral', 'Estoque', 'Analise', 'Administracao'];

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-kicker">Reserva Fiscal</span><h1>Controle de Limpeza</h1><p className="brand-subtitle">Inteligencia tributaria aplicada a operacao interna</p></div>
        {groups.map((group) => <div className="nav-group" key={group}><span className="nav-label">{group}</span>{screens.filter((screenItem) => screenItem[2] === group).map(([id, label]) => <button key={id} className={`nav-item ${screen === id ? 'active' : ''}`} onClick={() => setScreen(id)}><span>{label}</span>{id === 'dashboard' && lowStockItems.length > 0 ? <span className="nav-pill">{lowStockItems.length}</span> : null}</button>)}</div>)}
      </aside>
      <main className="main">
        <header className="topbar"><div><p className="eyebrow">Reserva Fiscal � Setor de limpeza</p><h2>{screens.find((screenItem) => screenItem[0] === screen)?.[1]}</h2><p className="subtle">{state.items.length} itens cadastrados, proxima compra em {formatDate(nextPurchaseDate.toISOString().split('T')[0])}</p></div>{flash ? <div className={`flash ${flash.tone}`}>{flash.message}</div> : null}</header>

        {screen === 'dashboard' ? <><div className="metrics"><MetricCard label="Itens ativos" value={state.items.length} /><MetricCard label="Abaixo do minimo" value={lowStockItems.length} tone={lowStockItems.length ? 'danger' : 'success'} /><MetricCard label="Nao chegam ate a compra" value={vulnerableItems.length} tone={vulnerableItems.length ? 'warn' : 'success'} /><MetricCard label="Custo extra no ciclo" value={currency(state.extraPurchases.reduce((sum, entry) => sum + entry.cost, 0))} tone="warn" /></div><div className="panel-grid"><section className="panel"><div className="panel-head"><div><h3>Alertas automaticos</h3><p>Compra geral prevista para {formatDate(nextPurchaseDate.toISOString().split('T')[0])}</p></div><Badge tone={daysUntilNextPurchase <= 7 ? 'danger' : 'info'}>{daysUntilNextPurchase} dias restantes</Badge></div>{!lowStockItems.length && !vulnerableItems.length ? <EmptyState text="Nenhum alerta no momento." /> : <div className="stack">{lowStockItems.map((item) => <AlertCard key={`low-${item.id}`} tone="danger" title={`${item.name} abaixo do estoque minimo`} text={`Atual ${item.quantity} ${item.unit}. Minimo ${item.minStock} ${item.unit}.`} />)}{vulnerableItems.map((item) => <AlertCard key={`vul-${item.id}`} tone="warn" title={`${item.name} nao chega ate a proxima compra`} text={`Duracao estimada: ${durationForItem(item)} dias.`} />)}</div>}</section><section className="panel"><div className="panel-head"><div><h3>Ultimas movimentacoes</h3><p>Entradas, saidas e reposicoes avulsas</p></div></div><div className="stack">{[...state.movements].slice(-6).reverse().map((entry) => <div className="history-row" key={entry.id}><span className={`dot ${entry.type}`}></span><div className="history-main"><strong>{entry.type === 'entrada' ? '+' : '-'}{entry.quantity}</strong> {itemsById[entry.itemId]?.name || 'Item removido'} <span className="sub-note">{entry.notes}</span></div><span className="mono">{formatDate(entry.date)}</span></div>)}</div></section></div></> : null}

        {screen === 'cycle' ? <><section className={`panel cycle-banner ${daysUntilNextPurchase <= 7 ? 'danger' : daysUntilNextPurchase <= 20 ? 'warn' : 'success'}`}><div><p className="eyebrow">Proxima compra geral</p><h3>{daysUntilNextPurchase} dias</h3><p>Data prevista: {formatDate(nextPurchaseDate.toISOString().split('T')[0])}</p></div><div className="cycle-meter"><div className="progress"><span style={{ width: `${cycleProgress}%` }}></span></div><p>Custo extra no ciclo atual: {currency(state.extraPurchases.filter((entry) => new Date(`${entry.date}T00:00:00`) >= new Date(`${state.cycle.lastPurchaseDate}T00:00:00`)).reduce((sum, entry) => sum + entry.cost, 0))}</p></div></section><section className="panel"><div className="panel-head"><div><h3>Itens vs proxima compra</h3><p>Quais itens aguentam ate o fechamento do ciclo</p></div></div><div className="table-wrap"><table><thead><tr><th>Item</th><th>Estoque</th><th>Esgota em</th><th>Dias restantes</th><th>Situacao</th></tr></thead><tbody>{state.items.map((item) => { const days = durationForItem(item); return <tr key={item.id}><td>{item.name}</td><td>{item.quantity} {item.unit}</td><td>{Number.isFinite(days) ? `${days} dias` : 'Sem consumo'}</td><td>{daysUntilNextPurchase}</td><td><Badge tone={days >= daysUntilNextPurchase ? 'success' : 'warn'}>{days >= daysUntilNextPurchase ? 'Aguenta o ciclo' : 'Precisa repor'}</Badge></td></tr>; })}</tbody></table></div></section></> : null}

        {screen === 'timeline' ? <section className="panel"><div className="panel-head"><div><h3>Linha do tempo cronologica</h3><p>Esgotamentos projetados, reposicoes avulsas e compra geral</p></div></div><div className="timeline">{state.items.map((item) => ({ id: `item-${item.id}`, date: addDays(todayString(), Number.isFinite(durationForItem(item)) ? durationForItem(item) : 3650).toISOString().split('T')[0], tone: durationForItem(item) <= 7 ? 'danger' : durationForItem(item) <= daysUntilNextPurchase ? 'warn' : 'success', title: `${item.name} deve acabar`, subtitle: `${item.quantity} ${item.unit} em estoque, consumo ${item.weeklyConsumption} ${item.unit}/semana` })).concat(state.extraPurchases.map((entry) => ({ id: `extra-${entry.id}`, date: entry.date, tone: 'info', title: `Reposicao avulsa de ${itemsById[entry.itemId]?.name || 'Item removido'}`, subtitle: `${entry.quantity} ${itemsById[entry.itemId]?.unit || ''} em ${suppliersById[entry.supplierId]?.name || entry.location || 'local nao informado'} por ${currency(entry.cost)}` }))).concat([{ id: 'cycle', date: nextPurchaseDate.toISOString().split('T')[0], tone: 'neutral', title: 'Proxima compra geral', subtitle: `Ciclo fixo de ${state.cycle.intervalDays} dias` }]).sort((a, b) => new Date(`${a.date}T00:00:00`) - new Date(`${b.date}T00:00:00`)).map((event) => <div className="timeline-item" key={event.id}><span className={`timeline-dot ${event.tone}`}></span><div><span className="mono">{formatDate(event.date)}</span><h4>{event.title}</h4><p>{event.subtitle}</p></div></div>)}</div></section> : null}

        {screen === 'items' ? <section className="panel"><div className="panel-head"><div><h3>Cadastro de itens</h3><p>Produtos monitorados no estoque do setor</p></div></div><div className="table-wrap"><table><thead><tr><th>Item</th><th>Unidade</th><th>Quantidade</th><th>Minimo</th><th>Consumo semanal</th></tr></thead><tbody>{state.items.map((item) => <tr key={item.id}><td>{item.name}</td><td>{item.unit}</td><td>{item.quantity}</td><td>{item.minStock}</td><td>{item.weeklyConsumption}</td></tr>)}</tbody></table></div></section> : null}
        {screen === 'entry' ? <><MovementForm title="Registrar entrada manual" items={state.items} onSubmit={(payload) => registerMovement({ ...payload, type: 'entrada' })} /><ReaderPanel state={reader} items={state.items} suppliers={state.suppliers} onAnalyze={analyzeReceipt} onConfirm={confirmReaderImport} onDraftChange={(draftItems) => setReader((current) => ({ ...current, draftItems }))} onSupplierChange={(supplierId) => setReader((current) => ({ ...current, supplierId }))} onAccessKeyChange={(accessKey) => setReader((current) => ({ ...current, accessKey }))} onReset={() => setReader({ loading: false, error: '', fileName: '', fileDataUrl: '', fileMimeType: '', preview: '', parsed: null, draftItems: [], supplierId: '', accessKey: '' })} /></> : null}
        {screen === 'output' ? <MovementForm title="Registrar saida" items={state.items} onSubmit={(payload) => registerMovement({ ...payload, type: 'saida' })} /> : null}
        {screen === 'extra' ? <ExtraForm items={state.items} entries={state.extraPurchases} onSubmit={registerExtra} itemsById={itemsById} suppliers={state.suppliers} suppliersById={suppliersById} /> : null}
        {screen === 'history' ? <section className="panel"><div className="panel-head"><div><h3>Historico completo</h3><p>Movimentacoes filtraveis por item</p></div><select value={historyFilter} onChange={(event) => setHistoryFilter(event.target.value)}><option value="">Todos os itens</option>{state.items.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div><div className="stack">{[...state.movements].reverse().filter((entry) => !historyFilter || String(entry.itemId) === historyFilter).map((entry) => <div className="history-row" key={entry.id}><span className={`dot ${entry.type}`}></span><div className="history-main"><strong>{entry.type === 'entrada' ? '+' : '-'}{entry.quantity} {itemsById[entry.itemId]?.unit || ''}</strong> {itemsById[entry.itemId]?.name || 'Item removido'} <span className="sub-note">{entry.notes}</span></div><span className="mono">{formatDate(entry.date)}</span></div>)}</div></section> : null}

        {screen === 'prices' ? <PricesPanel items={!priceFilter ? state.items : state.items.filter((item) => String(item.id) === priceFilter)} allItems={state.items} suppliers={state.suppliers} suppliersById={suppliersById} priceMap={priceMap} filter={priceFilter} onFilterChange={setPriceFilter} onSubmit={addPrice} /> : null}
        {screen === 'duration' ? <section><section className="panel"><div className="panel-head"><div><h3>Estimativa de duracao</h3><p>Baseada no consumo semanal configurado</p></div></div>{vulnerableItems.length ? <div className="stack">{vulnerableItems.map((item) => <AlertCard key={item.id} tone="warn" title={`${item.name} nao chega ate a proxima compra`} text={`Duracao estimada de ${durationForItem(item)} dias.`} />)}</div> : <EmptyState text="Todos os itens configurados aguentam ate a proxima compra." />}</section><section className="panel"><div className="stack">{state.items.map((item) => { const days = durationForItem(item); const tone = days <= 7 ? 'danger' : days <= 21 ? 'warn' : 'success'; const width = Number.isFinite(days) ? Math.min(100, (days / 60) * 100) : 100; return <div className="duration-card" key={item.id}><div className="panel-head"><div><h3>{item.name}</h3><p>{item.quantity} {item.unit} em estoque, {item.weeklyConsumption || 0} {item.unit}/semana</p></div><Badge tone={tone}>{Number.isFinite(days) ? `${days} dias` : 'Sem consumo configurado'}</Badge></div><div className="progress duration"><span className={tone} style={{ width: `${width}%` }}></span></div></div>; })}</div></section></section> : null}
        {screen === 'receipts' ? <ReceiptsPanel open={receiptOpen} password={receiptPassword} onPasswordChange={setReceiptPassword} onUnlock={() => { if (receiptPassword === state.settings.receiptPassword) { setReceiptOpen(true); setReceiptPassword(''); showFlash('Area de comprovantes liberada.'); } else { showFlash('Senha incorreta.', 'error'); } }} onLock={() => setReceiptOpen(false)} receipts={state.receipts} onAdd={addReceipt} suppliersById={suppliersById} /> : null}
        {screen === 'suppliers' ? <SuppliersPanel suppliers={state.suppliers} priceHistory={state.priceHistory} extraPurchases={state.extraPurchases} onSubmit={addSupplier} onUpdate={updateSupplier} onDelete={deleteSupplier} /> : null}
        {screen === 'settings' ? <SettingsPanel state={state} nextPurchaseDate={nextPurchaseDate} onSaveCycle={updateCycle} onSaveSettings={saveSettings} onUpdateConsumption={updateConsumption} /> : null}
        <section className="panel"><NewItemForm onSubmit={addItem} /></section>
      </main>
    </div>
  );
}

function MovementForm({ title, items, onSubmit }) { const [form, setForm] = useState({ itemId: String(items[0]?.id || ''), quantity: 1, date: todayString(), notes: '' }); return <section className="panel"><div className="panel-head"><div><h3>{title}</h3><p>Registro de movimentacao de estoque</p></div></div><form className="form-grid" onSubmit={(event) => { event.preventDefault(); onSubmit({ itemId: Number(form.itemId), quantity: Number(form.quantity), date: form.date, notes: form.notes }); setForm({ itemId: String(items[0]?.id || ''), quantity: 1, date: todayString(), notes: '' }); }}><Field label="Item"><select value={form.itemId} onChange={(event) => setForm({ ...form, itemId: event.target.value })}>{items.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field><Field label="Quantidade"><input type="number" min="0.01" step="0.01" value={form.quantity} onChange={(event) => setForm({ ...form, quantity: event.target.value })} /></Field><Field label="Data"><input type="date" value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} /></Field><Field label="Observacao"><input value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></Field><div className="actions-row"><button className="primary-button" type="submit">Salvar</button></div></form></section>; }
function ExtraForm({ items, entries, onSubmit, itemsById, suppliers, suppliersById }) { const [form, setForm] = useState({ itemId: String(items[0]?.id || ''), quantity: 1, date: todayString(), cost: '', reason: '', supplierId: String(suppliers[0]?.id || ''), location: '' }); return <><section className="panel"><div className="panel-head"><div><h3>Registrar reposicao avulsa</h3><p>Compras fora do ciclo fixo com custo e motivo</p></div></div><form className="form-grid" onSubmit={(event) => { event.preventDefault(); onSubmit({ itemId: Number(form.itemId), quantity: Number(form.quantity), date: form.date, cost: Number(form.cost || 0), reason: form.reason, supplierId: Number(form.supplierId), location: '' }); setForm({ itemId: String(items[0]?.id || ''), quantity: 1, date: todayString(), cost: '', reason: '', supplierId: String(suppliers[0]?.id || ''), location: '' }); }}><Field label="Item"><select value={form.itemId} onChange={(event) => setForm({ ...form, itemId: event.target.value })}>{items.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field><Field label="Quantidade"><input type="number" min="0.01" step="0.01" value={form.quantity} onChange={(event) => setForm({ ...form, quantity: event.target.value })} /></Field><Field label="Data"><input type="date" value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} /></Field><Field label="Custo"><input type="number" min="0" step="0.01" value={form.cost} onChange={(event) => setForm({ ...form, cost: event.target.value })} /></Field><Field label="Motivo"><input value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} /></Field><Field label="Fornecedor"><select value={form.supplierId} onChange={(event) => setForm({ ...form, supplierId: event.target.value })}>{suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></Field><div className="actions-row"><button className="primary-button" type="submit">Salvar reposicao</button></div></form></section><section className="panel"><div className="panel-head"><div><h3>Historico de reposicoes avulsas</h3><p>Compras fora do planejamento</p></div></div><div className="stack">{entries.map((entry) => <div className="entry-card" key={entry.id}><div><strong>{itemsById[entry.itemId]?.name || 'Item removido'}</strong><p>{entry.reason}</p></div><div className="entry-meta"><span>{entry.quantity} {itemsById[entry.itemId]?.unit || ''}</span><span>{currency(entry.cost)}</span><span>{formatDate(entry.date)}</span><span>{suppliersById[entry.supplierId]?.name || entry.location || 'Fornecedor nao informado'}</span></div></div>)}</div></section></>; }
function ReaderPanel({ state, items, suppliers, onAnalyze, onConfirm, onDraftChange, onSupplierChange, onAccessKeyChange, onReset }) {
  const updateDraftItem = (id, field, value) => {
    const next = (state.draftItems || []).map((entry) => {
      if (entry.id !== id) return entry;
      if (field === 'matchedItemId') {
        const matched = items.find((item) => item.id === Number(value));
        return { ...entry, matchedItemId: value, item_cadastrado: matched ? matched.name : null };
      }
      return { ...entry, [field]: value };
    });
    onDraftChange(next);
  };
  const removeDraftItem = (id) => onDraftChange((state.draftItems || []).filter((entry) => entry.id !== id));
  const importItems = (state.draftItems || []).filter((entry) => entry.include && entry.nome);
  const importCount = importItems.length;
  const importTotal = importItems.reduce((sum, entry) => sum + computeLineTotal(entry.quantidade, entry.preco_unitario, entry.unidade), 0);
  const receiptTotal = Number(state.parsed?.total || 0);
  const totalDiff = receiptTotal ? Math.abs(receiptTotal - importTotal) : 0;
  const modeLabel = state.parsed?.sourceMode === 'xml' ? 'XML fiscal' : state.parsed?.sourceMode === 'pdf-texto' ? 'PDF texto' : 'OCR de cupom';
  return <><section className="panel"><div className="panel-head"><div><h3>Entrada por XML, chave ou comprovante</h3><p>Use XML fiscal quando tiver o arquivo da NFC-e/NF-e. Para foto ou PDF, o sistema usa OCR como contingencia.</p></div>{state.preview || state.draftItems?.length || state.fileName ? <button className="ghost-button" onClick={onReset}>Limpar leitura</button> : null}</div><div className="actions-row" style={{ marginBottom: '12px' }}><button className="primary-button" type="button" onClick={() => window.open(TO_NFCE_CONSULT_URL, '_blank', 'noopener,noreferrer')} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>Consultar NF-e na SEFAZ-TO</button></div><label className={`dropzone ${state.loading ? 'loading' : ''}`}><input type="file" accept="image/*,.pdf,application/pdf,.xml,text/xml,application/xml" onChange={(event) => { const file = event.target.files?.[0]; if (file) onAnalyze(file); }} /><strong>{state.loading ? 'Processando documento fiscal...' : 'Selecionar XML, imagem ou PDF'}</strong><p>{state.fileName || 'XML fiscal e a opcao mais precisa. Imagem/PDF usa OCR.'}</p></label>{state.error ? <p className="error-text">{state.error}</p> : null}{state.preview ? <div className="preview-shell"><img className="preview" src={state.preview} alt="Preview do comprovante" /></div> : null}</section>{state.parsed ? <section className="panel"><div className="panel-head"><div><h3>Conferencia da entrada</h3><p>{state.parsed.mercado || 'Emitente nao identificado'} em {formatDate(state.parsed.data || todayString())} - origem {modeLabel}. Revise antes de importar.</p></div><div className="reader-summary"><Badge tone={state.parsed?.sourceMode === 'xml' ? 'success' : 'info'}>{modeLabel}</Badge><Badge tone="info">{importCount} item(ns)</Badge><Badge tone="neutral">Soma dos itens {currency(importTotal)}</Badge>{receiptTotal ? <Badge tone={totalDiff <= 0.5 ? 'success' : 'warn'}>Total do documento {currency(receiptTotal)}</Badge> : null}<button className="primary-button" onClick={onConfirm}>Importar entrada</button></div></div><div className="form-grid" style={{ marginBottom: '14px' }}><Field label="Fornecedor"><select value={state.supplierId || ''} onChange={(event) => onSupplierChange(event.target.value)}><option value="">Fornecedor nao informado</option>{suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></Field><Field label="Chave de acesso"><input value={state.accessKey || state.parsed?.accessKey || ''} onChange={(event) => onAccessKeyChange(event.target.value)} placeholder="Cole ou confirme a chave de acesso" /></Field></div><div className="reader-summary" style={{ marginBottom: '14px' }}>{state.parsed?.accessKeySource ? <Badge tone={state.parsed.accessKeyValid ? (state.parsed.accessKeySource === 'QR Code' ? 'success' : 'warn') : 'danger'}>Chave via {state.parsed.accessKeySource}{state.parsed.accessKeyValid ? '' : ' (nao validada)'}</Badge> : null}{!state.parsed?.accessKeyValid && state.parsed?.accessKeyCandidates?.length ? <Badge tone="neutral">Candidata: {state.parsed.accessKeyCandidates[0]}</Badge> : null}</div><div className="actions-row" style={{ marginBottom: '14px' }}>{state.queryUrl || state.parsed?.queryUrl ? <button className="ghost-button" type="button" onClick={() => window.open(state.queryUrl || state.parsed?.queryUrl, '_blank', 'noopener,noreferrer')}>Abrir consulta da NFC-e</button> : null}<button className="ghost-button" type="button" onClick={() => openToNfcePortalWithKey(state.accessKey || state.parsed?.accessKey || '')}>Consultar por chave na SEFAZ-TO</button></div>{receiptTotal ? <div className="total-audit"><strong>Diferenca entre total do documento e itens:</strong> <span className={totalDiff <= 0.5 ? 'audit-good' : 'audit-warn'}>{currency(totalDiff)}</span></div> : null}<div className="table-wrap"><table><thead><tr><th>Importar</th><th>Item lido</th><th>Vincular a item cadastrado</th><th>Qtd</th><th>Un</th><th>Valor unit.</th><th>Total linha</th><th>Confianca</th><th></th></tr></thead><tbody>{(state.draftItems || []).map((entry) => { const lineTotal = computeLineTotal(entry.quantidade, entry.preco_unitario, entry.unidade); return <tr key={entry.id}><td><input type="checkbox" checked={entry.include} onChange={(event) => updateDraftItem(entry.id, 'include', event.target.checked)} /></td><td><div className="ocr-cell"><input value={entry.nome} onChange={(event) => updateDraftItem(entry.id, 'nome', event.target.value)} />{entry.rawLine ? <small>{entry.rawLine}</small> : null}</div></td><td><select value={entry.matchedItemId || ''} onChange={(event) => updateDraftItem(entry.id, 'matchedItemId', event.target.value)}><option value="">Criar como novo item</option>{items.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></td><td><input type="number" min="0" step="0.01" value={entry.quantidade} onChange={(event) => updateDraftItem(entry.id, 'quantidade', Number(event.target.value))} /></td><td><select value={normalizeUnit(entry.unidade || 'un')} onChange={(event) => updateDraftItem(entry.id, 'unidade', event.target.value)}>{UNIT_OPTIONS.map((unit) => <option key={unit.value} value={unit.value}>{unit.value}</option>)}</select></td><td><input type="number" min="0" step="0.01" value={entry.preco_unitario} onChange={(event) => updateDraftItem(entry.id, 'preco_unitario', Number(event.target.value))} /></td><td>{currency(lineTotal)}</td><td><Badge tone={entry.confidence >= 0.95 ? 'success' : entry.confidence >= 0.5 ? 'warn' : 'danger'}>{Math.round(Number(entry.confidence || 0) * 100)}%</Badge></td><td><button className="table-action" onClick={() => removeDraftItem(entry.id)}>Excluir</button></td></tr>; })}</tbody></table></div></section> : null}</>;
}

function PricesPanel({ items, allItems, suppliers, suppliersById, priceMap, filter, onFilterChange, onSubmit }) { const [form, setForm] = useState({ itemId: String(allItems[0]?.id || ''), supplierId: String(suppliers[0]?.id || ''), price: '', date: todayString() }); return <><section className="panel"><div className="panel-head"><div><h3>Historico de precos</h3><p>Comparativo por item e por fornecedor</p></div><select value={filter} onChange={(event) => onFilterChange(event.target.value)}><option value="">Todos</option>{allItems.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div><div className="stack">{items.map((item) => { const entries = priceMap[item.id] || []; if (!entries.length) return <div className="entry-card" key={item.id}><div><strong>{item.name}</strong><p>Sem historico de precos.</p></div></div>; const latest = entries.at(-1); const previous = entries.length > 1 ? entries.at(-2) : null; const best = [...entries].sort((a, b) => a.price - b.price)[0]; const variation = previous ? ((latest.price - previous.price) / previous.price) * 100 : null; return <div className="entry-card" key={item.id}><div><strong>{item.name}</strong><p>Ultimo preco: {currency(latest.price)} em {suppliersById[latest.supplierId]?.name || latest.market}</p></div><div className="entry-meta">{variation !== null ? <Badge tone={variation > 0 ? 'warn' : variation < 0 ? 'success' : 'neutral'}>{variation > 0 ? 'Alta' : variation < 0 ? 'Queda' : 'Estavel'} {Math.abs(variation).toFixed(1)}%</Badge> : null}<Badge tone="success">Melhor fornecedor: {suppliersById[best.supplierId]?.name || best.market}</Badge></div></div>; })}</div></section><section className="panel"><div className="panel-head"><div><h3>Adicionar preco manual</h3><p>Entrada complementar alem do leitor automatico</p></div></div><form className="form-grid" onSubmit={(event) => { event.preventDefault(); onSubmit({ itemId: Number(form.itemId), supplierId: Number(form.supplierId), price: Number(form.price), date: form.date }); setForm({ itemId: String(allItems[0]?.id || ''), supplierId: String(suppliers[0]?.id || ''), price: '', date: todayString() }); }}><Field label="Item"><select value={form.itemId} onChange={(event) => setForm({ ...form, itemId: event.target.value })}>{allItems.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field><Field label="Fornecedor"><select value={form.supplierId} onChange={(event) => setForm({ ...form, supplierId: event.target.value })}>{suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></Field><Field label="Preco unitario"><input type="number" min="0" step="0.01" value={form.price} onChange={(event) => setForm({ ...form, price: event.target.value })} /></Field><Field label="Data"><input type="date" value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} /></Field><div className="actions-row"><button className="primary-button" type="submit">Salvar preco</button></div></form></section></>; }
function SuppliersPanel({ suppliers, priceHistory, extraPurchases, onSubmit, onUpdate, onDelete }) {
  const emptyForm = { id: null, name: '', tradeName: '', type: 'mercado', city: '', state: 'SP', cnpj: '', notes: '' };
  const [form, setForm] = useState(emptyForm);
  const supplierUsage = suppliers.reduce((acc, supplier) => {
    acc[supplier.id] = {
      prices: priceHistory.filter((entry) => entry.supplierId === supplier.id).length,
      extras: extraPurchases.filter((entry) => entry.supplierId === supplier.id).length
    };
    return acc;
  }, {});
  const isEditing = Boolean(form.id);
  const resetForm = () => setForm(emptyForm);
  return <><section className="panel"><div className="panel-head"><div><h3>{isEditing ? 'Editar fornecedor' : 'Cadastro de fornecedores'}</h3><p>Padronize os locais de compra para usar em reposicoes, precos e leitor de NF</p></div>{isEditing ? <button className="ghost-button" type="button" onClick={resetForm}>Cancelar</button> : null}</div><form className="form-grid" onSubmit={(event) => { event.preventDefault(); if (!form.name.trim()) return; const payload = { name: form.name.trim(), tradeName: form.tradeName.trim(), type: form.type, city: form.city.trim(), state: form.state.trim().toUpperCase(), cnpj: form.cnpj.trim(), notes: form.notes.trim(), active: true }; if (isEditing) { onUpdate(form.id, payload); } else { onSubmit(payload); } resetForm(); }}><Field label="Nome"><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></Field><Field label="Nome fantasia"><input value={form.tradeName} onChange={(event) => setForm({ ...form, tradeName: event.target.value })} /></Field><Field label="Tipo"><select value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value })}><option value="mercado">Mercado</option><option value="atacado">Atacado</option><option value="distribuidor">Distribuidor</option><option value="acougue">Acougue</option><option value="farmacia">Farmacia</option><option value="outro">Outro</option></select></Field><Field label="Cidade"><input value={form.city} onChange={(event) => setForm({ ...form, city: event.target.value })} /></Field><Field label="UF"><input maxLength="2" value={form.state} onChange={(event) => setForm({ ...form, state: event.target.value })} /></Field><Field label="CNPJ"><input value={form.cnpj} onChange={(event) => setForm({ ...form, cnpj: event.target.value })} /></Field><Field label="Observacoes"><input value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></Field><div className="actions-row"><button className="primary-button" type="submit">{isEditing ? 'Salvar alteracoes' : 'Cadastrar fornecedor'}</button></div></form></section><section className="panel"><div className="panel-head"><div><h3>Fornecedores cadastrados</h3><p>Lista padronizada para selecao em todo o sistema</p></div><Badge tone="info">{suppliers.length} fornecedor(es)</Badge></div><div className="table-wrap"><table><thead><tr><th>Nome</th><th>Tipo</th><th>Cidade/UF</th><th>CNPJ</th><th>Uso</th><th>Status</th><th>Observacoes</th><th>Acoes</th></tr></thead><tbody>{suppliers.map((supplier) => { const usage = supplierUsage[supplier.id] || { prices: 0, extras: 0 }; const usageCount = usage.prices + usage.extras; return <tr key={supplier.id}><td><strong>{supplier.name}</strong>{supplier.tradeName ? <div className="sub-note">{supplier.tradeName}</div> : null}</td><td>{supplier.type}</td><td>{[supplier.city, supplier.state].filter(Boolean).join('/') || '-'}</td><td>{supplier.cnpj || '-'}</td><td>{usageCount ? `${usage.prices} preco(s) / ${usage.extras} reposicao(oes)` : 'Sem uso'}</td><td><Badge tone={supplier.active ? 'success' : 'neutral'}>{supplier.active ? 'Ativo' : 'Inativo'}</Badge></td><td>{supplier.notes || '-'}</td><td><div className="table-actions"><button className="ghost-button" type="button" onClick={() => setForm({ id: supplier.id, name: supplier.name || '', tradeName: supplier.tradeName || '', type: supplier.type || 'mercado', city: supplier.city || '', state: supplier.state || 'SP', cnpj: supplier.cnpj || '', notes: supplier.notes || '' })}>Editar</button><button className="table-action" type="button" onClick={() => onDelete(supplier.id)}>Excluir</button></div></td></tr>; })}</tbody></table></div></section></>; }
function ReceiptsPanel({ open, password, onPasswordChange, onUnlock, onLock, receipts, onAdd, suppliersById }) {
  const [form, setForm] = useState({ title: '', value: '', date: todayString(), notes: '' });
  const [monthFilter, setMonthFilter] = useState('');
  const [yearFilter, setYearFilter] = useState('');
  if (!open) return <section className="panel lock-panel"><h3>Area protegida por senha</h3><p>Os comprovantes ficam separados do restante do sistema.</p><div className="lock-row"><input type="password" value={password} onChange={(event) => onPasswordChange(event.target.value)} placeholder="Senha" /><button className="primary-button" onClick={onUnlock}>Entrar</button></div></section>;
  const years = [...new Set(receipts.map((receipt) => String(new Date(`${receipt.date}T12:00:00`).getFullYear())))] .sort((a, b) => Number(b) - Number(a));
  const filteredReceipts = receipts.filter((receipt) => {
    const receiptDate = new Date(`${receipt.date}T12:00:00`);
    const month = String(receiptDate.getMonth() + 1).padStart(2, '0');
    const year = String(receiptDate.getFullYear());
    return (!monthFilter || month === monthFilter) && (!yearFilter || year === yearFilter);
  }).sort((a, b) => new Date(b.importedAt || `${b.date}T12:00:00`) - new Date(a.importedAt || `${a.date}T12:00:00`));
  return <><section className="panel"><div className="panel-head"><div><h3>Comprovantes protegidos</h3><p>Cupons fiscais armazenados com data da compra, importacao e arquivo para download</p></div><button className="ghost-button" onClick={onLock}>Fechar area</button></div><div className="filters-row"><Field label="Mes"><select value={monthFilter} onChange={(event) => setMonthFilter(event.target.value)}><option value="">Todos</option>{Array.from({ length: 12 }, (_, index) => { const value = String(index + 1).padStart(2, '0'); return <option key={value} value={value}>{value}</option>; })}</select></Field><Field label="Ano"><select value={yearFilter} onChange={(event) => setYearFilter(event.target.value)}><option value="">Todos</option>{years.map((year) => <option key={year} value={year}>{year}</option>)}</select></Field><div className="actions-row"><button className="ghost-button" type="button" onClick={() => { setMonthFilter(''); setYearFilter(''); }}>Limpar filtro</button></div></div></section><section className="panel"><div className="panel-head"><div><h3>Registrar comprovante manual</h3><p>Use este formulario apenas quando nao houver importacao pelo modulo de entrada</p></div></div><form className="form-grid" onSubmit={(event) => { event.preventDefault(); onAdd({ title: form.title, value: Number(form.value), date: form.date, importedAt: timestampString(), notes: form.notes, source: 'manual' }); setForm({ title: '', value: '', date: todayString(), notes: '' }); }}><Field label="Titulo"><input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} /></Field><Field label="Valor"><input type="number" min="0" step="0.01" value={form.value} onChange={(event) => setForm({ ...form, value: event.target.value })} /></Field><Field label="Data da compra"><input type="date" value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} /></Field><Field label="Observacao"><input value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></Field><div className="actions-row"><button className="primary-button" type="submit">Salvar comprovante</button></div></form></section><section className="panel"><div className="panel-head"><div><h3>Acervo de comprovantes</h3><p>{filteredReceipts.length} registro(s) encontrado(s)</p></div></div>{!filteredReceipts.length ? <EmptyState text="Nenhum comprovante encontrado para o filtro selecionado." /> : <div className="stack">{filteredReceipts.map((receipt) => <article className="receipt-item" key={receipt.id}><div className="receipt-item-head"><div><strong>{receipt.title}</strong><p>{currency(receipt.value)}{receipt.supplierId ? ` � ${suppliersById[receipt.supplierId]?.name || 'Fornecedor'}` : ''}</p></div><Badge tone={receipt.source === 'entrada-ocr' ? 'info' : 'neutral'}>{receipt.source === 'entrada-ocr' ? 'Importado na entrada' : 'Manual'}</Badge></div><div className="receipt-meta"><span>Data da compra: {formatDate(receipt.date)}</span><span>Importado em: {receipt.importedAt ? formatDateTime(receipt.importedAt) : '-'}</span><span>Arquivo: {receipt.fileName || 'Nao anexado'}</span>{receipt.accessKey ? <span>Chave: {receipt.accessKey}</span> : null}</div><p>{receipt.notes || 'Sem observacao'}</p><div className="actions-row">{receipt.dataUrl ? <button className="primary-button" type="button" onClick={() => downloadDataUrl(receipt.dataUrl, receipt.fileName || `comprovante-${receipt.date}`)}>Baixar comprovante</button> : null}{receipt.queryUrl ? <button className="ghost-button" type="button" onClick={() => window.open(receipt.queryUrl, '_blank', 'noopener,noreferrer')}>Abrir consulta NFC-e</button> : null}</div></article>)}</div>}</section></>;
}
function SettingsPanel({ state, nextPurchaseDate, onSaveCycle, onSaveSettings, onUpdateConsumption }) { const [cycle, setCycle] = useState(state.cycle); const [settings, setSettings] = useState(state.settings); useEffect(() => { setCycle(state.cycle); setSettings(state.settings); }, [state.cycle, state.settings]); return <><section className="panel"><div className="panel-head"><div><h3>Configuracao do ciclo</h3><p>Ultima compra geral e intervalo fixo</p></div><Badge tone="info">Proxima: {formatDate(nextPurchaseDate.toISOString().split('T')[0])}</Badge></div><form className="form-grid" onSubmit={(event) => { event.preventDefault(); onSaveCycle({ lastPurchaseDate: cycle.lastPurchaseDate, intervalDays: Number(cycle.intervalDays) }); }}><Field label="Ultima compra geral"><input type="date" value={cycle.lastPurchaseDate} onChange={(event) => setCycle({ ...cycle, lastPurchaseDate: event.target.value })} /></Field><Field label="Ciclo em dias"><input type="number" min="1" value={cycle.intervalDays} onChange={(event) => setCycle({ ...cycle, intervalDays: event.target.value })} /></Field><div className="actions-row"><button className="primary-button" type="submit">Salvar ciclo</button></div></form></section><section className="panel"><div className="panel-head"><div><h3>Consumo semanal por item</h3><p>Ajuste fino das estimativas de duracao</p></div></div><div className="table-wrap"><table><thead><tr><th>Item</th><th>Unidade</th><th>Consumo semanal</th><th>Estoque atual</th></tr></thead><tbody>{state.items.map((item) => <tr key={item.id}><td>{item.name}</td><td>{item.unit}</td><td><input type="number" min="0" step="0.1" value={item.weeklyConsumption} onChange={(event) => onUpdateConsumption(item.id, Number(event.target.value))} /></td><td>{item.quantity} {item.unit}</td></tr>)}</tbody></table></div></section></>; }
function NewItemForm({ onSubmit }) { const [form, setForm] = useState({ name: '', unit: 'un', quantity: '', minStock: '', weeklyConsumption: '' }); return <><div className="panel-head"><div><h3>Novo item</h3><p>Cadastro rapido para ampliar o estoque base</p></div></div><form className="form-grid" onSubmit={(event) => { event.preventDefault(); if (!form.name.trim()) return; onSubmit({ name: form.name.trim(), unit: normalizeUnit(form.unit) || 'un', quantity: Number(form.quantity || 0), minStock: Number(form.minStock || 0), weeklyConsumption: Number(form.weeklyConsumption || 0) }); setForm({ name: '', unit: 'un', quantity: '', minStock: '', weeklyConsumption: '' }); }}><Field label="Nome"><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></Field><Field label="Unidade"><select value={form.unit} onChange={(event) => setForm({ ...form, unit: event.target.value })}>{UNIT_OPTIONS.map((unit) => <option key={unit.value} value={unit.value}>{unit.label}</option>)}</select></Field><Field label="Quantidade inicial"><input type="number" min="0" step="0.01" value={form.quantity} onChange={(event) => setForm({ ...form, quantity: event.target.value })} /></Field><Field label="Estoque minimo"><input type="number" min="0" step="0.01" value={form.minStock} onChange={(event) => setForm({ ...form, minStock: event.target.value })} /></Field><Field label="Consumo semanal"><input type="number" min="0" step="0.01" value={form.weeklyConsumption} onChange={(event) => setForm({ ...form, weeklyConsumption: event.target.value })} /></Field><div className="actions-row"><button className="primary-button" type="submit">Cadastrar item</button></div></form></>; }
function Field({ label, children }) { return <label className="field"><span>{label}</span>{children}</label>; }
function MetricCard({ label, value, tone = 'neutral' }) { return <article className={`metric ${tone}`}><span>{label}</span><strong>{value}</strong></article>; }
function Badge({ tone = 'neutral', children }) { return <span className={`badge ${tone}`}>{children}</span>; }
function AlertCard({ tone, title, text }) { return <article className={`alert-card ${tone}`}><strong>{title}</strong><p>{text}</p></article>; }
function EmptyState({ text }) { return <div className="empty-state">{text}</div>; }

export default App;






































































