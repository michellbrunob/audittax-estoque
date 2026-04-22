import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createWorker } from 'tesseract.js';
import QrScanner from 'qr-scanner';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker?url';
import audittaxLogo from './assets/audittax-logo.jpeg';
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

// Chave do localStorage legado; usada apenas na migracao para SQLite
const STORAGE_KEY = 'controle-limpeza-react-v1';
const todayString = () => new Date().toISOString().split('T')[0];
const formatDate = (value) => { try { const d = new Date(`${value}T12:00:00`); return isNaN(d.getTime()) ? '--/--/----' : d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }); } catch { return '--/--/----'; } };
const formatDateTime = (value) => new Date(value).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const timestampString = () => new Date().toISOString();
const addDays = (dateString, days) => { const date = new Date(`${dateString || todayString()}T12:00:00`); if (isNaN(date.getTime())) return new Date(); date.setDate(date.getDate() + days); return date; };
const safeIsoDate = (d) => { try { return d instanceof Date && !isNaN(d.getTime()) ? d.toISOString().split('T')[0] : todayString(); } catch { return todayString(); } };
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
const TO_NFCE_CONSULT_URL = 'https://www.sefaz.to.gov.br/nfce';
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
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000); // 5s timeout
  try {
    const response = await fetch(NFCE_EXTRACT_API_URL, { method: 'POST', body: formData, signal: controller.signal });
    clearTimeout(timeout);
    const data = await response.json().catch(() => ({}));
    if (!response.ok && !data.bestEffortKey && !(data.candidatas || []).length) throw new Error(data.error || 'Falha ao consultar o backend da NFC-e.');
    return { ...data, backendOk: response.ok };
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') throw new Error('Backend NFC-e nao respondeu em 5s.');
    throw err;
  }
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
const PACK_UNITS = [
  { label: 'Sem embalagem', value: '', defaultSize: 1 },
  { label: 'Pacote', value: 'Pacote', defaultSize: 4 },
  { label: 'Fardo', value: 'Fardo', defaultSize: 12 },
  { label: 'Caixa', value: 'Caixa', defaultSize: 12 },
  { label: 'Galao', value: 'Galao', defaultSize: 5 },
  { label: 'Frasco', value: 'Frasco', defaultSize: 1 },
  { label: 'Saco', value: 'Saco', defaultSize: 1 },
  { label: 'Bandeja', value: 'Bandeja', defaultSize: 6 },
  { label: 'Display', value: 'Display', defaultSize: 24 },
  { label: 'Duzia', value: 'Duzia', defaultSize: 12 },
];
const CONSUMPTION_PROFILES = [
  { value: 'escritorio', label: 'Escritório', mult: 1.0 },
  { value: 'escola', label: 'Escola', mult: 1.3 },
  { value: 'fabrica', label: 'Fábrica', mult: 1.5 },
  { value: 'restaurante', label: 'Restaurante', mult: 1.8 },
  { value: 'hospital', label: 'Hospital', mult: 2.5 },
  { value: 'comercio', label: 'Comércio', mult: 1.2 },
];
const DEFAULT_CONSUMPTION_RATES = [
  { id: 'papel_hig',   name: 'Papel higiênico',     unit: 'rl', category: 'Banheiro', basis: 'person',         rateBase: 0.25, femaleFactor: 1.4, keyword: 'papel' },
  { id: 'papel_toa',   name: 'Papel toalha',        unit: 'rl', category: 'Banheiro', basis: 'bathroom_clean', rateBase: 0.5,  femaleFactor: 1.0, keyword: 'toalha' },
  { id: 'sabao_liq',   name: 'Sabão líquido (mL)',  unit: 'ml', category: 'Banheiro', basis: 'person',         rateBase: 15,   femaleFactor: 1.0, keyword: 'sabao' },
  { id: 'alcool_gel',  name: 'Álcool gel (mL)',     unit: 'ml', category: 'Limpeza',  basis: 'person',         rateBase: 5,    femaleFactor: 1.0, keyword: 'alcool' },
  { id: 'desinfet',    name: 'Desinfetante (mL)',   unit: 'ml', category: 'Limpeza',  basis: 'bathroom_clean', rateBase: 80,   femaleFactor: 1.0, keyword: 'desinfet' },
  { id: 'detergente',  name: 'Detergente (mL)',     unit: 'ml', category: 'Limpeza',  basis: 'bathroom_clean', rateBase: 20,   femaleFactor: 1.0, keyword: 'detergent' },
  { id: 'limpa_piso',  name: 'Limpa-piso (mL)',     unit: 'ml', category: 'Limpeza',  basis: 'bathroom_clean', rateBase: 60,   femaleFactor: 1.0, keyword: 'piso' },
  { id: 'saco_lixo',   name: 'Saco de lixo',        unit: 'un', category: 'Limpeza',  basis: 'bathroom_day',   rateBase: 1,    femaleFactor: 1.0, keyword: 'lixo' },
  { id: 'cafe',        name: 'Café (g)',            unit: 'g',  category: 'Copa',     basis: 'person',         rateBase: 14,   femaleFactor: 1.0, keyword: 'cafe' },
  { id: 'acucar',      name: 'Açúcar (g)',          unit: 'g',  category: 'Copa',     basis: 'person',         rateBase: 10,   femaleFactor: 1.0, keyword: 'acucar' },
  { id: 'copo_desc',   name: 'Copo descartável',    unit: 'un', category: 'Copa',     basis: 'person',         rateBase: 3,    femaleFactor: 1.0, keyword: 'copo' },
];
const normalizeUnit = (raw) => {
  const value = slug(raw).replace(/[^a-z]/g, '');
  const aliases = {
    unidade: 'un', und: 'un', unid: 'un', pc: 'pct', pacote: 'pct', pacotec: 'pct', caixa: 'cx', fardo: 'fd', frasco: 'fr', galao: 'gl', rolo: 'rl', duzia: 'dz', quilo: 'kg', kilos: 'kg', quilograma: 'kg', grama: 'g', gramas: 'g', miligrama: 'mg', litro: 'l', litros: 'l', mililitro: 'ml', mililitros: 'ml', metro: 'm', metros: 'm', centimetro: 'cm', centimetros: 'cm'
  };
  return UNIT_MAP[value] ? value : (aliases[value] || 'un');
};
const computeLineTotal = (quantity, unitPrice) => Number((Number(quantity || 0) * Number(unitPrice || 0)).toFixed(2));
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
    { id: 2, title: 'NF-002 Marco', value: 145, date: '2026-03-15', notes: 'Reposição geral' }
  ],
  suppliers: [
    { id: 1, name: 'Atacadao', tradeName: 'Atacadao', type: 'atacado', city: 'Sao Paulo', state: 'SP', cnpj: '', notes: '', active: true },
    { id: 2, name: 'Assai', tradeName: 'Assai', type: 'atacado', city: 'Sao Paulo', state: 'SP', cnpj: '', notes: '', active: true },
    { id: 3, name: 'Carrefour', tradeName: 'Carrefour', type: 'mercado', city: 'Sao Paulo', state: 'SP', cnpj: '', notes: '', active: true }
  ],
  cycle: { lastPurchaseDate: '2026-03-06', intervalDays: 60 },
  settings: { receiptPassword: '1234', anthropicApiKey: '' },
  counters: { item: 7, movement: 5, price: 5, extraPurchase: 3, receipt: 3, supplier: 4 },
  maintenanceAssets: [],
  maintenanceRecords: [],
  inventoryAssets: []
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
    counters: raw.counters && typeof raw.counters === 'object' ? { ...initialState.counters, ...raw.counters } : initialState.counters,
    maintenanceAssets: Array.isArray(raw.maintenanceAssets) ? raw.maintenanceAssets : initialState.maintenanceAssets,
    maintenanceRecords: Array.isArray(raw.maintenanceRecords) ? raw.maintenanceRecords : initialState.maintenanceRecords,
    inventoryAssets: Array.isArray(raw.inventoryAssets) ? raw.inventoryAssets : initialState.inventoryAssets
  };
};

const parseMoneyValue = (raw) => {
  const value = String(raw || '').trim().replace(/\s/g, '').replace(/^R\$\s*/, '');
  if (!value) return 0;

  const hasComma = value.includes(',');
  const hasDot = value.includes('.');

  if (hasComma && hasDot) {
    return Number(value.replace(/\./g, '').replace(',', '.')) || 0;
  }

  if (hasComma) {
    return Number(value.replace(',', '.')) || 0;
  }

  return Number(value) || 0;
};
const parseQuantityValue = (raw) => Number(String(raw || '1').replace(',', '.'));
const formatUnitLabel = (unit) => {
  const normalized = normalizeUnit(unit || 'un');
  const custom = {
    un: 'UN',
    pct: 'PCT',
    cx: 'CX',
    fd: 'FD',
    fr: 'FR',
    gl: 'GL',
    rl: 'RL',
    dz: 'DZ',
    kg: 'KG',
    g: 'G',
    mg: 'MG',
    l: 'L',
    ml: 'ML',
    m: 'M',
    cm: 'CM',
  };
  return custom[normalized] || normalized.toUpperCase();
};
const isReceiptNoise = (line) => /subtotal|desconto|troco|pix|cartao|debito|credito|dinheiro|pagamento|recebido|cnpj|cupom|extrato|caixa|operador|cliente|documento|ie\b|valor pago|senha|nsu/i.test(line);
const ITEM_MATCH_STOPWORDS = new Set(['de', 'da', 'do', 'das', 'dos', 'com', 'sem', 'para', 'uso', 'tradicional', 'original', 'premium', 'plus', 'tipo', 'unidade', 'und', 'un']);
const ITEM_MATCH_NOISE = [
  /\b\d+\s*(ml|l|lt|g|kg|gr|un|und|pct|pc|cx|fd|fr|gl|rl|dz|m|cm)\b/gi,
  /\brefil\b/gi,
  /\bsache\b/gi,
  /\bembalagem\b/gi,
  /\bfrasco\b/gi,
  /\bgalao\b/gi,
  /\bcaixa\b/gi,
  /\bpacote\b/gi,
];

const normalizeItemNameForMatch = (value) => {
  let text = slug(value)
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  ITEM_MATCH_NOISE.forEach((pattern) => {
    text = text.replace(pattern, ' ').replace(/\s+/g, ' ').trim();
  });

  return text;
};

const tokenizeItemName = (value) => normalizeItemNameForMatch(value)
  .split(' ')
  .map((token) => token.trim())
  .filter((token) => token.length >= 3 && !ITEM_MATCH_STOPWORDS.has(token));

const unitFamily = (unit) => UNIT_MAP[normalizeUnit(unit || 'un')]?.family || 'count';

const scoreItemMatch = (entryName, item) => {
  const targetNormalized = normalizeItemNameForMatch(entryName);
  const itemNormalized = normalizeItemNameForMatch(item.name);
  if (!targetNormalized || !itemNormalized) {
    return null;
  }

  if (targetNormalized === itemNormalized) {
    return { item, score: 1, reason: 'nome exato' };
  }

  const targetTokens = tokenizeItemName(entryName);
  const itemTokens = tokenizeItemName(item.name);
  const sharedTokens = targetTokens.filter((token) => itemTokens.includes(token));
  const uniqueTokens = new Set([...targetTokens, ...itemTokens]);
  const tokenCoverage = uniqueTokens.size ? sharedTokens.length / uniqueTokens.size : 0;
  const containment = targetNormalized.includes(itemNormalized) || itemNormalized.includes(targetNormalized);
  const prefixBonus = targetTokens[0] && itemTokens[0] && targetTokens[0] === itemTokens[0] ? 0.12 : 0;
  const sharedBonus = Math.min(0.45, sharedTokens.length * 0.16);
  const containmentBonus = containment ? 0.18 : 0;
  const familyBonus = unitFamily(item.unit) ? 0.05 : 0;
  const score = Math.min(0.99, Number((tokenCoverage * 0.55 + sharedBonus + containmentBonus + prefixBonus + familyBonus).toFixed(3)));

  if (score < 0.38) {
    return null;
  }

  return {
    item,
    score,
    reason: sharedTokens.length ? `tokens em comum: ${sharedTokens.join(', ')}` : 'similaridade parcial',
  };
};

const findExistingItemMatch = (name, items, preferredUnit = 'un') => {
  const scored = items
    .map((item) => {
      const base = scoreItemMatch(name, item);
      if (!base) return null;
      const familyMatches = unitFamily(preferredUnit) === unitFamily(item.unit);
      const adjustedScore = Math.min(0.99, Number((base.score + (familyMatches ? 0.08 : -0.06)).toFixed(3)));
      return {
        ...base,
        unitMatch: familyMatches,
        score: adjustedScore,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);

  const best = scored[0] || null;
  if (!best || best.score < 0.45) {
    return null;
  }

  const runnerUp = scored[1] || null;
  if (runnerUp && best.score - runnerUp.score < 0.07 && best.score < 0.78) {
    return null;
  }

  return best;
};

const findExistingItem = (name, items, preferredUnit = 'un') => findExistingItemMatch(name, items, preferredUnit)?.item || null;
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
    const matchedItem = entry.matchedItemId
      ? catalogItems.find((item) => item.id === Number(entry.matchedItemId))
      : findExistingItem(entry.item_cadastrado || entry.nome, catalogItems, normalizedUnit);
    const matchMeta = !entry.matchedItemId ? findExistingItemMatch(entry.item_cadastrado || entry.nome, catalogItems, normalizedUnit) : null;
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
        matchConfidence: Number(entry.matchConfidence || matchMeta?.score || 0),
        matchReason: entry.matchReason || matchMeta?.reason || '',
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
      current.matchConfidence = Number(entry.matchConfidence || matchMeta?.score || current.matchConfidence || 0);
      current.matchReason = entry.matchReason || matchMeta?.reason || current.matchReason || '';
    }
  });
  return [...groups.values()].map((entry, index) => ({
    ...entry,
    id: index + 1,
    rawLine: entry.lineCount > 1 ? ((entry.rawLine || 'Item agrupado') + ' - agrupado de ' + entry.lineCount + ' linha(s)') : entry.rawLine
  }));
};

const mergePurchaseListDraft = (items, draft = []) => {
  const draftById = new Map((draft || []).map((entry) => [Number(entry.id), entry]));
  return sortByName(items).map((item) => {
    const saved = draftById.get(Number(item.id));
    return {
      id: item.id,
      included: saved?.included ?? true,
      editQty: saved?.editQty ?? ''
    };
  });
};

const samePurchaseListDraft = (a = [], b = []) => (
  a.length === b.length
  && a.every((entry, index) => (
    Number(entry.id) === Number(b[index]?.id)
    && entry.included === b[index]?.included
    && String(entry.editQty ?? '') === String(b[index]?.editQty ?? '')
  ))
);

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
  const matchMeta = findExistingItemMatch(name, items, unit);
  const matchedItem = matchMeta?.item || null;
  const confidence = scoreConfidence({ name, quantity, unitPrice, rawLine: clean, matchedItem });
  return {
    nome: name,
    quantidade: quantity || 1,
    unidade: normalizeUnit(unit.toLowerCase()),
    preco_unitario: unitPrice,
    item_cadastrado: matchedItem?.name || null,
    matchedItemId: matchedItem?.id || '',
    matchConfidence: Number(matchMeta?.score || 0),
    matchReason: matchMeta?.reason || '',
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
  const totalProducts = parseMoneyValue(xmlNodeText(totalNode || xml, ['vProd']) || '0');
  const totalDiscount = parseMoneyValue(xmlNodeText(totalNode || xml, ['vDesc']) || '0');
  const totalFreight = parseMoneyValue(xmlNodeText(totalNode || xml, ['vFrete']) || '0');
  const totalOther = parseMoneyValue(xmlNodeText(totalNode || xml, ['vOutro']) || '0');
  const totalInsurance = parseMoneyValue(xmlNodeText(totalNode || xml, ['vSeg']) || '0');
  const totalIpi = parseMoneyValue(xmlNodeText(totalNode || xml, ['vIPI']) || '0');
  const total = parseMoneyValue(xmlNodeText(totalNode || xml, ['vNF']) || '0');
  const draftItems = [...xml.getElementsByTagName('det')].map((det, index) => {
    const prod = det.getElementsByTagName('prod')[0] || det;
    const nome = xmlNodeText(prod, ['xProd']);
    const quantidade = Number((xmlNodeText(prod, ['qCom']) || '0').replace(',', '.'));
    const unidade = normalizeUnit(xmlNodeText(prod, ['uCom']) || 'un');
    const preco = Number((xmlNodeText(prod, ['vUnCom']) || '0').replace(',', '.'));
    const totalLinhaXml = parseMoneyValue(xmlNodeText(prod, ['vProd']) || '0');
    const matchMeta = findExistingItemMatch(nome, items, unidade);
    const matchedItem = matchMeta?.item || null;
    return {
      id: index + 1,
      include: true,
      nome,
      quantidade,
      unidade,
      preco_unitario: preco,
      total_linha_xml: totalLinhaXml || Number((quantidade * preco).toFixed(2)),
      item_cadastrado: matchedItem?.name || null,
      matchedItemId: matchedItem?.id || '',
      matchConfidence: Number(matchMeta?.score || 0),
      matchReason: matchMeta?.reason || '',
      confidence: 0.99,
      rawLine: 'XML fiscal estruturado'
    };
  }).filter((entry) => entry.nome);
  if (!draftItems.length) throw new Error('Nenhum item foi encontrado no XML fiscal.');
  return {
    mercado: market,
    data: normalizedDate,
    total,
    totals: {
      products: totalProducts,
      discount: totalDiscount,
      freight: totalFreight,
      other: totalOther,
      insurance: totalInsurance,
      ipi: totalIpi,
      final: total,
    },
    accessKey,
    items: draftItems,
    sourceMode: 'xml',
    queryUrl: '',
  };
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
  console.log('[PDF Parser] Total de linhas extraidas:', lines.length);
  console.log('[PDF Parser] Primeiras 30 linhas:', lines.slice(0, 30));

  // Padrao 1: DANFE NFC-e padrao SEFAZ - "COD DESCRICAO QTD UN VL_UNIT VL_TOTAL"
  // Ex: "1257654 LIMP PERF UAU ING 1,000 UN 14,97 14,97"
  // Ex: "0376914 CAFE MARATA 500g 20,000 UN 33,97 679,40"
  const patItemLine = /^(\d{4,})\s+(.+?)\s+(\d+[.,]\d{1,3})\s+(UN|KG|LT|ML|PCT|CX|GR|G|L|PC|DZ|MT|M)\s+([\d.,]+)\s+([\d.,]+)$/i;

  // Padrao 2: SEFAZ-TO / Assai - "Codigo: XXXQtde.: Y VL. Unit.:Z"
  // Linha completa: "Codigo: 1136158Qtde.: 1.0 VL. Unit.:9.9"
  // Nome fica 2 linhas acima, total 1 linha acima
  const patSefazTo = /C.digo:\s*(\d+)\s*Qtde\.?:\s*([\d.,]+)\s*VL\.?\s*Unit\.?:\s*([\d.,]+)/i;

  // Padrao 3: Formato inline "Qtde: X x Vl.Unit: Y = Z"
  const patInline = /Qtde?\.?:\s*([\d.,]+)\s*(?:x|X)\s*(?:Vl\.?\s*Unit\.?:?\s*)?([\d.,]+)\s*=?\s*([\d.,]+)?/i;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    // Padrao 1: linha completa com código + descricao + qtd + un + preco
    const m1 = line.match(patItemLine);
    if (m1) {
      const nome = m1[2].trim();
      const quantidade = Number(m1[3].replace(',', '.'));
      const unidade = m1[4].toLowerCase();
      const precoUnit = Number(m1[5].replace('.', '').replace(',', '.'));
      const totalItem = Number(m1[6].replace('.', '').replace(',', '.'));
      const matchMeta = findExistingItemMatch(nome, items, unidade);
      const matchedItem = matchMeta?.item || null;
      draftItems.push({
        id: draftItems.length + 1,
        include: true,
        nome,
        quantidade,
        unidade: normalizeUnit(unidade) || 'un',
        preco_unitario: precoUnit || (quantidade ? Number((totalItem / quantidade).toFixed(2)) : 0),
        item_cadastrado: matchedItem?.name || null,
        matchedItemId: matchedItem?.id || '',
        matchConfidence: Number(matchMeta?.score || 0),
        matchReason: matchMeta?.reason || '',
        confidence: 0.97,
        rawLine: 'PDF - código ' + m1[1]
      });
      continue;
    }

    // Padrao 2: SEFAZ-TO / Assai - "Codigo: XXXQtde.: Y VL. Unit.:Z"
    const m2 = line.match(patSefazTo);
    if (m2) {
      const code = m2[1];
      const quantidade = Number(m2[2].replace(',', '.'));
      const precoUnit = Number(m2[3].replace(',', '.'));
      // Total fica 1 linha acima, nome fica 2 linhas acima
      const totalLine = lines[index - 1] || '';
      const totalVal = Number(String(totalLine).replace(',', '.')) || (quantidade * precoUnit);
      const nameLine = (lines[index - 2] || '').replace(/\s*VL\.?\s*Total\s*$/i, '').trim();
      if (nameLine && nameLine.length >= 2) {
        const matchMeta = findExistingItemMatch(nameLine, items, 'un');
        const matchedItem = matchMeta?.item || null;
        draftItems.push({
          id: draftItems.length + 1, include: true, nome: nameLine,
          quantidade, unidade: 'un', preco_unitario: precoUnit,
          item_cadastrado: matchedItem?.name || null, matchedItemId: matchedItem?.id || '',
          matchConfidence: Number(matchMeta?.score || 0), matchReason: matchMeta?.reason || '',
          confidence: 0.97, rawLine: 'PDF SEFAZ-TO - cod ' + code
        });
      }
      continue;
    }

    // Padrao 3: inline - nome na linha anterior e dados na linha atual
    const m3 = line.match(patInline);
    if (m3 && index > 0) {
      const prevLine = lines[index - 1] || '';
      // Linha anterior nao pode ser outro padrao numerico
      if (prevLine && !/^\d+[.,]\d/.test(prevLine) && !/Qtde/i.test(prevLine)) {
        const nome = prevLine.replace(/^\d{4,}\s*-?\s*/, '').trim();
        if (nome.length >= 3) {
          const quantidade = Number(m3[1].replace(',', '.'));
          const precoUnit = Number(m3[2].replace('.', '').replace(',', '.'));
          const matchMeta = findExistingItemMatch(nome, items, 'un');
          const matchedItem = matchMeta?.item || null;
          draftItems.push({
            id: draftItems.length + 1, include: true, nome,
            quantidade, unidade: 'un', preco_unitario: precoUnit,
            item_cadastrado: matchedItem?.name || null, matchedItemId: matchedItem?.id || '',
            matchConfidence: Number(matchMeta?.score || 0), matchReason: matchMeta?.reason || '',
            confidence: 0.94, rawLine: 'PDF inline'
          });
        }
      }
    }
  }

  const unique = draftItems.filter((entry, idx, arr) => idx === arr.findIndex((item) => slug(item.nome) === slug(entry.nome) && item.preco_unitario === entry.preco_unitario && item.quantidade === entry.quantidade));
  console.log('[PDF Parser] Itens encontrados:', unique.length);

  // Identifica emitente: linha apos cabecalho institucional e antes do CNPJ
  const skipPatterns = /^(GOVERNO|SECRETARIA|DANFE|NFC-?e|Documento|Nota Fiscal|Detalhe|Informac|PROTOCOLO|Consulte|Consumidor|CNPJ|Inscr)/i;
  const cnpjIdx = lines.findIndex((l) => /^CNPJ/i.test(l));
  const market = (cnpjIdx > 0 ? lines[cnpjIdx - 1] : null) || lines.find((line) => line.length > 5 && !skipPatterns.test(line) && /[A-Z]{3,}/i.test(line) && !/^\d+$/.test(line)) || 'Emitente nao identificado';

  // Data: formatos comuns "DD/MM/YYYY HH:MM:SS", "DataDD/MM/YYYY", "Emissao: DD/MM/YYYY"
  const dateMatch = String(text || '').match(/Data\s*:?\s*(\d{2})\/(\d{2})\/(\d{4})\s+\d{2}:\d{2}/)
    || String(text || '').match(/Emiss.o:\s*(\d{2})\/(\d{2})\/(\d{4})/i)
    || String(text || '').match(/(\d{2})\/(\d{2})\/(\d{4})\s+\d{2}:\d{2}/);

  // Total: multiplos padroes brasileiros, com ou sem espaco
  const totalMatch = String(text || '').match(/Valor\s*(?:a\s*)?Pag(?:ar|o)\s*:?\s*(?:\d+\s*)?R?\$?\s*([\d.,]+)/i)
    || String(text || '').match(/VALOR\s*PAGO\s*:?\s*R?\$?\s*([\d.,]+)/i)
    || String(text || '').match(/Total\s*:?\s*R?\$?\s*([\d.,]+)/i);

  // Busca direta: "Chave de acesso:17260106..."
  const directKeyMatch = text.match(/[Cc]have\s+de\s+[Aa]cesso\s*:?\s*(\d{44})/);
  const directKey = directKeyMatch?.[1] || '';
  const validAccessKeys = extractAccessKeyCandidates(text).filter((candidate) => validateAccessKey(candidate));
  const accessKey = directKey || validAccessKeys[0] || '';

  // URL de consulta SEFAZ (qualquer UF)
  const sefazUrl = String(text || '').match(/(https?:\/\/www\.sefaz\.[a-z]{2}\.gov\.br\/nfce\/[^\s]+)/i)?.[1] || '';

  // CNPJ do emitente
  const cnpjMatch = String(text || '').match(/CNPJ\s*:?\s*([\d.\/\-]+)/i);
  const cnpj = cnpjMatch?.[1]?.trim() || '';

  return {
    mercado: market.trim(),
    cnpj,
    data: dateMatch ? (dateMatch[3] + '-' + dateMatch[2] + '-' + dateMatch[1]) : todayString(),
    total: totalMatch ? parseMoneyValue(totalMatch[1]) : 0,
    accessKey,
    accessKeySource: accessKey ? 'PDF texto' : '',
    accessKeyValid: accessKey ? validateAccessKey(accessKey) : false,
    accessKeyCandidates: validAccessKeys.length ? validAccessKeys : extractAccessKeyCandidates(text),
    items: unique,
    sourceMode: 'pdf-texto',
    queryUrl: sefazUrl || ''
  };
};
const extractAccessKey = (raw) => String(raw || '').replace(/\D/g, '').match(/\d{44}/)?.[0] || '';
// Corrige erros leves de OCR em trechos predominantemente numericos
const fixOcrInDigitRun = (text) => String(text || '').replace(/[\]|!]/g, '1');

// Verifica se uma linha e predominantemente numerica (>70% dos caracteres sao digitos)
const isDigitLine = (line) => {
  const chars = line.replace(/\s/g, '');
  if (chars.length < 30) return false;
  const digitCount = (chars.match(/\d/g) || []).length;
  return digitCount / chars.length > 0.7;
};

const extractAccessKeyCandidates = (raw) => {
  const text = String(raw || '');
  const candidates = [];

  // 1. Busca direta por 44 digitos consecutivos
  const directMatches = text.match(/\d{44}/g) || [];
  directMatches.forEach((m) => candidates.push(m));

  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  // 2. Linhas predominantemente numericas
  // Extrai apenas de linhas que ja sao >70% digitos para evitar falsos positivos
  for (const line of lines) {
    if (isDigitLine(line)) {
      const fixed = fixOcrInDigitRun(line);
      const digits = fixed.replace(/\D/g, '');
      if (digits.length >= 44) {
        // Sliding window apenas dentro desta linha de digitos
        for (let j = 0; j <= digits.length - 44; j += 1) {
          candidates.push(digits.slice(j, j + 44));
        }
      }
    }
  }

  // 3. Busca contextual: linha de digitos logo apos "chave" ou "acesso"
  for (let i = 0; i < lines.length; i += 1) {
    if (/chave|acesso/i.test(lines[i])) {
      // Procura a próxima linha predominantemente numerica
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

  // Nao faz sliding window no texto inteiro para evitar falsos positivos
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

// Cria canvas recortado + redimensionado para QR detection
const createImageCanvas = (image, crop, scale = 1, filter = '') => {
  const sx = Math.max(0, Math.round(crop.x || 0));
  const sy = Math.max(0, Math.round(crop.y || 0));
  const sw = Math.max(1, Math.round(Math.min(image.width - sx, crop.width || image.width)));
  const sh = Math.max(1, Math.round(Math.min(image.height - sy, crop.height || image.height)));
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  canvas.width = Math.round(sw * scale);
  canvas.height = Math.round(sh * scale);
  if (filter) ctx.filter = filter;
  ctx.drawImage(image, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  return canvas;
};

const detectQrWithQrScanner = async (variants) => {
  for (const variant of variants) {
    try {
      const result = await QrScanner.scanImage(variant, { returnDetailedScanResult: true });
      if (result?.data) {
        console.log('[QR] Detectado com qr-scanner:', result.data.slice(0, 100));
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
    console.log('[QR] Imagem carregada:', image.width, 'x', image.height);

    // Variantes de recorte: QR de cupom fica tipicamente no canto inferior-esquerdo
    const variants = [
      image,
      // Metade inferior completa (QR sempre fica na parte de baixo do cupom)
      createImageCanvas(image, { x: 0, y: image.height * 0.5, width: image.width, height: image.height * 0.5 }, 2),
      // Canto inferior esquerdo; posicao mais comum do QR em NFC-e
      createImageCanvas(image, { x: 0, y: image.height * 0.55, width: image.width * 0.5, height: image.height * 0.35 }, 3),
      // Canto inferior-esquerdo com alto contraste
      createImageCanvas(image, { x: 0, y: image.height * 0.55, width: image.width * 0.5, height: image.height * 0.35 }, 3, 'grayscale(1) contrast(2) brightness(1.1)'),
      // Metade inferior com contraste
      createImageCanvas(image, { x: 0, y: image.height * 0.5, width: image.width, height: image.height * 0.5 }, 2, 'grayscale(1) contrast(1.6) brightness(1.05)'),
      // Terco inferior; QR mais perto do rodape
      createImageCanvas(image, { x: 0, y: image.height * 0.6, width: image.width * 0.6, height: image.height * 0.35 }, 3.5),
      // Escala maior para QR pequeno
      createImageCanvas(image, { x: 0, y: image.height * 0.5, width: image.width * 0.5, height: image.height * 0.4 }, 4, 'grayscale(1) contrast(1.8)')
    ];

    console.log('[QR] Testando', variants.length, 'variantes de recorte...');
    const qrScannerResult = await detectQrWithQrScanner(variants);
    if (qrScannerResult.rawValue) return qrScannerResult;

    // Fallback: BarcodeDetector nativo (Chrome 83+)
    if (typeof BarcodeDetector !== 'undefined') {
      console.log('[QR] Tentando BarcodeDetector nativo...');
      const detector = new BarcodeDetector({ formats: ['qr_code'] });
      for (const variant of variants) {
        try {
          const codes = await detector.detect(variant);
          if (codes?.[0]?.rawValue) {
            console.log('[QR] Detectado com BarcodeDetector:', codes[0].rawValue.slice(0, 100));
            return { rawValue: codes[0].rawValue, boundingBox: codes[0].boundingBox || null };
          }
        } catch {}
      }
    }

    console.log('[QR] Nenhum QR detectado em nenhuma variante.');
    return { rawValue: '', boundingBox: null };
  } catch (err) {
    console.error('[QR] Erro geral:', err);
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
  // Grayscale + alto contraste sem threshold duro; preserva digitos pequenos
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
    // Prioriza chave encontrada perto do rotulo "Chave de Acesso"
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

  // 4. Fallback: apenas candidatas que parecem NFC-e (posicao 20-21 = "65")
  // Nunca retorna sequencias aleatorias de digitos como chave
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
  ['dashboard', 'Dashboard', 'Visão geral'],
  ['cycle', 'Ciclo de compras', 'Visão geral'],
  ['timeline', 'Linha do tempo', 'Visão geral'],
  ['items', 'Itens', 'Estoque'],
  ['entry', 'Entrada', 'Estoque'],
  ['output', 'Saida', 'Estoque'],
  ['extra', 'Reposição avulsa', 'Estoque'],
  ['history', 'Histórico', 'Estoque'],
  ['prices', 'Precos', 'Analise'],
  ['duration', 'Duracao', 'Analise'],
  ['reports', 'Relatorios', 'Analise'],
  ['consumption', 'Consumo estimado', 'Analise'],
  ['maintenance', 'Manutenção Predial', 'Predial'],
  ['inventory', 'Inventário TI', 'Predial'],
  ['receipts', 'Comprovantes', 'Administracao'],
  ['suppliers', 'Fornecedores', 'Administracao'],
  ['settings', 'Configurações', 'Administracao']
];

const createEmptyReaderState = () => ({
  loading: false,
  error: '',
  fileName: '',
  fileDataUrl: '',
  fileMimeType: '',
  companionFileName: '',
  companionFileMimeType: '',
  preview: '',
  parsed: null,
  draftItems: [],
  supplierId: '',
  accessKey: '',
  queryUrl: ''
});

function App() {
  const [state, setState] = useState(initialState);
  const [dbReady, setDbReady] = useState(false);
  const [screen, setScreen] = useState('dashboard');
  const [purchaseListDraft, setPurchaseListDraft] = useState(() => mergePurchaseListDraft(initialState.items));
  const [flash, setFlash] = useState(null);
  const [alertsLastSeen, setAlertsLastSeen] = useState(0);
  const [historyFilter, setHistoryFilter] = useState('');
  const [priceFilter, setPriceFilter] = useState('');
  const [reader, setReader] = useState(createEmptyReaderState);
  const timer = useRef(null);
  const readerFileRef = useRef(null); // guarda File original para upload ao backend
  const readerAttachmentRef = useRef(null);

  // Carga inicial: SQLite para state, com migracao autom?tica do localStorage
  useEffect(() => {
    import('./api.js').then(({ default: api }) => {
      window.__api = api; // disponibiliza globalmente para CRUD
      api.getState().then((serverState) => {
        const hasData = serverState && (serverState.items?.length > 0 || serverState.suppliers?.length > 0 || serverState.receipts?.length > 0);
        if (hasData) {
          setState(hydrateState(serverState));
          setDbReady(true);
        } else {
          // Tenta migrar localStorage
          const stored = localStorage.getItem(STORAGE_KEY);
          if (stored) {
            try {
              const parsed = JSON.parse(stored);
              api.migrate(parsed).then(() => api.getState()).then((fresh) => {
                setState(hydrateState(fresh));
                localStorage.removeItem(STORAGE_KEY);
                setDbReady(true);
              }).catch(() => { setState(hydrateState(parsed)); setDbReady(true); });
            } catch { setDbReady(true); }
          } else { setDbReady(true); }
        }
      }).catch(() => {
        // Fallback: backend indisponivel, tenta localStorage
        try {
          const stored = localStorage.getItem(STORAGE_KEY);
          if (stored) setState(hydrateState(JSON.parse(stored)));
        } catch { /* noop */ }
        setDbReady(true);
      });
    });
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    setPurchaseListDraft((current) => {
      const next = mergePurchaseListDraft(state.items, current);
      return samePurchaseListDraft(current, next) ? current : next;
    });
  }, [state.items]);

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
  const vulnerableItems = useMemo(() => state.items.filter((item) => {
    const belowMin = Number(item.quantity || 0) <= Number(item.minStock || 0);
    return belowMin || durationForItem(item) < daysUntilNextPurchase;
  }), [state.items, daysUntilNextPurchase]);
  const maintOverdue = (state.maintenanceAssets || []).filter((a) => {
    if (!a.lastMaintenanceDate) return true;
    const last = new Date(a.lastMaintenanceDate);
    const next = new Date(last.getTime() + Number(a.intervalDays||180) * 86400000);
    return next <= new Date();
  }).length;

  const showFlash = (message, tone = 'success') => { setFlash({ message, tone }); clearTimeout(timer.current); timer.current = setTimeout(() => setFlash(null), 3200); };

  const showFlashErr = (e) => { console.error('API error:', e); showFlash(e?.error || e?.message || 'Erro na operacao.', 'error'); };
  // Helper: chama API e recarrega state completo
  const apiCall = (fn, successMsg) => {
    if (!window.__api) return showFlash('Backend nao conectado. Reinicie o servidor.', 'error');
    return fn.then(() => window.__api.getState()).then((fresh) => { setState(hydrateState(fresh)); if (successMsg) showFlash(successMsg); }).catch(showFlashErr);
  };

  const addItem = (payload) => apiCall(window.__api.addItem(payload), 'Item cadastrado.');
  const updateItem = (itemId, payload) => apiCall(window.__api.updateItem(itemId, payload), 'Item atualizado.');
  const deleteItem = (itemId) => {
    apiCall(window.__api.deleteItem(itemId), 'Item excluido.');
  };

  const registerMovement = (payload) => {
    const item = itemsById[payload.itemId];
    if (payload.type === 'saida' && payload.quantity > item.quantity) return showFlash('Quantidade maior que o estoque atual.', 'error');
    apiCall(window.__api.registerMovement(payload), `${payload.type === 'entrada' ? 'Entrada' : 'Saida'} registrada.`);
  };

  const registerExtra = (payload) => {
    const supplierName = state.suppliers.find((s) => s.id === Number(payload.supplierId))?.name || payload.location || '';
    // Backend: inserts extra + movement + updates item qty
    apiCall(window.__api.registerExtra({ ...payload, location: supplierName }), 'Reposição avulsa registrada.');
  };

  const addPrice = (payload) => {
    const market = state.suppliers.find((s) => s.id === Number(payload.supplierId))?.name || payload.market || 'Fornecedor nao informado';
    apiCall(window.__api.addPrice({ ...payload, market }), 'Preco registrado.');
  };
  const addReceipt = (payload, file) => apiCall(window.__api.addReceipt(payload, file), 'Comprovante salvo.');
  const deleteReceipt = (id, mode = 'receipt-only') => apiCall(
    window.__api.deleteReceipt(id, mode),
    mode === 'revert-import' ? 'Importacao revertida e comprovante excluido.' : 'Comprovante excluido.'
  );
  const addMaintenanceAsset = async (p) => { const r = await window.__api.addMaintenanceAsset(p); setState((s) => ({ ...s, maintenanceAssets: [...s.maintenanceAssets, r].sort((a,b) => a.name.localeCompare(b.name)) })); };
  const updateMaintenanceAsset = async (id, p) => { const r = await window.__api.updateMaintenanceAsset(id, p); setState((s) => ({ ...s, maintenanceAssets: s.maintenanceAssets.map((a) => a.id === id ? r : a) })); };
  const deleteMaintenanceAsset = async (id) => { await window.__api.deleteMaintenanceAsset(id); setState((s) => ({ ...s, maintenanceAssets: s.maintenanceAssets.filter((a) => a.id !== id) })); };
  const addMaintenanceRecord = async (p) => { const r = await window.__api.addMaintenanceRecord(p); setState((s) => ({ ...s, maintenanceRecords: [r, ...s.maintenanceRecords], maintenanceAssets: s.maintenanceAssets.map((a) => a.id === Number(p.assetId) ? { ...a, ...(p.type === 'aplicacao_herbicida' ? { lastHerbicideDate: p.date } : { lastMaintenanceDate: p.date }) } : a) })); };
  const deleteMaintenanceRecord = async (id) => { await window.__api.deleteMaintenanceRecord(id); setState((s) => ({ ...s, maintenanceRecords: s.maintenanceRecords.filter((r) => r.id !== id) })); };
  const addInventoryAsset = async (p) => { const r = await window.__api.addInventoryAsset(p); setState((s) => ({ ...s, inventoryAssets: [...s.inventoryAssets, r].sort((a,b) => (a.description || '').localeCompare(b.description || '')) })); };
  const updateInventoryAsset = async (id, p) => { const r = await window.__api.updateInventoryAsset(id, p); setState((s) => ({ ...s, inventoryAssets: s.inventoryAssets.map((a) => a.id === id ? r : a) })); };
  const deleteInventoryAsset = async (id) => { await window.__api.deleteInventoryAsset(id); setState((s) => ({ ...s, inventoryAssets: s.inventoryAssets.filter((a) => a.id !== id) })); };
  const addSupplier = (payload) => apiCall(window.__api.addSupplier(payload), 'Fornecedor cadastrado.');
  const updateSupplier = (supplierId, payload) => apiCall(window.__api.updateSupplier(supplierId, payload), 'Fornecedor atualizado.');
  const deleteSupplier = (supplierId) => {
    window.__api.deleteSupplier(supplierId).then((r) => {
      if (r.error) return showFlash('Este fornecedor ja possui historico vinculado e nao pode ser excluido.', 'error');
      return window.__api.getState().then((fresh) => { setState(hydrateState(fresh)); showFlash('Fornecedor excluido.'); });
    }).catch(showFlashErr);
  };
  const updateCycle = (payload) => apiCall(window.__api.updateCycle(payload), 'Ciclo atualizado.');
  const saveSettings = (payload) => apiCall(window.__api.saveSettings(payload), 'Configurações salvas.');
  const updateConsumption = (itemId, weeklyConsumption) => {
    window.__api.updateConsumption(itemId, weeklyConsumption).catch(() => {});
    setState((current) => ({ ...current, items: current.items.map((item) => item.id === itemId ? { ...item, weeklyConsumption } : item) }));
  };

      // Resolve fornecedor pendente quando suppliers atualiza apos cadastro
  useEffect(() => {
    if (reader._pendingSupplierName) {
      const match = findExistingSupplier(reader._pendingSupplierName, state.suppliers);
      if (match) setReader((current) => ({ ...current, supplierId: String(match.id), _pendingSupplierName: '' }));
    }
  }, [state.suppliers, reader._pendingSupplierName]);

  const analyzeReceipt = async (file) => {
    readerFileRef.current = file; // Guarda referÃªncia para upload posterior
    let previewDataUrl = '';
    let sourceForOcr = file;
    let fileDataUrl = '';
    let pdfAccessKey = '';
    const lowerName = file.name.toLowerCase();
    const isXml = file.type.includes('xml') || lowerName.endsWith('.xml');
    const fileMimeType = file.type || (lowerName.endsWith('.pdf') ? 'application/pdf' : isXml ? 'application/xml' : 'image/*');
    setReader((current) => ({ ...createEmptyReaderState(), companionFileName: current.companionFileName || '', companionFileMimeType: current.companionFileMimeType || '', loading: true, fileName: file.name, fileDataUrl: '', fileMimeType: '' }));
    let worker;
    try {
      fileDataUrl = String(await fileToDataUrl(file));
      if (isXml) {
        const parsed = parseFiscalXml(await readFileAsText(file), state.items);
        setReader((current) => ({ ...current, loading: false, error: '', fileName: file.name, fileDataUrl, fileMimeType, preview: '', parsed, draftItems: parsed.items || [], supplierId: '', accessKey: parsed.accessKey || '', queryUrl: parsed.queryUrl || '' }));
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
          setReader((current) => ({ ...current, loading: false, error: '', fileName: file.name, fileDataUrl, fileMimeType, preview: '', parsed: { ...parsedPdf, items: draftItems }, draftItems, supplierId: supplierMatch?.id ? String(supplierMatch.id) : '', accessKey: parsedPdf.accessKey || backendPdfResult.chaveAcesso || '', queryUrl: parsedPdf.queryUrl || '' }));
          showFlash(parsedPdf.accessKey ? 'PDF textual importado com chave e itens.' : 'PDF textual importado. Confira a chave antes de importar.', parsedPdf.accessKey ? 'success' : 'warn');
          return;
        }
        const pdfText = await extractPdfTextFromFile(file);
        console.log('[PDF] Texto extraido:', pdfText.length, 'chars, primeiras 500:', pdfText.slice(0, 500));
        const parsedPdf = parseNativePdfReceiptText(pdfText, state.items);
        console.log('[PDF] Resultado parse:', parsedPdf.items?.length, 'itens, chave:', parsedPdf.accessKey ? 'SIM' : 'NAO', 'total:', parsedPdf.total);
          // Guardar chave extraida do PDF textual mesmo que itens falhem
        pdfAccessKey = parsedPdf.accessKey || '';
        const pdfQueryUrl = parsedPdf.queryUrl || '';
        if (parsedPdf.items?.length) {
          const draftItems = consolidateDraftItems(parsedPdf.items, state.items);
          const supplierMatch = findExistingSupplier(parsedPdf.mercado, state.suppliers);
          setReader((current) => ({ ...current, loading: false, error: '', fileName: file.name, fileDataUrl, fileMimeType, preview: '', parsed: { ...parsedPdf, items: draftItems }, draftItems, supplierId: supplierMatch?.id ? String(supplierMatch.id) : '', accessKey: parsedPdf.accessKey || '', queryUrl: parsedPdf.queryUrl || '' }));
          showFlash(parsedPdf.accessKey ? 'PDF textual importado com chave e itens.' : 'PDF textual importado. Confira a chave antes de importar.', parsedPdf.accessKey ? 'success' : 'warn');
          return;
        }
        console.warn('[PDF] Parser nao encontrou itens, caindo no fallback OCR. Chave do PDF preservada:', pdfAccessKey || '(nenhuma)');
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
          // Log das variantes que contem digitos relevantes
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
      const resolvedAccessKey = pdfAccessKey || backendKeyResult?.chaveAcesso || backendKeyResult?.bestEffortKey || backendKeyResult?.candidatas?.[0] || bestKey.key;
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
        matchConfidence: Number(entry.matchConfidence || 0),
        matchReason: entry.matchReason || '',
        confidence: Number(entry.confidence || 0.3),
        rawLine: entry.rawLine || ''
      }));
      if (!draftItems.length) throw new Error('Nao foi possivel identificar itens com confianca. Tente uma foto mais nitida, reta e com melhor iluminacao.');
      setReader((current) => ({ ...current, loading: false, error: '', fileName: file.name, fileDataUrl, fileMimeType, preview: previewDataUrl, parsed, draftItems, supplierId: '', accessKey: parsed.accessKey || '', queryUrl: parsed.queryUrl || '' }));
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
    const market = state.suppliers.find((s) => s.id === Number(reader.supplierId || 0))?.name || reader.parsed?.mercado || 'Mercado nao identificado';
    const date = reader.parsed?.data || todayString();
    const importedItems = reader.draftItems.filter((entry) => entry.include && entry.nome);
    const importedTotal = importedItems.reduce((sum, entry) => sum + computeLineTotal(entry.quantidade, entry.preco_unitario, entry.unidade), 0);

    // Mapeia itens: vincula a existente ou cria novo
    const items = importedItems.map((entry) => {
      const matchName = slug(entry.item_cadastrado || entry.nome);
      const existing = state.items.find((candidate) => slug(candidate.name) === matchName);
      return {
        import: true,
        linkedItemId: existing?.id || null,
        name: entry.nome,
        unit: entry.unidade || 'un',
        quantity: Number(entry.quantidade || 0),
        unitPrice: Number(entry.preco_unitario || 0),
      };
    });

    const payload = {
      items,
      date,
      fileName: reader.fileName || `comprovante-${date}`,
      title: `Cupom ${market}`,
      totalValue: Number(reader.parsed?.total || importedTotal || 0),
      notes: `Importado pelo modulo de entrada com ${importedItems.length} item(ns).`,
      supplierId: Number(reader.supplierId || 0) || null,
      mimeType: reader.fileMimeType || '',
      accessKey: reader.accessKey || reader.parsed?.accessKey || '',
      queryUrl: reader.queryUrl || reader.parsed?.queryUrl || '',
      source: reader.parsed?.sourceMode === 'xml' ? 'xml-fiscal' : reader.parsed?.sourceMode === 'pdf-texto' ? 'pdf-texto' : 'entrada-ocr',
    };

    // Envia ao backend com arquivo
    const fd = new FormData();
    fd.append('data', JSON.stringify(payload));
    if (readerFileRef.current) fd.append('primaryFile', readerFileRef.current);
    if (readerAttachmentRef.current) fd.append('attachmentFile', readerAttachmentRef.current);

    const API_BASE = window.__api ? `http://${window.location.hostname}:3333` : 'http://127.0.0.1:3333';
    fetch(`${API_BASE}/api/import-receipt`, { method: 'POST', body: fd })
      .then((r) => r.json())
      .then((result) => {
        if (result.state) setState(hydrateState(result.state));
        showFlash('Itens importados do comprovante.');
      })
      .catch((e) => showFlash(e?.message || 'Erro ao importar.', 'error'));

    setReader(createEmptyReaderState());
    readerFileRef.current = null;
    readerAttachmentRef.current = null;
  };

  const cycleProgress = Math.max(0, Math.min(100, (diffDays(new Date(), new Date(`${state.cycle.lastPurchaseDate}T00:00:00`)) / Number(state.cycle.intervalDays || 1)) * 100));
  const groups = ['Visão geral', 'Estoque', 'Analise', 'Predial', 'Administracao'];

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><div className="brand-lockup"><div className="brand-logo-shell"><img src={audittaxLogo} alt="Audittax Gestão Integrada" className="brand-logo" /></div><div><span className="brand-kicker">Audittax</span><h1>Gestão Integrada</h1><p className="brand-subtitle">Operação, estoque, patrimônio e manutenção em uma gestão interna unificada.</p></div></div></div>
        {groups.map((group) => <div className="nav-group" key={group}><span className="nav-label">{group}</span>{screens.filter((screenItem) => screenItem[2] === group).map(([id, label]) => <button key={id} className={`nav-item ${screen === id ? 'active' : ''}`} onClick={() => { setScreen(id); if (id === 'dashboard') setAlertsLastSeen(lowStockItems.length); }}><span>{label}</span>{id === 'dashboard' && lowStockItems.length > alertsLastSeen ? <span className="nav-pill">{lowStockItems.length}</span> : null}{id === 'maintenance' && maintOverdue > 0 ? <span className="nav-pill">{maintOverdue}</span> : null}</button>)}</div>)}
      </aside>
      <main className="main">
        <header className="topbar"><div><p className="eyebrow">Audittax Gestão Integrada</p><h2>{screens.find((screenItem) => screenItem[0] === screen)?.[1]}</h2>{screen === 'dashboard' ? <p className="subtle">{state.items.length} itens cadastrados, próxima compra em {formatDate(safeIsoDate(nextPurchaseDate))}</p> : <p className="subtle">Plataforma integrada para estoque administrativo, limpeza, TI e manutenção predial.</p>}</div>{flash ? <div className={`flash ${flash.tone}`}>{flash.message}</div> : null}</header>

        {screen === 'dashboard' ? <><div className="metrics"><MetricCard label="Itens ativos" value={state.items.length} /><MetricCard label="Abaixo do minimo" value={lowStockItems.length} tone={lowStockItems.length ? 'danger' : 'success'} /><MetricCard label="Nao chegam ate a compra" value={vulnerableItems.length} tone={vulnerableItems.length ? 'warn' : 'success'} /><MetricCard label="Custo extra no ciclo" value={currency(state.extraPurchases.reduce((sum, entry) => sum + entry.cost, 0))} tone="warn" /></div><div className="panel-grid"><section className="panel"><div className="panel-head"><div><h3>Alertas automaticos</h3><p>Compra geral prevista para {formatDate(safeIsoDate(nextPurchaseDate))}</p></div><Badge tone={daysUntilNextPurchase <= 7 ? 'danger' : 'info'}>{daysUntilNextPurchase} dias restantes</Badge></div>{!lowStockItems.length && !vulnerableItems.length ? <EmptyState text="Nenhum alerta no momento." /> : <div className="stack">{lowStockItems.map((item) => <AlertCard key={`low-${item.id}`} tone="danger" title={`${item.name} abaixo do estoque minimo`} text={`Atual ${item.quantity} ${item.unit}. Minimo ${item.minStock} ${item.unit}.`} />)}{vulnerableItems.map((item) => <AlertCard key={`vul-${item.id}`} tone="warn" title={`${item.name} nao chega ate a próxima compra`} text={`Duracao estimada: ${durationForItem(item)} dias.`} />)}</div>}</section><section className="panel"><div className="panel-head"><div><h3>Últimas movimentações</h3><p>Entradas, saidas e reposições avulsas</p></div></div><div className="stack">{[...state.movements].slice(-6).reverse().map((entry) => <div className="history-row" key={entry.id}><span className={`dot ${entry.type}`}></span><div className="history-main"><strong>{entry.type === 'entrada' ? '+' : '-'}{entry.quantity}</strong> {itemsById[entry.itemId]?.name || 'Item removido'} <span className="sub-note">{entry.notes}</span></div><span className="mono">{formatDate(entry.date)}</span></div>)}</div></section></div></> : null}

        {screen === 'cycle' ? <><section className={`panel cycle-banner ${daysUntilNextPurchase <= 7 ? 'danger' : daysUntilNextPurchase <= 20 ? 'warn' : 'success'}`}><div><p className="eyebrow">Próxima compra geral</p><h3>{daysUntilNextPurchase} dias</h3><p>Data prevista: {formatDate(safeIsoDate(nextPurchaseDate))}</p></div><div className="cycle-meter"><div className="progress"><span style={{ width: `${cycleProgress}%` }}></span></div><p>Custo extra no ciclo atual: {currency(state.extraPurchases.filter((entry) => new Date(`${entry.date}T00:00:00`) >= new Date(`${state.cycle.lastPurchaseDate}T00:00:00`)).reduce((sum, entry) => sum + entry.cost, 0))}</p></div></section><section className="panel"><div className="panel-head"><div><h3>Itens vs próxima compra</h3><p>Quais itens aguentam ate o fechamento do ciclo</p></div></div><div className="table-wrap"><table><thead><tr><th>Item</th><th>Estoque</th><th>Esgota em</th><th>Dias restantes</th><th>Situacao</th></tr></thead><tbody>{state.items.map((item) => { const days = durationForItem(item); return <tr key={item.id}><td>{item.name}</td><td>{item.quantity} {item.unit}</td><td>{Number.isFinite(days) ? `${days} dias` : 'Sem consumo'}</td><td>{daysUntilNextPurchase}</td><td><Badge tone={days >= daysUntilNextPurchase ? 'success' : 'warn'}>{days >= daysUntilNextPurchase ? 'Aguenta o ciclo' : 'Precisa repor'}</Badge></td></tr>; })}</tbody></table></div></section></> : null}

        {screen === 'timeline' ? <section className="panel"><div className="panel-head"><div><h3>Linha do tempo cronológica</h3><p>Esgotamentos projetados, reposições avulsas e compra geral</p></div></div><div className="timeline">{state.items.map((item) => ({ id: `item-${item.id}`, date: addDays(todayString(), Number.isFinite(durationForItem(item)) ? durationForItem(item) : 3650).toISOString().split('T')[0], tone: durationForItem(item) <= 7 ? 'danger' : durationForItem(item) <= daysUntilNextPurchase ? 'warn' : 'success', title: `${item.name} deve acabar`, subtitle: `${item.quantity} ${item.unit} em estoque, consumo ${item.weeklyConsumption} ${item.unit}/semana` })).concat(state.extraPurchases.map((entry) => ({ id: `extra-${entry.id}`, date: entry.date, tone: 'info', title: `Reposição avulsa de ${itemsById[entry.itemId]?.name || 'Item removido'}`, subtitle: `${entry.quantity} ${itemsById[entry.itemId]?.unit || ''} em ${suppliersById[entry.supplierId]?.name || entry.location || 'local nao informado'} por ${currency(entry.cost)}` }))).concat([{ id: 'cycle', date: safeIsoDate(nextPurchaseDate), tone: 'neutral', title: 'Próxima compra geral', subtitle: `Ciclo fixo de ${state.cycle.intervalDays} dias` }]).sort((a, b) => new Date(`${a.date}T00:00:00`) - new Date(`${b.date}T00:00:00`)).map((event) => <div className="timeline-item" key={event.id}><span className={`timeline-dot ${event.tone}`}></span><div><span className="mono">{formatDate(event.date)}</span><h4>{event.title}</h4><p>{event.subtitle}</p></div></div>)}</div></section> : null}

        {screen === 'items' ? <ItemsPanel items={state.items} movements={state.movements} priceHistory={state.priceHistory} onAdd={addItem} onUpdate={updateItem} onDelete={deleteItem} /> : null}
        {screen === 'entry' ? <><MovementForm title="Registrar entrada manual" items={state.items} onSubmit={(payload) => registerMovement({ ...payload, type: 'entrada' })} /><ReaderPanel state={reader} items={state.items} suppliers={state.suppliers} onAnalyze={analyzeReceipt} onConfirm={confirmReaderImport} onDraftChange={(draftItems) => setReader((current) => ({ ...current, draftItems }))} onSupplierChange={(supplierId) => setReader((current) => ({ ...current, supplierId }))} onAccessKeyChange={(accessKey) => setReader((current) => ({ ...current, accessKey }))} onAttachmentChange={(file) => { readerAttachmentRef.current = file; setReader((current) => ({ ...current, companionFileName: file?.name || '', companionFileMimeType: file?.type || '' })); }} onAddSupplier={(payload) => { addSupplier(payload); setReader((current) => ({ ...current, _pendingSupplierName: payload.name })); }} onReset={() => { setReader(createEmptyReaderState()); readerFileRef.current = null; readerAttachmentRef.current = null; }} /></> : null}
        {screen === 'output' ? <MovementForm title="Registrar saida" items={state.items} onSubmit={(payload) => registerMovement({ ...payload, type: 'saida' })} /> : null}
        {screen === 'extra' ? <ExtraForm items={state.items} entries={state.extraPurchases} onSubmit={registerExtra} itemsById={itemsById} suppliers={state.suppliers} suppliersById={suppliersById} /> : null}
        {screen === 'history' ? <section className="panel"><div className="panel-head"><div><h3>Histórico completo</h3><p>Movimentacoes filtraveis por item</p></div><select value={historyFilter} onChange={(event) => setHistoryFilter(event.target.value)}><option value="">Todos os itens</option>{state.items.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div><div className="stack">{[...state.movements].reverse().filter((entry) => !historyFilter || String(entry.itemId) === historyFilter).map((entry) => <div className="history-row" key={entry.id}><span className={`dot ${entry.type}`}></span><div className="history-main"><strong>{entry.type === 'entrada' ? '+' : '-'}{entry.quantity} {itemsById[entry.itemId]?.unit || ''}</strong> {itemsById[entry.itemId]?.name || 'Item removido'} <span className="sub-note">{entry.notes}</span></div><span className="mono">{formatDate(entry.date)}</span></div>)}</div></section> : null}

        {screen === 'prices' ? <PricesPanel items={!priceFilter ? state.items : state.items.filter((item) => String(item.id) === priceFilter)} allItems={state.items} suppliers={state.suppliers} suppliersById={suppliersById} priceMap={priceMap} filter={priceFilter} onFilterChange={setPriceFilter} onSubmit={addPrice} /> : null}
        {screen === 'duration' ? <section><section className="panel"><div className="panel-head"><div><h3>Estimativa de duração</h3><p>Baseada no consumo semanal configurado</p></div></div>{vulnerableItems.length ? <div className="stack">{vulnerableItems.map((item) => <AlertCard key={item.id} tone="warn" title={`${item.name} nao chega ate a próxima compra`} text={`Duracao estimada de ${durationForItem(item)} dias.`} />)}</div> : <EmptyState text="Todos os itens configurados aguentam ate a próxima compra." />}</section><section className="panel"><div className="stack">{state.items.map((item) => { const days = durationForItem(item); const tone = days <= 7 ? 'danger' : days <= 21 ? 'warn' : 'success'; const width = Number.isFinite(days) ? Math.min(100, (days / 60) * 100) : 100; return <div className="duration-card" key={item.id}><div className="panel-head"><div><h3>{item.name}</h3><p>{item.quantity} {item.unit} em estoque, {item.weeklyConsumption || 0} {item.unit}/semana</p></div><Badge tone={tone}>{Number.isFinite(days) ? `${days} dias` : 'Sem consumo configurado'}</Badge></div><div className="progress duration"><span className={tone} style={{ width: `${width}%` }}></span></div></div>; })}</div></section></section> : null}
        {screen === 'reports' ? <ReportsPanel items={state.items} lowStockItems={lowStockItems} vulnerableItems={vulnerableItems} durationForItem={durationForItem} daysUntilNextPurchase={daysUntilNextPurchase} nextPurchaseDate={nextPurchaseDate} cycle={state.cycle} priceMap={priceMap} suppliersById={suppliersById} purchaseListDraft={purchaseListDraft} onPurchaseListDraftChange={setPurchaseListDraft} /> : null}
        {screen === 'consumption' ? <ConsumptionPanel items={state.items} /> : null}
        {screen === 'maintenance' ? <MaintenancePanel assets={state.maintenanceAssets} records={state.maintenanceRecords} suppliers={state.suppliers} onAddAsset={addMaintenanceAsset} onUpdateAsset={updateMaintenanceAsset} onDeleteAsset={deleteMaintenanceAsset} onAddRecord={addMaintenanceRecord} onDeleteRecord={deleteMaintenanceRecord} /> : null}
        {screen === 'inventory' ? <InventoryPanel assets={state.inventoryAssets} suppliers={state.suppliers} onAddAsset={addInventoryAsset} onUpdateAsset={updateInventoryAsset} onDeleteAsset={deleteInventoryAsset} /> : null}
        {screen === 'receipts' ? <ReceiptsPanel receipts={state.receipts} onAdd={addReceipt} onDelete={deleteReceipt} suppliersById={suppliersById} /> : null}
        {screen === 'suppliers' ? <SuppliersPanel suppliers={state.suppliers} priceHistory={state.priceHistory} extraPurchases={state.extraPurchases} onSubmit={addSupplier} onUpdate={updateSupplier} onDelete={deleteSupplier} /> : null}
        {screen === 'settings' ? <SettingsPanel state={state} nextPurchaseDate={nextPurchaseDate} onSaveCycle={updateCycle} onSaveSettings={saveSettings} onUpdateConsumption={updateConsumption} /> : null}
      </main>
    </div>
  );
}

function MovementForm({ title, items, onSubmit }) {
  const [form, setForm] = useState({ itemId: String(items[0]?.id || ''), quantity: 1, date: todayString(), notes: '' });
  const [usePackage, setUsePackage] = useState(false);
  const [packQty, setPackQty] = useState(1);
  const selectedItem = items.find((i) => String(i.id) === String(form.itemId));
  const hasPackage = selectedItem?.packUnit && Number(selectedItem?.packSize || 1) > 1;
  const packSize = Number(selectedItem?.packSize || 1);
  const packUnit = selectedItem?.packUnit || '';
  const baseUnit = selectedItem?.unit || '';
  const handleItemChange = (val) => { setForm({ ...form, itemId: val }); setUsePackage(false); setPackQty(1); };
  const handleSubmit = (event) => {
    event.preventDefault();
    const qty = usePackage && hasPackage ? packQty * packSize : Number(form.quantity);
    onSubmit({ itemId: Number(form.itemId), quantity: qty, date: form.date, notes: form.notes });
    setForm({ itemId: String(items[0]?.id || ''), quantity: 1, date: todayString(), notes: '' });
    setUsePackage(false); setPackQty(1);
  };
  return <section className="panel">
    <div className="panel-head"><div><h3>{title}</h3><p>Registro de movimentacao de estoque</p></div></div>
    <form className="form-grid" onSubmit={handleSubmit}>
      <Field label="Item"><SearchableSelect items={items} value={form.itemId} onChange={handleItemChange} placeholder="Digite para buscar item..." /></Field>
      {hasPackage ? <Field label="Modo de entrada"><div className="pack-toggle"><button type="button" className={!usePackage ? 'primary-button' : 'ghost-button'} onClick={() => setUsePackage(false)}>Por {baseUnit}</button><button type="button" className={usePackage ? 'primary-button' : 'ghost-button'} onClick={() => setUsePackage(true)}>Por {packUnit}</button></div></Field> : null}
      {usePackage && hasPackage
        ? <Field label={`Quantidade (${packUnit})`}><input type="number" min="1" step="1" value={packQty} onChange={(e) => setPackQty(Number(e.target.value) || 1)} /><div className="pack-preview">{packQty} {packUnit} = {packQty * packSize} {baseUnit}</div></Field>
        : <Field label={`Quantidade${hasPackage ? ` (${baseUnit})` : ''}`}><input type="number" min="0" step="any" value={form.quantity} onChange={(event) => setForm({ ...form, quantity: event.target.value })} /></Field>
      }
      <Field label="Data"><input type="date" value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} /></Field>
      <Field label="Observacao"><input value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></Field>
      <div className="actions-row"><button className="primary-button" type="submit">Salvar</button></div>
    </form>
  </section>;
}
function ExtraForm({ items, entries, onSubmit, itemsById, suppliers, suppliersById }) { const [form, setForm] = useState({ itemId: String(items[0]?.id || ''), quantity: 1, date: todayString(), cost: '', reason: '', supplierId: String(suppliers[0]?.id || ''), location: '' }); return <><section className="panel"><div className="panel-head"><div><h3>Registrar reposicao avulsa</h3><p>Compras fora do ciclo fixo com custo e motivo</p></div></div><form className="form-grid" onSubmit={(event) => { event.preventDefault(); onSubmit({ itemId: Number(form.itemId), quantity: Number(form.quantity), date: form.date, cost: Number(form.cost || 0), reason: form.reason, supplierId: Number(form.supplierId), location: '' }); setForm({ itemId: String(items[0]?.id || ''), quantity: 1, date: todayString(), cost: '', reason: '', supplierId: String(suppliers[0]?.id || ''), location: '' }); }}><Field label="Item"><SearchableSelect items={items} value={form.itemId} onChange={(val) => setForm({ ...form, itemId: val })} placeholder="Digite para buscar item..." /></Field><Field label="Quantidade"><input type="number" min="0" step="any" value={form.quantity} onChange={(event) => setForm({ ...form, quantity: event.target.value })} /></Field><Field label="Data"><input type="date" value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} /></Field><Field label="Custo"><input type="number" min="0" step="0.01" value={form.cost} onChange={(event) => setForm({ ...form, cost: event.target.value })} /></Field><Field label="Motivo"><input value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} /></Field><Field label="Fornecedor"><SearchableSelect items={suppliers} value={form.supplierId} onChange={(val) => setForm({ ...form, supplierId: val })} placeholder="Digite para buscar fornecedor..." /></Field><div className="actions-row"><button className="primary-button" type="submit">Salvar reposicao</button></div></form></section><section className="panel"><div className="panel-head"><div><h3>Histórico de reposições avulsas</h3><p>Compras fora do planejamento</p></div></div><div className="stack">{entries.map((entry) => <div className="entry-card" key={entry.id}><div><strong>{itemsById[entry.itemId]?.name || 'Item removido'}</strong><p>{entry.reason}</p></div><div className="entry-meta"><span>{entry.quantity} {itemsById[entry.itemId]?.unit || ''}</span><span>{currency(entry.cost)}</span><span>{formatDate(entry.date)}</span><span>{suppliersById[entry.supplierId]?.name || entry.location || 'Fornecedor nao informado'}</span></div></div>)}</div></section></>; }
// Helper: ordena por nome alfabeticamente
const sortByName = (arr) => [...arr].sort((a, b) => (a.name || '').localeCompare(b.name || '', 'pt-BR'));

// Select com busca integrada (digita para filtrar)
function SearchableSelect({ items, value, onChange, placeholder = 'Selecione...', labelFn }) {
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const sorted = sortByName(items);
  const filtered = search ? sorted.filter((i) => (labelFn ? labelFn(i) : i.name || '').toLowerCase().includes(search.toLowerCase())) : sorted;
  const selected = items.find((i) => String(i.id) === String(value));

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    const panel = ref.current?.closest('.panel');
    if (!panel) return undefined;
    const previousZIndex = panel.style.zIndex;
    panel.style.zIndex = open ? '12' : previousZIndex || '';
    return () => {
      panel.style.zIndex = previousZIndex;
    };
  }, [open]);

  return <div ref={ref} style={{ position: 'relative', zIndex: open ? 20 : 1 }}>
    <input
      value={open ? search : (selected ? (labelFn ? labelFn(selected) : selected.name) : '')}
      placeholder={placeholder}
      onFocus={() => { setOpen(true); setSearch(''); }}
      onClick={() => { setOpen(true); setSearch(''); }}
      onChange={(e) => setSearch(e.target.value)}
      style={{ width: '100%', padding: '11px 12px', borderRadius: '12px', border: '1px solid var(--line)', background: '#fff', color: 'var(--text)' }}
      autoComplete="off"
    />
    {open && <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, maxHeight: '200px', overflowY: 'auto', background: '#fff', border: '1px solid var(--line)', borderRadius: '0 0 12px 12px', zIndex: 50, boxShadow: 'var(--shadow)' }}>
      {filtered.length === 0 ? <div style={{ padding: '10px 12px', color: 'var(--muted)' }}>Nenhum resultado</div> : filtered.map((item) => (
        <div key={item.id} onMouseDown={(e) => { e.preventDefault(); onChange(String(item.id)); setOpen(false); setSearch(''); }}
          style={{ padding: '10px 12px', cursor: 'pointer', background: String(item.id) === String(value) ? 'var(--info-soft)' : 'transparent' }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--neutral-soft)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = String(item.id) === String(value) ? 'var(--info-soft)' : 'transparent'; }}>
          {labelFn ? labelFn(item) : item.name}
        </div>
      ))}
    </div>}
  </div>;
}

function ConfirmModal({ title, message, onConfirm, onCancel, confirmLabel = 'Confirmar', danger = false }) {
  return <div className="modal-overlay"><div className="modal-content" style={{ maxWidth: '420px' }}>
    <div className="panel-head"><div><h3>{title}</h3><p>{message}</p></div></div>
    <div className="actions-row">
      <button className="primary-button" type="button" style={danger ? { background: '#e74c3c' } : {}} onClick={onConfirm}>{confirmLabel}</button>
      <button className="ghost-button" type="button" onClick={onCancel}>Cancelar</button>
    </div>
  </div></div>;
}

function ItemsPanel({ items, movements, priceHistory, onAdd, onUpdate, onDelete }) {
  const emptyForm = { name: '', unit: 'un', quantity: 0, minStock: 1, weeklyConsumption: 0, packUnit: '', packSize: 1, brand: '', itemNotes: '' };
  const [addForm, setAddForm] = useState(emptyForm);
  const [editItem, setEditItem] = useState(null);
  const [pendingEditPayload, setPendingEditPayload] = useState(null);
  const [confirmDeleteItem, setConfirmDeleteItem] = useState(null);
  const [itemSearch, setItemSearch] = useState('');
  const handleAdd = (event) => {
    event.preventDefault();
    if (!addForm.name.trim()) return;
    onAdd({ name: addForm.name.trim(), unit: addForm.unit, quantity: Number(addForm.quantity || 0), minStock: Number(addForm.minStock || 1), weeklyConsumption: Number(addForm.weeklyConsumption || 0), packUnit: addForm.packUnit || '', packSize: Number(addForm.packSize || 1), brand: addForm.brand.trim(), itemNotes: addForm.itemNotes.trim() });
    setAddForm(emptyForm);
  };
  const handleEditSave = (event) => {
    event.preventDefault();
    if (!editItem?.name?.trim()) return;
    setPendingEditPayload({ id: editItem.id, name: editItem.name.trim(), unit: editItem.unit, quantity: Number(editItem.quantity || 0), minStock: Number(editItem.minStock || 1), weeklyConsumption: Number(editItem.weeklyConsumption || 0), packUnit: editItem.packUnit || '', packSize: Number(editItem.packSize || 1), brand: (editItem.brand || '').trim(), itemNotes: (editItem.itemNotes || '').trim() });
  };
  const confirmEdit = () => {
    onUpdate(pendingEditPayload.id, pendingEditPayload);
    setPendingEditPayload(null);
    setEditItem(null);
  };
  return <><section className="panel"><div className="panel-head"><div><h3>Cadastrar novo item</h3><p>Produtos monitorados no estoque do setor</p></div></div>
    <form className="form-grid" onSubmit={handleAdd}>
      <Field label="Nome do item"><input value={addForm.name} onChange={(e) => setAddForm({ ...addForm, name: e.target.value })} placeholder="Ex: Detergente, Papel toalha" required /></Field>
      <Field label="Unidade"><select value={addForm.unit} onChange={(e) => setAddForm({ ...addForm, unit: e.target.value })}>{UNIT_OPTIONS.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}</select></Field>
      <Field label="Quantidade atual"><input type="number" min="0" step="any" value={addForm.quantity} onChange={(e) => setAddForm({ ...addForm, quantity: e.target.value })} /></Field>
      <Field label="Estoque mínimo"><input type="number" min="0" step="1" value={addForm.minStock} onChange={(e) => setAddForm({ ...addForm, minStock: e.target.value })} /></Field>
      <Field label="Consumo semanal"><input type="number" min="0" step="any" value={addForm.weeklyConsumption} onChange={(e) => setAddForm({ ...addForm, weeklyConsumption: e.target.value })} /></Field>
      <Field label="Embalagem de compra"><select value={addForm.packUnit} onChange={(e) => { const pu = PACK_UNITS.find((p) => p.value === e.target.value); setAddForm({ ...addForm, packUnit: e.target.value, packSize: pu?.defaultSize - 1 }); }}>{PACK_UNITS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}</select></Field>
      {addForm.packUnit ? <Field label={`Qtd por ${addForm.packUnit}`}><input type="number" min="1" step="1" value={addForm.packSize} onChange={(e) => setAddForm({ ...addForm, packSize: e.target.value })} /></Field> : null}
      {addForm.packUnit && Number(addForm.packSize) > 0 ? <div className="pack-preview">1 {addForm.packUnit} = {addForm.packSize} {UNIT_MAP[addForm.unit]?.label?.split(' ')[0] || addForm.unit}</div> : null}
      <Field label="Marca preferida"><input value={addForm.brand} onChange={(e) => setAddForm({ ...addForm, brand: e.target.value })} placeholder="Ex: Ype, Neve, Brilhante..." /></Field>
      <Field label="Observações do item"><input value={addForm.itemNotes} onChange={(e) => setAddForm({ ...addForm, itemNotes: e.target.value })} placeholder="Ex: Comprar so na promocao, verificar validade..." /></Field>
      <div className="actions-row"><button className="primary-button" type="submit">Cadastrar item</button></div>
    </form></section>
    <section className="panel"><div className="panel-head"><div><h3>Itens cadastrados</h3><p>Lista completa do estoque monitorado</p></div><Badge tone="info">{items.length} item(ns)</Badge></div>
    <div style={{ marginBottom: '12px' }}><input value={itemSearch} onChange={(e) => setItemSearch(e.target.value)} placeholder="Buscar item por nome..." style={{ width: '100%', maxWidth: '400px', padding: '11px 12px', borderRadius: '12px', border: '1px solid var(--line)', background: '#fff' }} /></div>
    <div className="table-wrap"><table><thead><tr><th>Item</th><th>Unidade base</th><th>Quantidade</th><th>Embalagem</th><th>Minimo</th><th>Consumo/sem.</th><th>Acoes</th></tr></thead><tbody>{sortByName(items).filter((item) => !itemSearch || item.name.toLowerCase().includes(itemSearch.toLowerCase())).map((item) => {
      const packSz = Number(item.packSize || 1);
      const packLbl = item.packUnit && packSz > 1 ? `${item.packUnit} c/ ${packSz}` : '-';
  const qtyInPacks = item.packUnit && packSz > 1 ? ` (aprox. ${(Number(item.quantity || 0) / packSz).toFixed(1)} ${item.packUnit})` : '';
      return <tr key={item.id}><td><strong>{item.name}</strong>{item.brand ? <div className="sub-note">{item.brand}</div> : null}{item.itemNotes ? <div className="sub-note" style={{ fontStyle: 'italic' }}>{item.itemNotes}</div> : null}</td><td>{item.unit}</td><td>{item.quantity}{qtyInPacks ? <div className="sub-note">{qtyInPacks}</div> : null}</td><td>{packLbl}</td><td>{item.minStock}</td><td>{item.weeklyConsumption || '-'}</td><td><div className="table-actions"><button className="ghost-button" type="button" onClick={() => setEditItem({ id: item.id, name: item.name, unit: item.unit, quantity: item.quantity, minStock: item.minStock, weeklyConsumption: item.weeklyConsumption || 0, packUnit: item.packUnit || '', packSize: Number(item.packSize || 1), brand: item.brand || '', itemNotes: item.itemNotes || '' })}>Editar</button><button className="table-action" type="button" onClick={() => setConfirmDeleteItem(item)}>Excluir</button></div></td></tr>;
    })}</tbody></table></div></section>
    {editItem ? <div className="modal-overlay"><div className="modal-content">
      <div className="panel-head"><div><h3>Editar item</h3><p>Altere os dados e salve ou cancele.</p></div></div>
      <form className="form-grid" onSubmit={handleEditSave}>
        <Field label="Nome do item"><input value={editItem.name} onChange={(e) => setEditItem({ ...editItem, name: e.target.value })} required /></Field>
        <Field label="Unidade"><select value={editItem.unit} onChange={(e) => setEditItem({ ...editItem, unit: e.target.value })}>{UNIT_OPTIONS.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}</select></Field>
        <Field label="Quantidade atual"><input type="number" min="0" step="any" value={editItem.quantity} onChange={(e) => setEditItem({ ...editItem, quantity: e.target.value })} /></Field>
        <Field label="Estoque mínimo"><input type="number" min="0" step="1" value={editItem.minStock} onChange={(e) => setEditItem({ ...editItem, minStock: e.target.value })} /></Field>
        <Field label="Consumo semanal"><input type="number" min="0" step="any" value={editItem.weeklyConsumption} onChange={(e) => setEditItem({ ...editItem, weeklyConsumption: e.target.value })} /></Field>
        <Field label="Embalagem de compra"><select value={editItem.packUnit || ''} onChange={(e) => { const pu = PACK_UNITS.find((p) => p.value === e.target.value); setEditItem({ ...editItem, packUnit: e.target.value, packSize: pu?.defaultSize - 1 }); }}>{PACK_UNITS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}</select></Field>
        {editItem.packUnit ? <Field label={`Qtd por ${editItem.packUnit}`}><input type="number" min="1" step="1" value={editItem.packSize || 1} onChange={(e) => setEditItem({ ...editItem, packSize: e.target.value })} /></Field> : null}
        {editItem.packUnit && Number(editItem.packSize) > 0 ? <div className="pack-preview">1 {editItem.packUnit} = {editItem.packSize} {UNIT_MAP[editItem.unit]?.label?.split(' ')[0] || editItem.unit} &bull; Estoque: {Number(editItem.quantity || 0)} {editItem.unit} &asymp; {(Number(editItem.quantity || 0) / Number(editItem.packSize || 1)).toFixed(1)} {editItem.packUnit}(s)</div> : null}
        <Field label="Marca preferida"><input value={editItem.brand || ''} onChange={(e) => setEditItem({ ...editItem, brand: e.target.value })} placeholder="Ex: Ype, Neve..." /></Field>
        <Field label="Observações do item"><input value={editItem.itemNotes || ''} onChange={(e) => setEditItem({ ...editItem, itemNotes: e.target.value })} placeholder="Ex: Verificar validade" /></Field>
        <div className="actions-row"><button className="primary-button" type="submit">Salvar alteracoes</button><button className="ghost-button" type="button" onClick={() => setEditItem(null)}>Cancelar</button></div>
      </form>
    </div></div> : null}
    {pendingEditPayload ? <ConfirmModal title="Confirmar alteracoes" message={`Deseja salvar as alteracoes no item "${pendingEditPayload.name}"?`} confirmLabel="Salvar alteracoes" onConfirm={confirmEdit} onCancel={() => setPendingEditPayload(null)} /> : null}
    {confirmDeleteItem ? <ConfirmModal title="Excluir item" message={`Deseja excluir o item "${confirmDeleteItem.name}"? Esta acao nao pode ser desfeita.`} confirmLabel="Excluir" danger onConfirm={() => { onDelete(confirmDeleteItem.id); setConfirmDeleteItem(null); }} onCancel={() => setConfirmDeleteItem(null)} /> : null}
  </>;
}

function ReaderPanel({ state, items, suppliers, onAnalyze, onConfirm, onDraftChange, onSupplierChange, onAccessKeyChange, onAttachmentChange, onAddSupplier, onReset }) {
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [confirmImportOpen, setConfirmImportOpen] = useState(false);
  const updateDraftItem = (id, field, value) => {
    const next = (state.draftItems || []).map((entry) => {
      if (entry.id !== id) return entry;
      if (field === 'matchedItemId') {
        const matched = items.find((item) => item.id === Number(value));
        const autoMatch = !value ? findExistingItemMatch(entry.nome, items, entry.unidade) : null;
        return {
          ...entry,
          matchedItemId: value,
          item_cadastrado: matched ? matched.name : null,
          matchConfidence: matched ? 1 : Number(autoMatch?.score || 0),
          matchReason: matched ? 'selecionado manualmente' : (autoMatch?.reason || ''),
        };
      }
      if ((field === 'nome' || field === 'unidade') && !entry.matchedItemId) {
        const nextEntry = { ...entry, [field]: value };
        const autoMatch = findExistingItemMatch(nextEntry.nome, items, nextEntry.unidade);
        return {
          ...nextEntry,
          item_cadastrado: autoMatch?.item?.name || null,
          matchedItemId: autoMatch?.item?.id ? String(autoMatch.item.id) : '',
          matchConfidence: Number(autoMatch?.score || 0),
          matchReason: autoMatch?.reason || '',
        };
      }
      return { ...entry, [field]: value };
    });
    onDraftChange(next);
  };
  const removeDraftItem = (id) => onDraftChange((state.draftItems || []).filter((entry) => entry.id !== id));
  const importItems = (state.draftItems || []).filter((entry) => entry.include && entry.nome);
  const importCount = importItems.length;
  const importProductsTotal = importItems.reduce((sum, entry) => sum + Number(entry.total_linha_xml || computeLineTotal(entry.quantidade, entry.preco_unitario)), 0);
  const receiptTotal = Number(state.parsed?.total || 0);
  const xmlProductsTotal = Number(state.parsed?.totals?.products || 0);
  const xmlDiscountTotal = Number(state.parsed?.totals?.discount || 0);
  const xmlFreightTotal = Number(state.parsed?.totals?.freight || 0);
  const xmlOtherTotal = Number(state.parsed?.totals?.other || 0);
  const xmlInsuranceTotal = Number(state.parsed?.totals?.insurance || 0);
  const xmlIpiTotal = Number(state.parsed?.totals?.ipi || 0);
  const productsReferenceTotal = xmlProductsTotal || importProductsTotal;
  const totalDiff = productsReferenceTotal ? Math.abs(productsReferenceTotal - importProductsTotal) : 0;
  const finalDocumentDiff = receiptTotal ? Math.abs(receiptTotal - importProductsTotal) : 0;
  const xmlNetAdjustments = Number((xmlFreightTotal + xmlInsuranceTotal + xmlIpiTotal + xmlOtherTotal - xmlDiscountTotal).toFixed(2));
  const diffTone = totalDiff <= 0.5 ? 'success' : totalDiff <= 5 ? 'warn' : 'danger';
  const modeLabel = state.parsed?.sourceMode === 'xml' ? 'XML fiscal' : state.parsed?.sourceMode === 'pdf-texto' ? 'PDF texto' : 'OCR de cupom';
  return <>
    <section className="panel">
      <div className="panel-head">
        <div>
          <h3>Entrada por XML, chave ou comprovante</h3>
          <p>Fluxo guiado para importar com mais precisão e arquivar os documentos do lançamento.</p>
        </div>
        <div className="actions-row">
          <button className="primary-button" type="button" onClick={() => setIsUploadModalOpen(true)}>Anexar XML e PDF</button>
          <button className="ghost-button" type="button" onClick={() => window.open(TO_NFCE_CONSULT_URL, '_blank', 'noopener,noreferrer')}>Consultar NF-e na SEFAZ-TO</button>
        </div>
      </div>
      <div className="alert-card success">
        <strong>Melhor prática</strong>
        <p>Use o XML fiscal para importar com precisão e anexe o PDF do comprovante para auditoria. Se não houver XML, o sistema ainda aceita PDF/imagem como contingência.</p>
      </div>
      {state.fileName || state.companionFileName ? <div className="reader-summary" style={{ marginTop: '12px' }}>
        {state.fileName ? <Badge tone={state.fileMimeType?.includes('xml') ? 'success' : 'warn'}>Principal: {state.fileName}</Badge> : null}
        {state.companionFileName ? <Badge tone="info">Comprovante anexo: {state.companionFileName}</Badge> : null}
        {state.parsed ? <Badge tone={state.parsed?.sourceMode === 'xml' ? 'success' : 'warn'}>Leitura pronta</Badge> : null}
      </div> : null}
      {state.preview ? <div className="preview-shell" style={{ marginTop: '12px' }}><img className="preview" src={state.preview} alt="Preview do comprovante" /></div> : null}
      {state.preview || state.draftItems?.length || state.fileName || state.companionFileName ? <div className="actions-row" style={{ marginTop: '12px', justifyContent: 'flex-end' }}>
        <button className="ghost-button" type="button" onClick={onReset}>Limpar leitura</button>
      </div> : null}
      {state.error ? <p className="error-text">{state.error}</p> : null}
    </section>

    {isUploadModalOpen ? <div className="modal-overlay" onClick={() => setIsUploadModalOpen(false)}>
      <div className="modal-content" style={{ maxWidth: '760px' }} onClick={(event) => event.stopPropagation()}>
        <div className="panel-head">
          <div>
            <h3>Arquivos da entrada</h3>
            <p>Separe o documento fiscal estruturado do comprovante visual para manter o processo mais confiável.</p>
          </div>
          <button className="ghost-button" type="button" onClick={() => setIsUploadModalOpen(false)}>Fechar</button>
        </div>
        <div className="form-grid" style={{ marginTop: '1rem' }}>
          <Field label="1. XML fiscal (preferencial)">
            <div className="dropzone" style={{ padding: '18px', minHeight: 'auto', borderColor: 'rgba(32, 126, 82, 0.28)', background: '#f4fbf7' }}>
              <input type="file" accept=".xml,text/xml,application/xml" onChange={(event) => { const file = event.target.files?.[0]; if (file) onAnalyze(file); }} />
              <strong>{state.fileMimeType?.includes('xml') ? state.fileName : 'Selecionar XML fiscal'}</strong>
              <p>Obrigatório para a importação mais precisa de itens, quantidades, valores e chave.</p>
            </div>
          </Field>
          <Field label="2. PDF ou imagem do comprovante (recomendado)">
            <div className="dropzone" style={{ padding: '18px', minHeight: 'auto' }}>
              <input type="file" accept="image/*,.pdf,application/pdf" onChange={(event) => onAttachmentChange(event.target.files?.[0] || null)} />
              <strong>{state.companionFileName || 'Selecionar PDF ou imagem do comprovante'}</strong>
              <p>Fica arquivado no módulo de comprovantes para conferência visual e auditoria.</p>
            </div>
          </Field>
        </div>
        <div className="alert-card info" style={{ marginTop: '1rem' }}>
          <strong>Sem XML?</strong>
          <p>Se você só tiver o comprovante, ainda pode importar usando PDF ou imagem como contingência. Nesse caso, selecione o comprovante como arquivo principal abaixo.</p>
        </div>
        <div className="actions-row" style={{ marginTop: '12px' }}>
          <label className="ghost-button" style={{ cursor: 'pointer' }}>
            <input type="file" accept="image/*,.pdf,application/pdf" style={{ display: 'none' }} onChange={(event) => { const file = event.target.files?.[0]; if (file) onAnalyze(file); }} />
            Usar PDF/imagem como principal
          </label>
          {state.fileName ? <button className="primary-button" type="button" onClick={() => setIsUploadModalOpen(false)}>Continuar para conferência</button> : <button className="primary-button" type="button" disabled>Selecione um arquivo principal</button>}
        </div>
      </div>
    </div> : null}

    {state.parsed ? <section className="panel">
      <div className="panel-head">
        <div>
          <h3>Conferencia da entrada</h3>
          <p>{state.parsed.mercado || 'Emitente nao identificado'} em {formatDate(state.parsed.data || todayString())} - origem {modeLabel}. Revise antes de importar.</p>
        </div>
        <div className="reader-summary">
          <Badge tone={state.parsed?.sourceMode === 'xml' ? 'success' : 'info'}>{modeLabel}</Badge>
          <Badge tone="info">{importCount} item(ns)</Badge>
          <Badge tone="neutral">Soma dos produtos selecionados {currency(importProductsTotal)}</Badge>
          {state.companionFileName ? <Badge tone="info">Anexo complementar: {state.companionFileName}</Badge> : null}
          {receiptTotal ? <Badge tone={diffTone}>Total final da NF/XML {currency(receiptTotal)}</Badge> : null}
        </div>
      </div>

      <div className="form-grid" style={{ marginBottom: '14px' }}>
        <Field label="Fornecedor">
          <select value={state.supplierId || ''} onChange={(event) => onSupplierChange(event.target.value)}>
            <option value="">Fornecedor nao informado</option>
            {suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
          </select>
          {!state.supplierId && state.parsed?.mercado && state.parsed.mercado !== 'Emitente nao identificado' ? <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '6px' }}>
            <Badge tone="info">Emitente: {state.parsed.mercado}</Badge>
            <button className="ghost-button" type="button" style={{ fontSize: '12px', padding: '2px 8px' }} onClick={() => {
              onAddSupplier({ name: state.parsed.mercado, tradeName: '', type: 'mercado', city: '', state: 'TO', cnpj: state.parsed.cnpj || '', notes: 'Cadastrado automaticamente via importacao de NF', active: true });
            }}>
              Cadastrar fornecedor
            </button>
          </div> : null}
        </Field>
        <Field label="Chave de acesso">
          <input value={state.accessKey || state.parsed?.accessKey || ''} onChange={(event) => onAccessKeyChange(event.target.value)} placeholder="Cole ou confirme a chave de acesso" />
        </Field>
      </div>

      <div className="reader-summary" style={{ marginBottom: '14px' }}>
        {state.parsed?.accessKeySource ? <Badge tone={state.parsed.accessKeyValid ? (state.parsed.accessKeySource === 'QR Code' ? 'success' : 'warn') : 'danger'}>Chave via {state.parsed.accessKeySource}{state.parsed.accessKeyValid ? '' : ' (nao validada)'}</Badge> : null}
        {!state.parsed?.accessKeyValid && state.parsed?.accessKeyCandidates?.length ? <Badge tone="neutral">Candidata: {state.parsed.accessKeyCandidates[0]}</Badge> : null}
      </div>

      {receiptTotal ? <div className="total-audit total-audit-card">
        <div><strong>Total dos produtos no XML:</strong><span>{currency(productsReferenceTotal)}</span></div>
        <div><strong>Total dos produtos selecionados:</strong><span>{currency(importProductsTotal)}</span></div>
        <div><strong>Diferenca dos produtos:</strong><span className={totalDiff <= 0.5 ? 'audit-good' : totalDiff <= 5 ? 'audit-warn' : 'audit-bad'}>{currency(totalDiff)}</span></div>
        <div><strong>Desconto informado na NF:</strong><span className={xmlDiscountTotal > 0 ? 'audit-good' : ''}>{xmlDiscountTotal > 0 ? `- ${currency(xmlDiscountTotal)}` : currency(0)}</span></div>
        <div><strong>Frete:</strong><span className={xmlFreightTotal > 0 ? 'audit-warn' : ''}>{xmlFreightTotal > 0 ? `+ ${currency(xmlFreightTotal)}` : currency(0)}</span></div>
        <div><strong>Seguro:</strong><span className={xmlInsuranceTotal > 0 ? 'audit-warn' : ''}>{xmlInsuranceTotal > 0 ? `+ ${currency(xmlInsuranceTotal)}` : currency(0)}</span></div>
        <div><strong>IPI:</strong><span className={xmlIpiTotal > 0 ? 'audit-warn' : ''}>{xmlIpiTotal > 0 ? `+ ${currency(xmlIpiTotal)}` : currency(0)}</span></div>
        <div><strong>Outros ajustes:</strong><span className={xmlOtherTotal > 0 ? 'audit-warn' : ''}>{xmlOtherTotal > 0 ? `+ ${currency(xmlOtherTotal)}` : currency(0)}</span></div>
        <div><strong>Ajuste liquido da NF:</strong><span className={Math.abs(xmlNetAdjustments) <= 0.5 ? 'audit-good' : xmlNetAdjustments < 0 ? 'audit-good' : 'audit-warn'}>{xmlNetAdjustments < 0 ? `- ${currency(Math.abs(xmlNetAdjustments))}` : `+ ${currency(xmlNetAdjustments)}`}</span></div>
        <div><strong>Total final da NF:</strong><span>{currency(receiptTotal)}</span></div>
        <div><strong>Diferenca entre total final e itens selecionados:</strong><span className={finalDocumentDiff <= 0.5 ? 'audit-good' : 'audit-warn'}>{currency(finalDocumentDiff)}</span></div>
        <p>Na maioria dos casos, essa diferença nao e erro: ela costuma ser composta por desconto, frete, seguro, IPI ou outros ajustes fiscais do XML. Para validar a importação dos itens, compare primeiro a diferenca dos produtos; para validar o fechamento da nota, confira a composicao dos ajustes acima.</p>
      </div> : null}

      <div className="actions-row" style={{ marginBottom: '14px' }}>
        {state.queryUrl || state.parsed?.queryUrl ? <button className="ghost-button" type="button" onClick={() => window.open(state.queryUrl || state.parsed?.queryUrl, '_blank', 'noopener,noreferrer')}>Abrir consulta da NFC-e</button> : null}
        <button className="ghost-button" type="button" onClick={() => openToNfcePortalWithKey(state.accessKey || state.parsed?.accessKey || '')}>Consultar por chave na SEFAZ-TO</button>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Importar</th>
              <th>Item lido</th>
              <th>Vincular a item cadastrado</th>
              <th>Qtd</th>
              <th>Unidade</th>
              <th>Valor unit.</th>
              <th>Total linha</th>
              <th>Confianca</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {(state.draftItems || []).map((entry) => {
              const lineTotal = Number(entry.total_linha_xml || computeLineTotal(entry.quantidade, entry.preco_unitario));
              const matchTone = entry.matchedItemId ? (Number(entry.matchConfidence || 0) >= 0.8 ? 'success' : Number(entry.matchConfidence || 0) >= 0.55 ? 'warn' : 'neutral') : 'neutral';
              return <tr key={entry.id}>
                <td><input type="checkbox" checked={entry.include} onChange={(event) => updateDraftItem(entry.id, 'include', event.target.checked)} /></td>
                <td><div className="ocr-cell"><input value={entry.nome} onChange={(event) => updateDraftItem(entry.id, 'nome', event.target.value)} />{entry.rawLine ? <small>{entry.rawLine}</small> : null}</div></td>
                <td><div className="ocr-cell"><select value={entry.matchedItemId || ''} onChange={(event) => updateDraftItem(entry.id, 'matchedItemId', event.target.value)}><option value="">Criar como novo item</option>{sortByName(items).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>{entry.matchedItemId ? <small><Badge tone={matchTone}>Vinculo inteligente {Math.round(Number(entry.matchConfidence || 0) * 100)}%</Badge>{entry.matchReason ? ` - ${entry.matchReason}` : ''}</small> : <small>Nenhum item semelhante foi confirmado com seguranca.</small>}</div></td>
                <td><input type="number" min="0" step="0.01" value={entry.quantidade} onChange={(event) => updateDraftItem(entry.id, 'quantidade', Number(event.target.value))} /></td>
                <td><select className="unit-select" value={normalizeUnit(entry.unidade || 'un')} onChange={(event) => updateDraftItem(entry.id, 'unidade', event.target.value)} title={UNIT_MAP[normalizeUnit(entry.unidade || 'un')]?.label || normalizeUnit(entry.unidade || 'un')}>{UNIT_OPTIONS.map((unit) => <option key={unit.value} value={unit.value}>{formatUnitLabel(unit.value)}</option>)}</select></td>
                <td><input type="number" min="0" step="0.01" value={entry.preco_unitario} onChange={(event) => updateDraftItem(entry.id, 'preco_unitario', Number(event.target.value))} /></td>
                <td>{currency(lineTotal)}</td>
                <td><Badge tone={entry.confidence >= 0.95 ? 'success' : entry.confidence >= 0.5 ? 'warn' : 'danger'}>{Math.round(Number(entry.confidence || 0) * 100)}%</Badge></td>
                <td><button className="table-action" onClick={() => removeDraftItem(entry.id)}>Excluir</button></td>
              </tr>;
            })}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan="5">
                <strong>Resumo da importacao selecionada</strong>
                <div className="sub-note">Totalizando apenas os itens marcados para importar.</div>
              </td>
              <td><strong>{importCount} item(ns)</strong></td>
              <td><strong>{currency(importProductsTotal)}</strong></td>
              <td><Badge tone={diffTone}>{currency(totalDiff)}</Badge></td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="alert-card info" style={{ marginTop: '16px' }}>
        <strong>Finalizar importação</strong>
        <p>Confira fornecedor, chave, itens, unidades e totais. Quando tudo estiver validado, confirme a entrada da nota fiscal ao final desta revisão.</p>
      </div>

      <div className="actions-row" style={{ marginTop: '14px', justifyContent: 'space-between', alignItems: 'center' }}>
        <span className="sub-note">A confirmação vai registrar a entrada no estoque, histórico de preços e comprovantes vinculados.</span>
        <button className="primary-button" type="button" disabled={!importCount} onClick={() => setConfirmImportOpen(true)}>
          Confirmar importação
        </button>
      </div>
    </section> : null}

    {confirmImportOpen ? <ConfirmModal
      title="Confirmar entrada da nota fiscal"
      message={`Você conferiu os itens, valores, fornecedor e chave da nota fiscal? Ao prosseguir, serão registrados ${importCount} item(ns), a movimentação de estoque e os comprovantes anexados.`}
      confirmLabel="Prosseguir com a entrada"
      onConfirm={() => {
        setConfirmImportOpen(false);
        onConfirm();
      }}
      onCancel={() => setConfirmImportOpen(false)}
    /> : null}
  </>;
}

function PricesPanel({ items, allItems, suppliers, suppliersById, priceMap, filter, onFilterChange, onSubmit }) { const [form, setForm] = useState({ itemId: String(allItems[0]?.id || ''), supplierId: String(suppliers[0]?.id || ''), price: '', date: todayString() }); return <><section className="panel"><div className="panel-head"><div><h3>Histórico de precos</h3><p>Comparativo por item e por fornecedor</p></div><select value={filter} onChange={(event) => onFilterChange(event.target.value)}><option value="">Todos</option>{allItems.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div><div className="stack">{items.map((item) => { const entries = priceMap[item.id] || []; if (!entries.length) return <div className="entry-card" key={item.id}><div><strong>{item.name}</strong><p>Sem historico de precos.</p></div></div>; const latest = entries.at(-1); const previous = entries.length > 1 ? entries.at(-2) : null; const best = [...entries].sort((a, b) => a.price - b.price)[0]; const variation = previous ? ((latest.price - previous.price) / previous.price) * 100 : null; return <div className="entry-card" key={item.id}><div><strong>{item.name}</strong><p>Ultimo preco: {currency(latest.price)} em {suppliersById[latest.supplierId]?.name || latest.market}</p></div><div className="entry-meta">{variation !== null ? <Badge tone={variation > 0 ? 'warn' : variation < 0 ? 'success' : 'neutral'}>{variation > 0 ? 'Alta' : variation < 0 ? 'Queda' : 'Estavel'} {Math.abs(variation).toFixed(1)}%</Badge> : null}<Badge tone="success">Melhor fornecedor: {suppliersById[best.supplierId]?.name || best.market}</Badge></div></div>; })}</div></section><section className="panel"><div className="panel-head"><div><h3>Adicionar preco manual</h3><p>Entrada complementar alem do leitor automatico</p></div></div><form className="form-grid" onSubmit={(event) => { event.preventDefault(); onSubmit({ itemId: Number(form.itemId), supplierId: Number(form.supplierId), price: Number(form.price), date: form.date }); setForm({ itemId: String(allItems[0]?.id || ''), supplierId: String(suppliers[0]?.id || ''), price: '', date: todayString() }); }}><Field label="Item"><select value={form.itemId} onChange={(event) => setForm({ ...form, itemId: event.target.value })}>{allItems.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field><Field label="Fornecedor"><SearchableSelect items={suppliers} value={form.supplierId} onChange={(val) => setForm({ ...form, supplierId: val })} placeholder="Digite para buscar fornecedor..." /></Field><Field label="Preco unitario"><input type="number" min="0" step="0.01" value={form.price} onChange={(event) => setForm({ ...form, price: event.target.value })} /></Field><Field label="Data"><input type="date" value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} /></Field><div className="actions-row"><button className="primary-button" type="submit">Salvar preco</button></div></form></section></>; }
const SUPPLIER_TYPES = [
  { group: 'Comércio / Produtos', options: [
    { value: 'mercado',       label: 'Mercado / Supermercado' },
    { value: 'atacado',       label: 'Atacado / Atacarejo' },
    { value: 'distribuidor',  label: 'Distribuidora' },
    { value: 'acougue',       label: 'Açougue / Frigorífico' },
    { value: 'farmacia',      label: 'Farmacia / Drogaria' },
    { value: 'padaria',       label: 'Padaria / Confeitaria' },
    { value: 'hortifruti',    label: 'Hortifruti / Verdureiro' },
    { value: 'loja_material', label: 'Loja de Materiais / Construção' },
    { value: 'papelaria',     label: 'Papelaria / Escritório' },
    { value: 'pet',           label: 'Pet Shop' },
  ]},
  { group: 'Prestadores de Serviço', options: [
    { value: 'prestador',     label: 'Prestador de Serviço (geral)' },
    { value: 'eletricista',   label: 'Eletricista' },
    { value: 'encanador',     label: 'Encanador / Hidráulica' },
    { value: 'pintor',        label: 'Pintor / Pinturas prediais' },
    { value: 'manut_ac',      label: 'Manutenção de Ar Condicionado' },
    { value: 'manut_predial', label: 'Manutenção Predial / Conservação' },
    { value: 'dedetizadora',  label: 'Dedetizadora / Controle de Pragas' },
    { value: 'jardinagem',    label: 'Jardinagem / Paisagismo / Grama' },
    { value: 'piscina',       label: 'Limpeza de Piscina' },
    { value: 'limpeza',       label: 'Empresa de Limpeza' },
    { value: 'impressora',    label: 'Técnico de Impressoras / TI' },
    { value: 'seguranca',     label: 'Seguranca / Monitoramento' },
    { value: 'transporte',    label: 'Transporte / Logística' },
    { value: 'grafica',       label: 'Gráfica / Comunicação Visual' },
    { value: 'contábilidade', label: 'Contabilidade / Assessoria' },
  ]},
  { group: 'Outros', options: [
    { value: 'outro', label: 'Outro' },
  ]},
];
const supplierTypeLabel = (value) => {
  for (const group of SUPPLIER_TYPES) {
    const found = group.options.find((o) => o.value === value);
    if (found) return found.label;
  }
  return value || '-';
};

function SuppliersPanel({ suppliers, priceHistory, extraPurchases, onSubmit, onUpdate, onDelete }) {
  const emptyAddForm = { name: '', tradeName: '', type: 'mercado', city: '', state: 'SP', cnpj: '', notes: '' };
  const emptyEditModal = { open: false, id: null, name: '', tradeName: '', type: 'mercado', city: '', state: 'SP', cnpj: '', notes: '' };
  const [addForm, setAddForm] = useState(emptyAddForm);
  const [editModal, setEditModal] = useState(emptyEditModal);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [pendingUpdatePayload, setPendingUpdatePayload] = useState(null);
  const supplierUsage = suppliers.reduce((acc, supplier) => {
    acc[supplier.id] = {
      prices: priceHistory.filter((entry) => entry.supplierId === supplier.id).length,
      extras: extraPurchases.filter((entry) => entry.supplierId === supplier.id).length
    };
    return acc;
  }, {});
  const closeEditModal = () => setEditModal(emptyEditModal);
  return <>
    {editModal.open && <div className="modal-overlay"><div className="modal-content">
      <div className="panel-head"><div><h3>Editar fornecedor</h3><p>Atualize os dados do fornecedor selecionado</p></div><button className="ghost-button" type="button" onClick={closeEditModal}>Fechar</button></div>
      <form className="form-grid" onSubmit={(event) => { event.preventDefault(); if (!editModal.name.trim()) return; const payload = { name: editModal.name.trim(), tradeName: editModal.tradeName.trim(), type: editModal.type, city: editModal.city.trim(), state: editModal.state.trim().toUpperCase(), cnpj: editModal.cnpj.trim(), notes: editModal.notes.trim(), active: true }; setPendingUpdatePayload({ id: editModal.id, payload }); }}>
        <Field label="Nome"><input value={editModal.name} onChange={(e) => setEditModal({ ...editModal, name: e.target.value })} /></Field>
        <Field label="Nome fantasia"><input value={editModal.tradeName} onChange={(e) => setEditModal({ ...editModal, tradeName: e.target.value })} /></Field>
        <Field label="Tipo"><select value={editModal.type} onChange={(e) => setEditModal({ ...editModal, type: e.target.value })}>{SUPPLIER_TYPES.map((group) => <optgroup key={group.group} label={group.group}>{group.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</optgroup>)}</select></Field>
        <Field label="Cidade"><input value={editModal.city} onChange={(e) => setEditModal({ ...editModal, city: e.target.value })} /></Field>
        <Field label="UF"><input maxLength="2" value={editModal.state} onChange={(e) => setEditModal({ ...editModal, state: e.target.value })} /></Field>
        <Field label="CNPJ"><input value={editModal.cnpj} onChange={(e) => setEditModal({ ...editModal, cnpj: e.target.value })} /></Field>
        <Field label="Observações"><input value={editModal.notes} onChange={(e) => setEditModal({ ...editModal, notes: e.target.value })} /></Field>
        <div className="actions-row"><button className="primary-button" type="submit">Salvar alteracoes</button><button className="ghost-button" type="button" onClick={closeEditModal}>Cancelar</button></div>
      </form>
    </div></div>}
    <section className="panel"><div className="panel-head"><div><h3>Cadastro de fornecedores</h3><p>Padronize os locais de compra para usar em reposições, precos e leitor de NF</p></div></div>
      <form className="form-grid" onSubmit={(event) => { event.preventDefault(); if (!addForm.name.trim()) return; const payload = { name: addForm.name.trim(), tradeName: addForm.tradeName.trim(), type: addForm.type, city: addForm.city.trim(), state: addForm.state.trim().toUpperCase(), cnpj: addForm.cnpj.trim(), notes: addForm.notes.trim(), active: true }; onSubmit(payload); setAddForm(emptyAddForm); }}>
        <Field label="Nome"><input value={addForm.name} onChange={(e) => setAddForm({ ...addForm, name: e.target.value })} /></Field>
        <Field label="Nome fantasia"><input value={addForm.tradeName} onChange={(e) => setAddForm({ ...addForm, tradeName: e.target.value })} /></Field>
        <Field label="Tipo"><select value={addForm.type} onChange={(e) => setAddForm({ ...addForm, type: e.target.value })}>{SUPPLIER_TYPES.map((group) => <optgroup key={group.group} label={group.group}>{group.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</optgroup>)}</select></Field>
        <Field label="Cidade"><input value={addForm.city} onChange={(e) => setAddForm({ ...addForm, city: e.target.value })} /></Field>
        <Field label="UF"><input maxLength="2" value={addForm.state} onChange={(e) => setAddForm({ ...addForm, state: e.target.value })} /></Field>
        <Field label="CNPJ"><input value={addForm.cnpj} onChange={(e) => setAddForm({ ...addForm, cnpj: e.target.value })} /></Field>
        <Field label="Observações"><input value={addForm.notes} onChange={(e) => setAddForm({ ...addForm, notes: e.target.value })} /></Field>
        <div className="actions-row"><button className="primary-button" type="submit">Cadastrar fornecedor</button></div>
      </form>
    </section>
    <section className="panel"><div className="panel-head"><div><h3>Fornecedores cadastrados</h3><p>Lista padronizada para selecao em todo o sistema</p></div><Badge tone="info">{suppliers.length} fornecedor(es)</Badge></div>
      <div className="table-wrap"><table><thead><tr><th>Nome</th><th>Tipo</th><th>Cidade/UF</th><th>CNPJ</th><th>Uso</th><th>Status</th><th>Observações</th><th>Acoes</th></tr></thead>
        <tbody>{suppliers.map((supplier) => { const usage = supplierUsage[supplier.id] || { prices: 0, extras: 0 }; const usageCount = usage.prices + usage.extras; return <tr key={supplier.id}><td><strong>{supplier.name}</strong>{supplier.tradeName ? <div className="sub-note">{supplier.tradeName}</div> : null}</td><td><span title={supplier.type}>{supplierTypeLabel(supplier.type)}</span></td><td>{[supplier.city, supplier.state].filter(Boolean).join('/') || '-'}</td><td>{supplier.cnpj || '-'}</td><td>{usageCount ? `${usage.prices} preco(s) / ${usage.extras} reposicao(oes)` : 'Sem uso'}</td><td><Badge tone={supplier.active ? 'success' : 'neutral'}>{supplier.active ? 'Ativo' : 'Inativo'}</Badge></td><td>{supplier.notes || '-'}</td><td><div className="table-actions"><button className="ghost-button" type="button" onClick={() => setEditModal({ open: true, id: supplier.id, name: supplier.name || '', tradeName: supplier.tradeName || '', type: supplier.type || 'mercado', city: supplier.city || '', state: supplier.state || 'SP', cnpj: supplier.cnpj || '', notes: supplier.notes || '' })}>Editar</button><button className="table-action" type="button" onClick={() => setConfirmDeleteId(supplier.id)}>Excluir</button></div></td></tr>; })}</tbody>
      </table></div>
    </section>
    {confirmDeleteId !== null && <ConfirmModal title="Excluir fornecedor" message="Esta acao nao pode ser desfeita. Deseja excluir este fornecedor?" confirmLabel="Excluir" danger onConfirm={() => { onDelete(confirmDeleteId); setConfirmDeleteId(null); }} onCancel={() => setConfirmDeleteId(null)} />}
    {pendingUpdatePayload && <ConfirmModal title="Salvar alteracoes" message="Confirma as alteracoes feitas neste fornecedor?" confirmLabel="Salvar" onConfirm={() => { onUpdate(pendingUpdatePayload.id, pendingUpdatePayload.payload); setPendingUpdatePayload(null); closeEditModal(); }} onCancel={() => setPendingUpdatePayload(null)} />}
  </>; }
// Mascara de valor em real: digita "12345" e exibe "R$ 123,45"
const formatBrlInput = (raw) => {
  const digits = String(raw).replace(/\D/g, '');
  if (!digits) return '';
  const cents = parseInt(digits, 10);
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
};
const parseBrlInput = (formatted) => {
  const digits = String(formatted).replace(/\D/g, '');
  if (!digits) return 0;
  return parseInt(digits, 10) / 100;
};
const normalizeMoneyValue = (value) => {
  if (typeof value === 'number') return value;
  const raw = String(value || '').trim();
  if (!raw) return 0;
  if (raw.includes('R$') || raw.includes(',')) return parseBrlInput(raw);
  return Number(raw) || 0;
};
const formatMoneyForInput = (value) => {
  const amount = Number(value || 0);
  if (!amount) return '';
  return formatBrlInput(Math.round(amount * 100));
};
function ReceiptsPanel({ receipts, onAdd, onDelete, suppliersById }) {
  const [form, setForm] = useState({ title: '', valueDisplay: '', valueRaw: '', date: todayString(), notes: '', fileName: '', fileDataUrl: '', fileMimeType: '' });
  const [viewingId, setViewingId] = useState(null);
  const [viewingAttachment, setViewingAttachment] = useState(null);
  const [confirmDeleteReceipt, setConfirmDeleteReceipt] = useState(null);
  const MONTH_NAMES = ['Janeiro', 'Fevereiro', 'Marco', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

  // Agrupar comprovantes por Ano > Mes (mais recente primeiro)
  const sorted = [...receipts].sort((a, b) => new Date(b.importedAt || `${b.date}T12:00:00`) - new Date(a.importedAt || `${a.date}T12:00:00`));
  const grouped = {};
  sorted.forEach((receipt) => {
    const d = new Date(`${receipt.date}T12:00:00`);
    const year = d.getFullYear();
    const month = d.getMonth();
    const key = `${year}-${String(month).padStart(2, '0')}`;
    if (!grouped[key]) grouped[key] = { year, month, label: `${MONTH_NAMES[month]} ${year}`, receipts: [], total: 0 };
    grouped[key].receipts.push(receipt);
    grouped[key].total += Number(receipt.value) || 0;
  });
  const groups = Object.values(grouped).sort((a, b) => b.year !== a.year ? b.year - a.year : b.month - a.month);

  const viewingReceipt = viewingId !== null ? receipts.find((r) => r.id === viewingId) : null;
  const selectedAttachment = viewingAttachment || viewingReceipt?.attachments?.[0] || null;
  const fileUrl = selectedAttachment ? (selectedAttachment.isPrimary ? (window.__api ? window.__api.receiptFileUrl(viewingReceipt.id) : '') : (window.__api ? window.__api.receiptAttachmentUrl(viewingReceipt.id, selectedAttachment.id) : '')) : (viewingReceipt ? (viewingReceipt.filePath ? (window.__api ? window.__api.receiptFileUrl(viewingReceipt.id) : '') : viewingReceipt.dataUrl || '') : '');
  const isPdf = selectedAttachment?.mimeType?.includes('pdf') || viewingReceipt?.mimeType?.includes('pdf');
  const isImage = selectedAttachment?.mimeType?.startsWith('image/') || viewingReceipt?.mimeType?.startsWith('image/') || (viewingReceipt?.dataUrl && viewingReceipt.dataUrl.startsWith('data:image/'));
  const hasFile = Boolean(fileUrl || viewingReceipt?.hasFile || viewingReceipt?.dataUrl || viewingReceipt?.filePath);

  return <>{viewingReceipt && hasFile ? <div className="modal-overlay" onClick={() => { setViewingId(null); setViewingAttachment(null); }}><div className="modal-content" onClick={(e) => e.stopPropagation()}><div className="panel-head"><div><h3>{viewingReceipt.title}</h3><p>{formatDate(viewingReceipt.date)} - {currency(viewingReceipt.value)}</p></div><button className="ghost-button" onClick={() => { setViewingId(null); setViewingAttachment(null); }}>Fechar</button></div>{viewingReceipt.attachments?.length ? <div className="actions-row" style={{ marginBottom: '1rem', flexWrap: 'wrap' }}>{viewingReceipt.attachments.map((attachment) => <button key={attachment.id} className={selectedAttachment?.id === attachment.id ? 'primary-button' : 'ghost-button'} type="button" onClick={() => setViewingAttachment(attachment)}>{attachment.label || attachment.fileName}</button>)}</div> : null}<div className="receipt-viewer">{isPdf ? <iframe src={fileUrl} title="Comprovante PDF" style={{ width: '100%', height: '70vh', border: 'none', borderRadius: '8px' }} /> : isImage ? <img src={fileUrl} alt="Comprovante" style={{ maxWidth: '100%', maxHeight: '70vh', objectFit: 'contain', borderRadius: '8px' }} /> : <p>Formato nao suportado para visualizacao. Use o download para abrir este arquivo.</p>}</div><div className="actions-row" style={{ marginTop: '1rem' }}><a className="primary-button" href={fileUrl} download={selectedAttachment?.fileName || viewingReceipt.fileName || `comprovante-${viewingReceipt.date}`} style={{ textDecoration: 'none', textAlign: 'center' }}>Baixar arquivo</a><button className="ghost-button" onClick={() => { setViewingId(null); setViewingAttachment(null); }}>Fechar</button></div></div></div> : null}

  <section className="panel"><div className="panel-head"><div><h3>Comprovantes</h3><p>Cupons fiscais organizados por mes - {receipts.length} registro(s) no total</p></div><Badge tone="info">{currency(receipts.reduce((sum, r) => sum + (Number(r.value) || 0), 0))} total</Badge></div></section>

  <section className="panel"><div className="panel-head"><div><h3>Registrar comprovante manual</h3><p>Use quando nao houver importacao pelo modulo de entrada</p></div></div><form className="form-grid" onSubmit={async (event) => { event.preventDefault(); if (!form.title.trim()) return; onAdd({ title: form.title.trim(), value: parseBrlInput(form.valueRaw), date: form.date, importedAt: timestampString(), notes: form.notes, source: 'manual', fileName: form.fileName, mimeType: form.fileMimeType }, form._file || null); setForm({ title: '', valueDisplay: '', valueRaw: '', date: todayString(), notes: '', fileName: '', fileDataUrl: '', fileMimeType: '', _file: null }); }}><Field label="Titulo"><input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="Ex: Compra Mercado Central" /></Field><Field label="Valor (R$)"><input inputMode="numeric" value={form.valueDisplay} onChange={(event) => { const raw = event.target.value.replace(/\D/g, ''); setForm({ ...form, valueRaw: raw, valueDisplay: formatBrlInput(raw) }); }} placeholder="R$ 0,00" /></Field><Field label="Data da compra"><input type="date" value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} /></Field><Field label="Arquivo (imagem ou PDF)"><div className="dropzone" style={{ padding: '14px', minHeight: 'auto' }}><input type="file" accept="image/*,.pdf" onChange={async (event) => { const file = event.target.files?.[0]; if (!file) return; setForm((prev) => ({ ...prev, fileName: file.name, fileMimeType: file.type, _file: file })); }} />{form.fileName ? <span style={{ color: 'var(--success)', fontWeight: 500 }}>{form.fileName}</span> : <span>Selecionar arquivo</span>}</div></Field><Field label="Observacao"><input value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></Field><div className="actions-row"><button className="primary-button" type="submit">Salvar comprovante</button>{form.fileName ? <button className="ghost-button" type="button" onClick={() => setForm((prev) => ({ ...prev, fileName: '', fileDataUrl: '', fileMimeType: '' }))}>Remover arquivo</button> : null}</div></form></section>

  {!groups.length ? <section className="panel"><EmptyState text="Nenhum comprovante registrado ainda. Importe pelo modulo de entrada ou registre manualmente acima." /></section> : groups.map((group) => <section className="panel" key={group.label}><div className="panel-head"><div><h3>{group.label}</h3><p>{group.receipts.length} comprovante(s)</p></div><Badge tone="neutral">{currency(group.total)}</Badge></div><div className="stack">{group.receipts.map((receipt) => {
    const importSummary = receipt.importSummary || {};
    const hasImportedLinks = importSummary.canRevertImport;
    return <article className="receipt-item" key={receipt.id}><div className="receipt-item-head"><div><strong>{receipt.title}</strong><p>{currency(receipt.value)}{receipt.supplierId ? ` - ${suppliersById[receipt.supplierId]?.name || 'Fornecedor'}` : ''}</p></div><Badge tone={receipt.source === 'entrada-ocr' ? 'info' : receipt.source === 'xml-fiscal' ? 'success' : 'neutral'}>{receipt.source === 'entrada-ocr' ? 'OCR' : receipt.source === 'xml-fiscal' ? 'XML' : receipt.source === 'pdf-texto' ? 'PDF' : 'Manual'}</Badge></div><div className="receipt-meta"><span>Data: {formatDate(receipt.date)}</span><span>Importado em: {receipt.importedAt ? formatDateTime(receipt.importedAt) : '-'}</span>{receipt.fileName ? <span>Arquivo principal: {receipt.fileName}</span> : null}{receipt.attachments?.length > 1 ? <span>Anexos: {receipt.attachments.map((attachment) => attachment.fileName).join(', ')}</span> : null}{receipt.accessKey ? <span>Chave: {receipt.accessKey}</span> : null}{hasImportedLinks ? <span>Importacao vinculada: {importSummary.movementCount || 0} movimento(s), {importSummary.priceCount || 0} preco(s), {importSummary.createdItemCount || 0} item(ns) novo(s)</span> : null}</div>{receipt.notes ? <p>{receipt.notes}</p> : null}<div className="actions-row">{(receipt.filePath || receipt.hasFile || receipt.dataUrl || receipt.attachments?.length) ? <button className="primary-button" type="button" onClick={() => { setViewingId(receipt.id); setViewingAttachment(receipt.attachments?.[0] || null); }}>Visualizar</button> : null}{(receipt.filePath || receipt.hasFile || receipt.dataUrl) ? <a className="ghost-button" href={receipt.filePath && window.__api ? window.__api.receiptFileUrl(receipt.id) : receipt.dataUrl} download={receipt.fileName || `comprovante-${receipt.date}`} style={{ textDecoration: 'none', textAlign: 'center' }}>Baixar principal</a> : null}{receipt.queryUrl ? <button className="ghost-button" type="button" onClick={() => window.open(receipt.queryUrl, '_blank', 'noopener,noreferrer')}>Consultar NFC-e</button> : null}<button className="table-action" type="button" onClick={() => setConfirmDeleteReceipt(receipt)}>Excluir</button></div></article>;
  })}</div></section>)}
  {confirmDeleteReceipt !== null ? (() => {
    const importSummary = confirmDeleteReceipt.importSummary || {};
    const canRevertImport = importSummary.canRevertImport;
    if (!canRevertImport) {
      return <ConfirmModal title="Excluir comprovante" message="Deseja excluir este comprovante permanentemente? Esta acao nao pode ser desfeita." confirmLabel="Excluir" danger onConfirm={() => { onDelete(confirmDeleteReceipt.id, 'receipt-only'); setConfirmDeleteReceipt(null); }} onCancel={() => setConfirmDeleteReceipt(null)} />;
    }

    return <div className="modal-overlay"><div className="modal-content" style={{ maxWidth: '520px' }}>
      <div className="panel-head"><div><h3>Excluir comprovante importado</h3><p>Este comprovante criou registros no estoque. Escolha como deseja prosseguir.</p></div></div>
      <div className="stack" style={{ marginTop: '1rem' }}>
        <div className="alert-card info">
          <strong>Importacao vinculada</strong>
          <p>{importSummary.movementCount || 0} movimento(s), {importSummary.priceCount || 0} preco(s) e {importSummary.createdItemCount || 0} item(ns) novo(s).</p>
        </div>
        <button className="ghost-button" type="button" onClick={() => { onDelete(confirmDeleteReceipt.id, 'receipt-only'); setConfirmDeleteReceipt(null); }}>
          Excluir so o comprovante
        </button>
        <button className="primary-button" type="button" style={{ background: '#e67e22' }} onClick={() => { onDelete(confirmDeleteReceipt.id, 'revert-import'); setConfirmDeleteReceipt(null); }}>
          Reverter importacao e excluir comprovante
        </button>
        <p className="subtle">A reversao so sera concluida se o estoque atual ainda suportar desfazer essas entradas. Se os itens ja tiverem sido consumidos, o sistema vai bloquear para evitar saldo incorreto.</p>
      </div>
      <div className="actions-row" style={{ marginTop: '1rem' }}>
        <button className="ghost-button" type="button" onClick={() => setConfirmDeleteReceipt(null)}>Cancelar</button>
      </div>
    </div></div>;
  })() : null}
</>;
}
function ReportsPanel({ items, lowStockItems, vulnerableItems, durationForItem, daysUntilNextPurchase, nextPurchaseDate, cycle, priceMap, suppliersById, purchaseListDraft, onPurchaseListDraftChange }) {
  const editableList = useMemo(() => {
    const draftById = new Map((purchaseListDraft || []).map((entry) => [Number(entry.id), entry]));
    return sortByName(items).map((item) => {
      const saved = draftById.get(Number(item.id));
      const itemPackSize = Number(item.packSize || 1);
      const itemPackUnit = item.packUnit || '';
      const prices = priceMap[item.id] || [];
      const best = [...prices].sort((a, b) => a.price - b.price)[0] || null;
      const bestSupplierName = best ? (suppliersById[best.supplierId]?.name || best.market || null) : null;
      return {
        ...item,
        itemPackSize,
        itemPackUnit,
        suggestedQty: null,
        suggestedPacks: null,
        bestSupplierName,
        isManual: false,
        included: saved?.included ?? true,
        editQty: saved?.editQty ?? '',
        isPackMode: false
      };
    });
  }, [items, priceMap, purchaseListDraft, suppliersById]);

  const sanitizePurchaseQty = (value) => {
    if (value === '') return '';
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return '';
    return parsed < 0 ? 0 : parsed;
  };

  const updateItem = (id, changes) => onPurchaseListDraftChange((prev) => prev.map((i) => i.id === id ? {
    ...i,
    ...changes,
    ...(Object.prototype.hasOwnProperty.call(changes, 'editQty') ? { editQty: sanitizePurchaseQty(changes.editQty) } : {}),
  } : i));
  const clearItemQty = (id) => updateItem(id, { editQty: '' });
  const resetToSuggestions = () => onPurchaseListDraftChange(mergePurchaseListDraft(items));

  const getActualQty = (item) => {
    const quantity = Number(item.editQty || 0);
    return item.isPackMode ? quantity * item.itemPackSize : quantity;
  };
  const getItemCost = (item) => {
    const prices = priceMap[item.id] || [];
    const best = [...prices].sort((a, b) => a.price - b.price)[0] || null;
    return best ? Number((best.price * getActualQty(item)).toFixed(2)) : 0;
  };
  const selectedItems = editableList.filter((i) => i.included);
  const totalSelected = selectedItems.reduce((sum, i) => sum + getItemCost(i), 0);

  const printPurchaseList = () => {
    const rows = selectedItems.map((item) => {
      const actualQty = getActualQty(item);
      const hasQty = item.editQty !== '' && Number(item.editQty) > 0;
      const qtyLabel = !hasQty ? '' : item.isPackMode ? `${item.editQty} ${item.itemPackUnit} (${actualQty} ${item.unit})` : `${item.editQty} ${item.unit}`;
      const supplier = item.bestSupplierName || '-';
      const cost = getItemCost(item);
      const notes = [item.brand, item.itemNotes].filter(Boolean).join(' - ');
      return `
        <tr>
          <td>${item.name}</td>
          <td>${qtyLabel || '&nbsp;'}</td>
          <td>${supplier}</td>
          <td>${cost > 0 ? currency(cost) : '-'}</td>
          <td>${notes || '&nbsp;'}</td>
        </tr>
      `;
    }).join('');

    const printWindow = window.open('', '_blank', 'width=900,height=700');
    if (!printWindow) return;

    printWindow.document.write(`
      <!DOCTYPE html>
      <html lang="pt-BR">
        <head>
          <meta charset="UTF-8" />
          <title>Lista de Compra</title>
          <style>
            body { font-family: Arial, sans-serif; margin: 24px; color: #111; }
            h1 { margin: 0 0 6px; font-size: 24px; }
            p { margin: 0 0 18px; color: #555; font-size: 12px; }
            table { width: 100%; border-collapse: collapse; font-size: 12px; }
            th, td { border: 1px solid #cfcfcf; padding: 8px 10px; text-align: left; vertical-align: top; }
            th { background: #f2f2f2; text-transform: uppercase; font-size: 10px; letter-spacing: 0.06em; }
            .total { margin-top: 16px; text-align: right; font-weight: 700; }
          </style>
        </head>
        <body>
          <h1>Lista de Compra</h1>
          <p>Gerado em ${formatDate(todayString())} | Próxima compra: ${formatDate(safeIsoDate(nextPurchaseDate))} | ${selectedItems.length} item(ns)</p>
          <table>
            <thead>
              <tr>
                <th>Item</th>
                <th>Quantidade</th>
                <th>Fornecedor</th>
                <th>Custo est.</th>
                <th>Observações</th>
              </tr>
            </thead>
            <tbody>
              ${rows || '<tr><td colspan="5">Nenhum item selecionado para impressão.</td></tr>'}
            </tbody>
          </table>
          ${totalSelected > 0 ? `<div class="total">Total estimado: ${currency(totalSelected)}</div>` : ''}
        </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  };

  const printCountSheet = () => {
    const sorted = [...items].sort((a, b) => (a.name || '').localeCompare(b.name || '', 'pt-BR'));
    const rows = sorted.map((item) => `
      <tr>
        <td>${item.name}${item.brand ? ` <span class="brand">(${item.brand})</span>` : ''}</td>
        <td>${item.unit || ''}</td>
        <td class="count-cell">&nbsp;</td>
        <td>&nbsp;</td>
      </tr>
    `).join('');

    const printWindow = window.open('', '_blank', 'width=900,height=700');
    if (!printWindow) return;

    printWindow.document.write(`
      <!DOCTYPE html>
      <html lang="pt-BR">
        <head>
          <meta charset="UTF-8" />
          <title>Folha de Contagem de Estoque</title>
          <style>
            body { font-family: Arial, sans-serif; margin: 24px; color: #111; }
            h1 { margin: 0 0 6px; font-size: 22px; }
            p { margin: 0 0 14px; color: #555; font-size: 12px; }
            .meta { display: flex; gap: 24px; margin: 0 0 18px; font-size: 12px; }
            .meta div { border-bottom: 1px solid #888; min-width: 180px; padding: 4px 0; }
            table { width: 100%; border-collapse: collapse; font-size: 12px; }
            th, td { border: 1px solid #888; padding: 10px; text-align: left; vertical-align: middle; }
            th { background: #eee; text-transform: uppercase; font-size: 10px; letter-spacing: 0.06em; }
            td.count-cell { width: 120px; height: 28px; }
            td:nth-child(2) { width: 70px; text-align: center; }
            td:last-child { width: 180px; }
            .brand { color: #666; font-weight: normal; font-size: 11px; }
            .instructions { font-size: 11px; color: #444; margin: 0 0 12px; padding: 8px 12px; background: #f6f6f6; border-left: 3px solid #888; }
          </style>
        </head>
        <body>
          <h1>Folha de Contagem de Estoque</h1>
          <div class="meta">
            <div><strong>Data:</strong> ${formatDate(todayString())}</div>
            <div><strong>Responsável:</strong> ____________________</div>
            <div><strong>Assinatura:</strong> ____________________</div>
          </div>
          <p class="instructions">Conte fisicamente cada item e anote a quantidade encontrada. Se o item não for localizado, escreva "0". Use o campo de observações para avarias, validade ou divergências.</p>
          <table>
            <thead>
              <tr>
                <th>Item</th>
                <th>Unidade</th>
                <th>Qtd contada</th>
                <th>Observações</th>
              </tr>
            </thead>
            <tbody>
              ${rows || '<tr><td colspan="4">Nenhum item cadastrado.</td></tr>'}
            </tbody>
          </table>
        </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  };

  const exportCsv = () => {
    const headers = ['Item', 'Unidade', 'Qtd Atual', 'Estoque Minimo', 'Consumo Semanal', 'Duracao (dias)', 'Status'];
    const rows = items.map((item) => {
      const duration = durationForItem(item);
      const isLow = Number(item.quantity || 0) <= Number(item.minStock || 0);
      const isVulnerable = !isLow && duration < daysUntilNextPurchase;
      const status = isLow ? 'Abaixo do minimo' : isVulnerable ? 'Vulneravel' : 'OK';
      return [item.name, item.unit, item.quantity, item.minStock, item.weeklyConsumption || 0, Number.isFinite(duration) ? duration : 'Sem consumo', status];
    });
    const csv = [headers, ...rows].map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(';')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `estoque-${todayString()}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  };

  return <>
    <div className="report-print-header">
      <h2>Lista de Compra &mdash; {formatDate(todayString())}</h2>
      <p>Próxima compra: {formatDate(safeIsoDate(nextPurchaseDate))} &bull; {daysUntilNextPurchase} dias restantes &bull; {editableList.length} item(ns)</p>
    </div>

    <section className="panel no-print">
      <div className="panel-head">
        <div><h3>Posicao atual do estoque</h3><p>Todos os {items.length} itens com status e estimativa de duração</p></div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button className="ghost-button" type="button" onClick={printCountSheet}>Imprimir folha de contagem</button>
          <button className="ghost-button" type="button" onClick={exportCsv}>Exportar CSV</button>
        </div>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Item</th><th>Unidade</th><th>Qtd atual</th><th>Estoque min.</th><th>Consumo/sem.</th><th>Dura ate</th><th>Status</th></tr></thead>
          <tbody>{[...items].sort((a, b) => (a.name || '').localeCompare(b.name || '', 'pt-BR')).map((item) => {
            const duration = durationForItem(item);
            const isLow = Number(item.quantity || 0) <= Number(item.minStock || 0);
            const isVulnerable = !isLow && duration < daysUntilNextPurchase;
            const tone = isLow ? 'danger' : isVulnerable ? 'warn' : 'success';
            const label = isLow ? 'Abaixo do minimo' : isVulnerable ? 'Vulneravel' : 'OK';
            return <tr key={item.id}><td><strong>{item.name}</strong></td><td>{item.unit}</td><td>{item.quantity}</td><td>{item.minStock}</td><td>{item.weeklyConsumption || '-'}</td><td>{Number.isFinite(duration) ? `${duration} dias` : 'Sem consumo'}</td><td><Badge tone={tone}>{label}</Badge></td></tr>;
          })}</tbody>
        </table>
      </div>
    </section>

    <section className="panel">
      <div className="panel-head no-print">
        <div>
          <h3>Lista de compra</h3>
          <p>{editableList.length} item(ns) cadastrados na lista{totalSelected > 0 ? ` - estimado ${currency(totalSelected)}` : ""}</p>
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button className="ghost-button" type="button" onClick={resetToSuggestions}>Limpar quantidades</button>
          <button className="primary-button" type="button" onClick={printPurchaseList}>Imprimir lista</button>
        </div>
      </div>
      <div className="report-print-section-title">
        <h3>Lista de Compra &mdash; {editableList.length} item(ns)</h3>
        <p>Gerado em {formatDate(todayString())} &bull; Próxima compra: {formatDate(safeIsoDate(nextPurchaseDate))}</p>
      </div>

      <div className="table-wrap print-only">
        <table className="purchase-table">
          <thead><tr><th>Item</th><th>Quantidade</th><th>Fornecedor</th><th>Custo est.</th></tr></thead>
          <tbody>{selectedItems.map((item) => {
            const actualQty = getActualQty(item);
            const hasQty = item.editQty !== '' && Number(item.editQty) > 0;
            const qtyLabel = !hasQty ? '' : item.isPackMode ? `${item.editQty} ${item.itemPackUnit} (${actualQty} ${item.unit})` : `${item.editQty} ${item.unit}`;
            const cost = getItemCost(item);
            return <tr key={`print-${item.id}`}>
              <td>
                <strong>{item.name}</strong>
                {item.brand ? <div className="sub-note">{item.brand}</div> : null}
                {item.itemNotes ? <div className="sub-note" style={{ fontStyle: 'italic' }}>{item.itemNotes}</div> : null}
              </td>
              <td>{qtyLabel || ' '}</td>
              <td>{item.bestSupplierName || '-'}</td>
              <td>{cost > 0 ? currency(cost) : '-'}</td>
            </tr>;
          })}</tbody>
        </table>
        {!selectedItems.length ? <p>Nenhum item selecionado para impressao.</p> : null}
      </div>

      {!editableList.length
        ? <EmptyState text="Nenhum item cadastrado para gerar a lista de compra." />
        : <div className="table-wrap no-print">
            <table className="purchase-table">
              <thead><tr><th className="col-check no-print"><input type="checkbox" title={editableList.every((i) => i.included) ? 'Desmarcar todos' : 'Selecionar todos'} checked={editableList.length > 0 && editableList.every((i) => i.included)} ref={(el) => { if (el) el.indeterminate = editableList.some((i) => i.included) && !editableList.every((i) => i.included); }} onChange={(e) => onPurchaseListDraftChange((prev) => prev.map((i) => ({ ...i, included: e.target.checked })))} style={{ width: 'auto', cursor: 'pointer', margin: 0 }} /></th><th>Item</th><th>Quantidade</th><th className="no-print">Und.</th><th>Fornecedor</th><th>Custo est.</th><th className="no-print"></th></tr></thead>
              <tbody>{editableList.map((item) => {
                const actualQty = getActualQty(item);
                const cost = item.included ? getItemCost(item) : 0;
                const hasQty = item.editQty !== '' && Number(item.editQty) > 0;
                const qtyLabel = !hasQty ? '' : item.isPackMode ? `${item.editQty} ${item.itemPackUnit} (${actualQty} ${item.unit})` : `${item.editQty} ${item.unit}`;
                return <tr key={item.id} style={{ opacity: item.included ? 1 : 0.4 }} className={item.included ? '' : 'no-print'}>
                  <td className="col-check">
                    <input className="no-print" type="checkbox" checked={item.included} onChange={(e) => updateItem(item.id, { included: e.target.checked })} style={{ width: 'auto', cursor: 'pointer', margin: 0 }} />
                    <span className="print-only print-checkbox"></span>
                  </td>
                  <td>
                    <strong>{item.name}</strong>
                    {item.brand ? <div className="sub-note">{item.brand}</div> : null}
                    {item.itemNotes ? <div className="sub-note" style={{ fontStyle: 'italic' }}>{item.itemNotes}</div> : null}
                    {item.isManual ? <span className="badge info" style={{ fontSize: '10px', marginTop: '4px', display: 'inline-block' }}>Adicionado</span> : null}
                  </td>
                  <td>
                    <div className="no-print" style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <input type="number" min="0" step="1" value={item.editQty} onChange={(e) => updateItem(item.id, { editQty: e.target.value })} placeholder="Qtd" style={{ width: '80px', padding: '6px 8px' }} />
                      {item.isPackMode && hasQty ? <div className="pack-preview" style={{ fontSize: '11px', padding: '4px 8px' }}>{item.editQty} {item.itemPackUnit} = {actualQty} {item.unit}</div> : null}
                    </div>
                    <span className="print-only">{qtyLabel || ' '}</span>
                  </td>
                  <td className="no-print">{item.isPackMode ? item.itemPackUnit : item.unit}</td>
                  <td>{item.bestSupplierName || <span style={{ color: 'var(--muted)' }}>-</span>}</td>
                  <td>{cost > 0 ? currency(cost) : <span style={{ color: 'var(--muted)' }}>-</span>}</td>
                  <td className="no-print"><button className="table-action" type="button" onClick={() => clearItemQty(item.id)} style={{ padding: '5px 8px', fontSize: '12px' }}>Limpar</button></td>
                </tr>;
              })}</tbody>
            </table>
            {totalSelected > 0 && <div style={{ textAlign: 'right', padding: '12px 10px', fontWeight: 600, borderTop: '2px solid var(--line)', marginTop: '2px' }}>
              Total estimado ({selectedItems.length} item(ns)): <strong>{currency(totalSelected)}</strong>
            </div>}
          </div>
      }
    </section>
  </>;
}

const MAINT_CATEGORIES = [
  { value: 'ac', label: 'Ar Condicionado', icon: '\u2744\uFE0F' },
  { value: 'bebedouro', label: 'Bebedouro', icon: '\u{1F4A7}' },
  { value: 'piscina', label: 'Piscina', icon: '\u{1F3CA}' },
  { value: 'grama', label: 'Corte de Grama', icon: '\u{1F33F}' },
  { value: 'impressora', label: 'Impressora', icon: '\u{1F5A8}\uFE0F' },
  { value: 'outro', label: 'Outro', icon: '\u{1F527}' },
];
const MAINT_RECORD_TYPES = [
  { value: 'preventiva', label: 'Preventiva' },
  { value: 'corretiva', label: 'Corretiva' },
  { value: 'limpeza', label: 'Limpeza' },
  { value: 'troca_filtro', label: 'Troca de Filtro' },
  { value: 'troca_tinta', label: 'Troca de Tinta' },
  { value: 'recarga', label: 'Recarga' },
  { value: 'substituição', label: 'Substituicao' },
  { value: 'aplicacao_herbicida', label: 'Aplicação de herbicida' },
];
const INVENTORY_FISCAL_CLASSES = [
  { value: 'processamento_dados', label: 'Proc. de dados', annualRate: 20, residualRate: 10, usefulLifeYears: 5, note: 'Equipamentos de processamento de dados' },
  { value: 'comunicacao', label: 'Comunicação', annualRate: 10, residualRate: 20, usefulLifeYears: 10, note: 'Aparelhos e equipamentos de comunicacao' },
  { value: 'audio_video', label: 'Audio/Video', annualRate: 10, residualRate: 10, usefulLifeYears: 10, note: 'Equipamentos de audio, video e foto' },
  { value: 'outros', label: 'Outros', annualRate: 10, residualRate: 10, usefulLifeYears: 10, note: 'Classe generica para outros bens' },
];
const INVENTORY_STATUS = [
  { value: 'em_uso', label: 'Em uso' },
  { value: 'em_estoque', label: 'Em estoque' },
  { value: 'em_manutenção', label: 'Em manutenção' },
  { value: 'baixado', label: 'Baixado' },
];
const getInventoryFiscalClass = (value) => INVENTORY_FISCAL_CLASSES.find((item) => item.value === value) || INVENTORY_FISCAL_CLASSES[0];
const monthsBetweenDates = (startDate, endDate = new Date()) => {
  const start = new Date(`${startDate}T12:00:00`);
  if (Number.isNaN(start.getTime())) return 0;
  const end = endDate instanceof Date ? endDate : new Date(`${endDate}T12:00:00`);
  let months = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
  if (end.getDate() < start.getDate()) months -= 1;
  return Math.max(0, months);
};
const calculateInventoryDepreciation = (asset) => {
  const fiscal = getInventoryFiscalClass(asset?.fiscalClass);
  const annualRate = Number(asset?.depreciationRate || fiscal.annualRate || 0);
  const quantity = Math.max(1, Number(asset?.stockQuantity || 1));
  const acquisitionValue = normalizeMoneyValue(asset?.purchaseCost) * quantity;
  const residualValue = acquisitionValue * ((fiscal.residualRate || 0) / 100);
  const monthlyRate = annualRate / 12 / 100;
  const elapsedMonths = monthsBetweenDates(asset?.purchaseDate);
  const accumulated = Math.min(Math.max(0, acquisitionValue - residualValue), acquisitionValue * monthlyRate * elapsedMonths);
  const currentValue = Math.max(residualValue, acquisitionValue - accumulated);
  return {
    acquisitionValue,
    residualValue,
    accumulated,
    currentValue,
    annualRate,
    monthlyRate: monthlyRate * 100,
    elapsedMonths,
    usefulLifeYears: annualRate ? 100 / annualRate : 0,
  };
};
const AC_TYPES = ['Split', 'Janela', 'Cassete', 'Piso-teto', 'Central', 'Portatil'];

function statusFromDays(daysLeft) {
  if (daysLeft === null || daysLeft === undefined) return 'overdue';
  if (daysLeft <= 0) return 'overdue';
  if (daysLeft <= 14) return 'due';
  return 'ok';
}
function assetStatus(asset) {
  const mow = statusFromDays(assetDaysLeft(asset));
  if (asset.category === 'grama' && asset.lastHerbicideDate) {
    const herb = statusFromDays(assetHerbicideDaysLeft(asset));
    const order = { overdue: 0, due: 1, ok: 2 };
    return order[mow] <= order[herb] ? mow : herb;
  }
  return mow;
}
function assetNextDate(asset) {
  if (!asset.lastMaintenanceDate) return null;
  const last = new Date(asset.lastMaintenanceDate);
  return new Date(last.getTime() + Number(asset.intervalDays || 180) * 86400000).toISOString().slice(0, 10);
}
function assetDaysLeft(asset) {
  if (!asset.lastMaintenanceDate) return null;
  const last = new Date(asset.lastMaintenanceDate);
  const next = new Date(last.getTime() + Number(asset.intervalDays || 180) * 86400000);
  return Math.round((next - new Date()) / 86400000);
}
function assetHerbicideNextDate(asset) {
  if (!asset.lastHerbicideDate) return null;
  const last = new Date(asset.lastHerbicideDate);
  return new Date(last.getTime() + Number(asset.herbicideIntervalDays || 30) * 86400000).toISOString().slice(0, 10);
}
function assetHerbicideDaysLeft(asset) {
  if (!asset.lastHerbicideDate) return null;
  const last = new Date(asset.lastHerbicideDate);
  const next = new Date(last.getTime() + Number(asset.herbicideIntervalDays || 30) * 86400000);
  return Math.round((next - new Date()) / 86400000);
}

function MaintenancePanel({ assets, records, suppliers, onAddAsset, onUpdateAsset, onDeleteAsset, onAddRecord, onDeleteRecord }) {
  const [tab, setTab] = React.useState('overview');
  const [filterCat, setFilterCat] = React.useState('');
  const [showAssetModal, setShowAssetModal] = React.useState(false);
  const [editAsset, setEditAsset] = React.useState(null);
  const [showRecordModal, setShowRecordModal] = React.useState(null); // assetId
  const [confirmDelete, setConfirmDelete] = React.useState(null); // { type: 'asset'|'record', id }
  const [confirmSave, setConfirmSave] = React.useState(null); // { id, payload }

  const emptyAsset = { category: 'ac', name: '', location: '', brand: '', model: '', serialNumber: '', supplierId: '', supplierName: '', intervalDays: 180, lastMaintenanceDate: '', notes: '', btuCapacity: '', acType: 'Split', inkColors: 'C,M,Y,K', poolVolume: '', areaM2: '', filterIntervalDays: 180, herbicideIntervalDays: 30, lastHerbicideDate: '' };
  const emptyRecord = { assetId: '', date: new Date().toISOString().slice(0,10), type: 'preventiva', description: '', cost: '', technician: '', supplierId: '', notes: '', herbicideProduct: '', herbicideQuantity: '', nextApplicationDate: '' };

  const [assetForm, setAssetForm] = React.useState(emptyAsset);
  const [recordForm, setRecordForm] = React.useState(emptyRecord);

  const filtered = filterCat ? assets.filter((a) => a.category === filterCat) : assets;
  const overdue = assets.filter((a) => assetStatus(a) === 'overdue');
  const due = assets.filter((a) => assetStatus(a) === 'due');
  const ok = assets.filter((a) => assetStatus(a) === 'ok');

  const catInfo = (v) => MAINT_CATEGORIES.find((c) => c.value === v) || MAINT_CATEGORIES[5];
  const statusTone = (s) => s === 'overdue' ? 'danger' : s === 'due' ? 'warn' : 'success';
  const statusLabel = (s) => s === 'overdue' ? 'Vencida' : s === 'due' ? 'Próxima' : 'Em dia';

  const openAddAsset = () => { setAssetForm(emptyAsset); setEditAsset(null); setShowAssetModal(true); };
  const openEditAsset = (a) => { setAssetForm({ ...a, supplierId: a.supplierId || '' }); setEditAsset(a); setShowAssetModal(true); };
  const saveAsset = () => {
    const payload = { ...assetForm, intervalDays: Number(assetForm.intervalDays || 180), filterIntervalDays: Number(assetForm.filterIntervalDays || 180), herbicideIntervalDays: Number(assetForm.herbicideIntervalDays || 30), supplierId: assetForm.supplierId || null };
    if (editAsset) { setConfirmSave({ id: editAsset.id, payload }); setShowAssetModal(false); }
    else { onAddAsset(payload); setShowAssetModal(false); }
  };

  const openRecordModal = (assetId) => {
    setRecordForm({ ...emptyRecord, assetId: String(assetId) });
    setShowRecordModal(assetId);
  };

  const tabStyle = (t) => ({ padding: '8px 16px', borderRadius: '10px', border: 'none', cursor: 'pointer', fontWeight: tab === t ? 700 : 400, background: tab === t ? 'var(--navy)' : 'transparent', color: tab === t ? '#fff' : 'var(--text)' });

  return <>
    {confirmDelete ? <ConfirmModal title={confirmDelete.type === 'asset' ? 'Excluir equipamento?' : 'Excluir registro?'} message={confirmDelete.type === 'asset' ? 'Todos os registros de manutenção vinculados serao removidos.' : 'Esta acao nao pode ser desfeita.'} danger onConfirm={() => { if (confirmDelete.type === 'asset') onDeleteAsset(confirmDelete.id); else onDeleteRecord(confirmDelete.id); setConfirmDelete(null); }} onCancel={() => setConfirmDelete(null)} confirmLabel="Excluir" /> : null}
    {confirmSave ? <ConfirmModal title="Salvar alteracoes?" message="Confirma a edicao deste equipamento?" onConfirm={() => { onUpdateAsset(confirmSave.id, confirmSave.payload); setConfirmSave(null); }} onCancel={() => setConfirmSave(null)} confirmLabel="Salvar" /> : null}

    {showAssetModal ? <div className="modal-overlay"><div className="modal-content" style={{ maxWidth: '680px' }}>
      <div className="panel-head"><div><h3>{editAsset ? 'Editar equipamento' : 'Novo equipamento'}</h3><p>Preencha os dados do equipamento/sistema</p></div></div>
      <div className="form-grid">
        <Field label="Categoria"><select value={assetForm.category} onChange={(e) => setAssetForm({ ...assetForm, category: e.target.value })}>{MAINT_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.icon} {c.label}</option>)}</select></Field>
        <Field label="Nome / Identificacao"><input value={assetForm.name} onChange={(e) => setAssetForm({ ...assetForm, name: e.target.value })} placeholder="Ex: Ar Cond. Sala Reuniao A" /></Field>
        <Field label="Local / Departamento"><input value={assetForm.location} onChange={(e) => setAssetForm({ ...assetForm, location: e.target.value })} placeholder="Ex: 2o andar - RH" /></Field>
        <Field label="Marca"><input value={assetForm.brand} onChange={(e) => setAssetForm({ ...assetForm, brand: e.target.value })} /></Field>
        <Field label="Modelo"><input value={assetForm.model} onChange={(e) => setAssetForm({ ...assetForm, model: e.target.value })} /></Field>
        <Field label="No de serie"><input value={assetForm.serialNumber} onChange={(e) => setAssetForm({ ...assetForm, serialNumber: e.target.value })} /></Field>
        <Field label="Fornecedor (catálogo)"><select value={assetForm.supplierId} onChange={(e) => setAssetForm({ ...assetForm, supplierId: e.target.value })}><option value="">-- nenhum --</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
        <Field label="Fornecedor (texto livre)"><input value={assetForm.supplierName} onChange={(e) => setAssetForm({ ...assetForm, supplierName: e.target.value })} placeholder="Nome da empresa de manutenção" /></Field>
        <Field label="Última manutenção"><input type="date" value={assetForm.lastMaintenanceDate} onChange={(e) => setAssetForm({ ...assetForm, lastMaintenanceDate: e.target.value })} /></Field>
        <Field label="Intervalo de manutenção (dias)"><input type="number" min="1" step="1" value={assetForm.intervalDays} onChange={(e) => setAssetForm({ ...assetForm, intervalDays: e.target.value })} /></Field>
        {assetForm.category === 'ac' ? <>
          <Field label="Capacidade (BTU)"><input value={assetForm.btuCapacity} onChange={(e) => setAssetForm({ ...assetForm, btuCapacity: e.target.value })} placeholder="Ex: 12000" /></Field>
          <Field label="Tipo de aparelho"><select value={assetForm.acType} onChange={(e) => setAssetForm({ ...assetForm, acType: e.target.value })}>{AC_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</select></Field>
        </> : null}
        {assetForm.category === 'bebedouro' ? <Field label="Intervalo troca de filtro (dias)"><input type="number" min="1" step="1" value={assetForm.filterIntervalDays} onChange={(e) => setAssetForm({ ...assetForm, filterIntervalDays: e.target.value })} /></Field> : null}
        {assetForm.category === 'impressora' ? <Field label="Cartuchos / Tintas"><input value={assetForm.inkColors} onChange={(e) => setAssetForm({ ...assetForm, inkColors: e.target.value })} placeholder="Ex: C, M, Y, K, PBK" /></Field> : null}
        {assetForm.category === 'piscina' ? <Field label="Volume da piscina"><input value={assetForm.poolVolume} onChange={(e) => setAssetForm({ ...assetForm, poolVolume: e.target.value })} placeholder="Ex: 50.000 L" /></Field> : null}
        {assetForm.category === 'grama' ? <>
          <Field label="Area (m2)"><input value={assetForm.areaM2} onChange={(e) => setAssetForm({ ...assetForm, areaM2: e.target.value })} placeholder="Ex: 350" /></Field>
          <Field label="Intervalo aplicação herbicida (dias)"><input type="number" min="1" step="1" value={assetForm.herbicideIntervalDays} onChange={(e) => setAssetForm({ ...assetForm, herbicideIntervalDays: e.target.value })} /></Field>
          <Field label="Última aplicação de herbicida"><input type="date" value={assetForm.lastHerbicideDate || ''} onChange={(e) => setAssetForm({ ...assetForm, lastHerbicideDate: e.target.value })} /></Field>
        </> : null}
        <Field label="Observações"><textarea rows="2" value={assetForm.notes} onChange={(e) => setAssetForm({ ...assetForm, notes: e.target.value })} /></Field>
      </div>
      <div className="actions-row" style={{ marginTop: '16px' }}>
        <button className="primary-button" type="button" onClick={saveAsset} disabled={!assetForm.name.trim()}>Salvar equipamento</button>
        <button className="ghost-button" type="button" onClick={() => setShowAssetModal(false)}>Cancelar</button>
      </div>
    </div></div> : null}

    {showRecordModal !== null ? <div className="modal-overlay"><div className="modal-content" style={{ maxWidth: '560px' }}>
      <div className="panel-head"><div><h3>Registrar manutenção</h3><p>{assets.find((a) => a.id === showRecordModal)?.name}</p></div></div>
      <div className="form-grid">
        <Field label="Data"><input type="date" value={recordForm.date} onChange={(e) => {
          const date = e.target.value;
          const asset = assets.find((a) => a.id === showRecordModal);
          const nextAuto = recordForm.type === 'aplicacao_herbicida' && date && asset ? new Date(new Date(date).getTime() + Number(asset.herbicideIntervalDays || 30) * 86400000).toISOString().slice(0,10) : recordForm.nextApplicationDate;
          setRecordForm({ ...recordForm, date, nextApplicationDate: nextAuto });
        }} /></Field>
        <Field label="Tipo"><select value={recordForm.type} onChange={(e) => {
          const type = e.target.value;
          const asset = assets.find((a) => a.id === showRecordModal);
          const nextAuto = type === 'aplicacao_herbicida' && recordForm.date && asset ? new Date(new Date(recordForm.date).getTime() + Number(asset.herbicideIntervalDays || 30) * 86400000).toISOString().slice(0,10) : '';
          setRecordForm({ ...recordForm, type, nextApplicationDate: nextAuto });
        }}>{MAINT_RECORD_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</select></Field>
        <Field label="Descrição"><input value={recordForm.description} onChange={(e) => setRecordForm({ ...recordForm, description: e.target.value })} placeholder="O que foi feito" /></Field>
        <Field label="Técnico / Empresa"><input value={recordForm.technician} onChange={(e) => setRecordForm({ ...recordForm, technician: e.target.value })} /></Field>
        <Field label="Custo (R$)"><input type="number" min="0" step="0.01" value={recordForm.cost} onChange={(e) => setRecordForm({ ...recordForm, cost: e.target.value })} /></Field>
        <Field label="Fornecedor (catálogo)"><select value={recordForm.supplierId} onChange={(e) => setRecordForm({ ...recordForm, supplierId: e.target.value })}><option value="">-- nenhum --</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
        {recordForm.type === 'aplicacao_herbicida' ? <>
          <Field label="Produto aplicado"><input value={recordForm.herbicideProduct} onChange={(e) => setRecordForm({ ...recordForm, herbicideProduct: e.target.value })} placeholder="Ex: Mata-mato XYZ" /></Field>
          <Field label="Quantidade utilizada"><input value={recordForm.herbicideQuantity} onChange={(e) => setRecordForm({ ...recordForm, herbicideQuantity: e.target.value })} placeholder="Ex: 500 ml ou 2 L" /></Field>
          <Field label="Próxima aplicação prevista"><input type="date" value={recordForm.nextApplicationDate} onChange={(e) => setRecordForm({ ...recordForm, nextApplicationDate: e.target.value })} /></Field>
        </> : null}
        <Field label="Observações"><textarea rows="2" value={recordForm.notes} onChange={(e) => setRecordForm({ ...recordForm, notes: e.target.value })} /></Field>
      </div>
      <div className="actions-row" style={{ marginTop: '16px' }}>
        <button className="primary-button" type="button" onClick={() => { onAddRecord({ ...recordForm, supplierId: recordForm.supplierId || null, cost: Number(recordForm.cost || 0) }); setShowRecordModal(null); }}>Salvar registro</button>
        <button className="ghost-button" type="button" onClick={() => setShowRecordModal(null)}>Cancelar</button>
      </div>
    </div></div> : null}

    <section className="panel">
      <div className="panel-head">
        <div><h3>Manutenção Predial</h3><p>Controle de equipamentos, sistemas e histórico de manutenções</p></div>
        <button className="primary-button" type="button" onClick={openAddAsset}>+ Novo equipamento</button>
      </div>
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '16px' }}>
        {['overview','assets','history'].map((t) => <button key={t} style={tabStyle(t)} onClick={() => setTab(t)}>{t === 'overview' ? '\u{1F4CA} Visão geral' : t === 'assets' ? '\u{1F527} Equipamentos' : '\u{1F4CB} Histórico'}</button>)}
      </div>

      {tab === 'overview' ? <>
        <div className="metrics" style={{ marginBottom: '16px' }}>
          <article className="metric danger"><span>Manutenções vencidas</span><strong>{overdue.length}</strong></article>
          <article className="metric warn"><span>Próximas (14 dias)</span><strong>{due.length}</strong></article>
          <article className="metric success"><span>Em dia</span><strong>{ok.length}</strong></article>
          <article className="metric"><span>Total de equipamentos</span><strong>{assets.length}</strong></article>
        </div>
        {overdue.length > 0 ? <><div style={{ fontWeight: 700, marginBottom: '8px', color: 'var(--danger)' }}>{'⚠️'} Requerem atenção imediata</div><div className="stack" style={{ marginBottom: '16px' }}>{overdue.map((a) => <div key={a.id} className="alert-card danger" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}><div><strong>{catInfo(a.category).icon} {a.name}</strong><div style={{ fontSize: '13px', color: 'var(--muted)' }}>{a.location} {a.supplierName ? ` - ${a.supplierName}` : ''}</div><div style={{ fontSize: '12px', marginTop: '2px' }}>{a.lastMaintenanceDate ? `Última: ${formatDate(a.lastMaintenanceDate)}` : 'Sem registro de manutenção'}</div></div><div style={{ display: 'flex', gap: '8px' }}><button className="ghost-button" style={{ padding: '6px 12px', fontSize: '13px' }} onClick={() => openRecordModal(a.id)}>Registrar</button><button className="ghost-button" style={{ padding: '6px 12px', fontSize: '13px' }} onClick={() => openEditAsset(a)}>Editar</button></div></div>)}</div></> : null}
        {due.length > 0 ? <><div style={{ fontWeight: 700, marginBottom: '8px', color: 'var(--warn)' }}>{'🔔'} Manutenções próximas</div><div className="stack" style={{ marginBottom: '16px' }}>{due.map((a) => <div key={a.id} className="alert-card warn" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}><div><strong>{catInfo(a.category).icon} {a.name}</strong><div style={{ fontSize: '13px', color: 'var(--muted)' }}>{a.location}</div><div style={{ fontSize: '12px', marginTop: '2px' }}>Próxima: {formatDate(assetNextDate(a))} ({assetDaysLeft(a)} dias)</div></div><button className="ghost-button" style={{ padding: '6px 12px', fontSize: '13px' }} onClick={() => openRecordModal(a.id)}>Registrar</button></div>)}</div></> : null}
        <div style={{ fontWeight: 700, marginBottom: '8px' }}>{'📂'} Por categoria</div>
        <div className="card-grid">{MAINT_CATEGORIES.map((cat) => { const count = assets.filter((a) => a.category === cat.value).length; const ov = assets.filter((a) => a.category === cat.value && assetStatus(a) === 'overdue').length; const dv = assets.filter((a) => a.category === cat.value && assetStatus(a) === 'due').length; return count > 0 ? <div key={cat.value} className="receipt-card" style={{ cursor: 'pointer' }} onClick={() => { setFilterCat(cat.value); setTab('assets'); }}><div style={{ fontSize: '24px' }}>{cat.icon}</div><div style={{ fontWeight: 700 }}>{cat.label}</div><div style={{ fontSize: '13px', color: 'var(--muted)' }}>{count} equipamento{count !== 1 ? 's' : ''}</div>{ov > 0 ? <span className="badge danger">{ov} vencida{ov !== 1 ? 's' : ''}</span> : dv > 0 ? <span className="badge warn">{dv} próxima{dv !== 1 ? 's' : ''}</span> : <span className="badge success">Em dia</span>}</div> : null; })}</div>
      </> : null}

      {tab === 'assets' ? <>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '12px', alignItems: 'center' }}>
          <span style={{ color: 'var(--muted)', fontSize: '13px' }}>Filtrar:</span>
          <button style={{ ...tabStyle(filterCat === ''), background: filterCat === '' ? 'var(--navy)' : 'var(--neutral-soft)', color: filterCat === '' ? '#fff' : 'var(--text)', padding: '6px 12px', fontSize: '13px', border: 'none', borderRadius: '8px', cursor: 'pointer' }} onClick={() => setFilterCat('')}>Todos</button>
          {MAINT_CATEGORIES.map((c) => assets.some((a) => a.category === c.value) ? <button key={c.value} style={{ background: filterCat === c.value ? 'var(--navy)' : 'var(--neutral-soft)', color: filterCat === c.value ? '#fff' : 'var(--text)', padding: '6px 12px', fontSize: '13px', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: filterCat === c.value ? 700 : 400 }} onClick={() => setFilterCat(c.value)}>{c.icon} {c.label}</button> : null)}
        </div>
        {filtered.length === 0 ? <div className="empty-state">Nenhum equipamento cadastrado. Clique em "+ Novo equipamento" para começar.</div> :
        <div className="table-wrap"><table><thead><tr><th>Tipo</th><th>Equipamento</th><th>Local</th><th>Última manutenção</th><th>Próxima manutenção</th><th>Intervalo</th><th>Fornecedor</th><th>Status</th><th></th></tr></thead><tbody>
          {filtered.sort((a, b) => { const so = { overdue: 0, due: 1, ok: 2 }; return so[assetStatus(a)] - so[assetStatus(b)] || a.name.localeCompare(b.name); }).map((a) => {
            const st = assetStatus(a); const dl = assetDaysLeft(a); const nd = assetNextDate(a);
            const isGrama = a.category === 'grama';
            const hNd = isGrama ? assetHerbicideNextDate(a) : null;
            const hDl = isGrama ? assetHerbicideDaysLeft(a) : null;
            const sup = suppliers.find((s) => s.id === a.supplierId);
            return <tr key={a.id}>
              <td>{catInfo(a.category).icon} <span style={{ fontSize: '12px', color: 'var(--muted)' }}>{catInfo(a.category).label}</span></td>
              <td><strong>{a.name}</strong>{a.brand || a.model ? <div style={{ fontSize: '12px', color: 'var(--muted)' }}>{[a.brand, a.model].filter(Boolean).join(' - ')}</div> : null}{a.serialNumber ? <div style={{ fontSize: '11px', color: 'var(--muted)' }}>S/N: {a.serialNumber}</div> : null}</td>
              <td>{a.location || <span style={{ color: 'var(--muted)' }}>--</span>}</td>
              <td>{a.lastMaintenanceDate ? <div>{formatDate(a.lastMaintenanceDate)}{isGrama ? <div style={{ fontSize: '11px', color: 'var(--muted)' }}>corte</div> : null}</div> : <span style={{ color: 'var(--muted)' }}>Não registrada</span>}{isGrama && a.lastHerbicideDate ? <div style={{ marginTop: '4px' }}>{formatDate(a.lastHerbicideDate)}<div style={{ fontSize: '11px', color: 'var(--muted)' }}>herbicida</div></div> : null}</td>
              <td>
                {nd ? <div>{formatDate(nd)}<div style={{ fontSize: '12px', color: dl <= 0 ? 'var(--danger)' : dl <= 14 ? 'var(--warn)' : 'var(--muted)' }}>{isGrama ? 'corte · ' : ''}{dl <= 0 ? `${Math.abs(dl)} dias atrás` : `em ${dl} dias`}</div></div> : <span style={{ color: 'var(--muted)' }}>--</span>}
                {isGrama && hNd ? <div style={{ marginTop: '4px' }}>{formatDate(hNd)}<div style={{ fontSize: '12px', color: hDl <= 0 ? 'var(--danger)' : hDl <= 14 ? 'var(--warn)' : 'var(--muted)' }}>herbicida · {hDl <= 0 ? `${Math.abs(hDl)} dias atrás` : `em ${hDl} dias`}</div></div> : null}
              </td>
              <td>{a.intervalDays} dias{isGrama && a.herbicideIntervalDays ? <div style={{ fontSize: '11px', color: 'var(--muted)' }}>herb: {a.herbicideIntervalDays} dias</div> : null}</td>
              <td>{sup ? sup.name : a.supplierName || <span style={{ color: 'var(--muted)' }}>--</span>}</td>
              <td><span className={`badge ${statusTone(st)}`}>{statusLabel(st)}</span></td>
              <td><div className="table-actions">
                <button className="ghost-button" style={{ padding: '6px 10px', fontSize: '12px' }} onClick={() => openRecordModal(a.id)}>Registrar</button>
                <button className="ghost-button" style={{ padding: '6px 10px', fontSize: '12px' }} onClick={() => openEditAsset(a)}>Editar</button>
                <button className="table-action" onClick={() => setConfirmDelete({ type: 'asset', id: a.id })}>Excluir</button>
              </div></td>
            </tr>;
          })}
        </tbody></table></div>}
      </> : null}

      {tab === 'history' ? <>
        {records.length === 0 ? <div className="empty-state">Nenhum registro de manutenção ainda.</div> :
        <div className="table-wrap"><table><thead><tr><th>Data</th><th>Equipamento</th><th>Tipo</th><th>Descrição</th><th>Técnico</th><th>Custo</th><th></th></tr></thead><tbody>
          {records.map((rec) => {
            const asset = assets.find((a) => a.id === rec.assetId);
            const typeLabel = MAINT_RECORD_TYPES.find((t) => t.value === rec.type)?.label || rec.type;
            return <tr key={rec.id}>
              <td>{formatDate(rec.date)}</td>
              <td>{asset ? <><div>{catInfo(asset.category).icon} {asset.name}</div><div style={{ fontSize: '12px', color: 'var(--muted)' }}>{asset.location}</div></> : <span style={{ color: 'var(--muted)' }}>--</span>}</td>
              <td><span className="badge neutral">{typeLabel}</span></td>
              <td>{rec.description || <span style={{ color: 'var(--muted)' }}>--</span>}</td>
              <td>{rec.technician || <span style={{ color: 'var(--muted)' }}>--</span>}</td>
              <td>{rec.cost > 0 ? <span className="mono">R$ {Number(rec.cost).toFixed(2)}</span> : <span style={{ color: 'var(--muted)' }}>--</span>}</td>
              <td><button className="table-action" onClick={() => setConfirmDelete({ type: 'record', id: rec.id })}>Excluir</button></td>
            </tr>;
          })}
        </tbody></table></div>}
      </> : null}
    </section>
  </>;
}

function InventoryPanel({ assets, suppliers, onAddAsset, onUpdateAsset, onDeleteAsset }) {
  const [tab, setTab] = React.useState('overview');
  const [search, setSearch] = React.useState('');
  const [showAssetModal, setShowAssetModal] = React.useState(false);
  const [editAsset, setEditAsset] = React.useState(null);
  const [confirmDelete, setConfirmDelete] = React.useState(null);
  const emptyAsset = { assetTag: '', barcode: '', serialNumber: '', description: '', department: '', assignedTo: '', purchaseCost: '', stockQuantity: 1, purchaseDate: '', brand: '', model: '', fiscalClass: 'processamento_dados', depreciationRate: 20, supplierId: '', status: 'em_uso', notes: '' };
  const [assetForm, setAssetForm] = React.useState(emptyAsset);

  const enrichedAssets = assets.map((asset) => ({
    ...asset,
    supplier: suppliers.find((supplier) => supplier.id === asset.supplierId),
    fiscal: getInventoryFiscalClass(asset.fiscalClass),
    depreciation: calculateInventoryDepreciation(asset),
  }));
  const filteredAssets = enrichedAssets.filter((asset) => {
    const haystack = [asset.assetTag, asset.barcode, asset.serialNumber, asset.description, asset.department, asset.assignedTo, asset.brand, asset.model].filter(Boolean).join(' ').toLowerCase();
    return !search || haystack.includes(search.toLowerCase());
  });
  const totalBookValue = enrichedAssets.reduce((sum, asset) => sum + asset.depreciation.currentValue, 0);
  const totalAcquisitionValue = enrichedAssets.reduce((sum, asset) => sum + asset.depreciation.acquisitionValue, 0);
  const allocatedCount = enrichedAssets.filter((asset) => asset.status === 'em_uso').length;
  const stockCount = enrichedAssets.filter((asset) => asset.status === 'em_estoque').length;
  const unassignedCount = enrichedAssets.filter((asset) => !asset.department || !asset.assignedTo).length;
  const openAddAsset = () => { setAssetForm(emptyAsset); setEditAsset(null); setShowAssetModal(true); };
  const openEditAsset = (asset) => { setAssetForm({ ...asset, purchaseCost: formatMoneyForInput(asset.purchaseCost), supplierId: asset.supplierId || '' }); setEditAsset(asset); setShowAssetModal(true); };
  const closeModal = () => { setShowAssetModal(false); setEditAsset(null); setAssetForm(emptyAsset); };
  const selectedFiscal = getInventoryFiscalClass(assetForm.fiscalClass);
  const previewDepreciation = calculateInventoryDepreciation(assetForm);
  const saveAsset = () => {
    const payload = {
      ...assetForm,
      purchaseCost: normalizeMoneyValue(assetForm.purchaseCost),
      stockQuantity: Math.max(0, Number(assetForm.stockQuantity || 1)),
      depreciationRate: Number(assetForm.depreciationRate || selectedFiscal.annualRate || 0),
      supplierId: assetForm.supplierId || null,
    };
    if (editAsset) onUpdateAsset(editAsset.id, payload);
    else onAddAsset(payload);
    closeModal();
  };
  const statusTone = (status) => ({ em_uso: 'success', em_estoque: 'info', em_manutenção: 'warn', baixado: 'danger' }[status] || 'neutral');
  const statusLabel = (status) => INVENTORY_STATUS.find((item) => item.value === status)?.label || status || 'Não informado';
  const tabStyle = (selected) => ({ padding: '8px 16px', borderRadius: '10px', border: 'none', cursor: 'pointer', fontWeight: tab === selected ? 700 : 400, background: tab === selected ? 'var(--navy)' : 'transparent', color: tab === selected ? '#fff' : 'var(--text)' });

  return <>
    {confirmDelete ? <ConfirmModal title="Excluir ativo de TI?" message="Esta acao remove o cadastro do inventario." danger onConfirm={() => { onDeleteAsset(confirmDelete.id); setConfirmDelete(null); }} onCancel={() => setConfirmDelete(null)} confirmLabel="Excluir" /> : null}
    {showAssetModal ? <div className="modal-overlay"><div className="modal-content" style={{ maxWidth: '820px' }}>
      <div className="panel-head"><div><h3>{editAsset ? 'Editar ativo de TI' : 'Novo ativo de TI'}</h3><p>Cadastro patrimonial com rastreio, alocação e depreciação fiscal automática.</p></div></div>
      <div className="form-grid">
        <Field label="Código interno"><input value={assetForm.assetTag} onChange={(e) => setAssetForm({ ...assetForm, assetTag: e.target.value })} placeholder="Etiqueta patrimonial" /></Field>
        <Field label="Código de barras"><input value={assetForm.barcode} onChange={(e) => setAssetForm({ ...assetForm, barcode: e.target.value })} /></Field>
        <Field label="Serial number"><input value={assetForm.serialNumber} onChange={(e) => setAssetForm({ ...assetForm, serialNumber: e.target.value })} /></Field>
        <Field label="Descrição do equipamento"><input value={assetForm.description} onChange={(e) => setAssetForm({ ...assetForm, description: e.target.value })} placeholder="Ex: Notebook Dell Latitude 5440" /></Field>
        <Field label="Departamento alocado"><input value={assetForm.department} onChange={(e) => setAssetForm({ ...assetForm, department: e.target.value })} placeholder="Ex: Financeiro" /></Field>
        <Field label="Responsavel de uso"><input value={assetForm.assignedTo} onChange={(e) => setAssetForm({ ...assetForm, assignedTo: e.target.value })} placeholder="Ex: Maria Souza" /></Field>
        <Field label="Custo de compra (R$)"><input type="text" inputMode="numeric" value={assetForm.purchaseCost} onChange={(e) => setAssetForm({ ...assetForm, purchaseCost: formatBrlInput(e.target.value) })} placeholder="R$ 0,00" /></Field>
        <Field label="Estoque"><input type="number" min="0" step="1" value={assetForm.stockQuantity} onChange={(e) => setAssetForm({ ...assetForm, stockQuantity: e.target.value })} /></Field>
        <Field label="Data de compra"><input type="date" value={assetForm.purchaseDate} onChange={(e) => setAssetForm({ ...assetForm, purchaseDate: e.target.value })} /></Field>
        <Field label="Marca"><input value={assetForm.brand} onChange={(e) => setAssetForm({ ...assetForm, brand: e.target.value })} /></Field>
        <Field label="Modelo"><input value={assetForm.model} onChange={(e) => setAssetForm({ ...assetForm, model: e.target.value })} /></Field>
        <Field label="Status"><select value={assetForm.status} onChange={(e) => setAssetForm({ ...assetForm, status: e.target.value })}>{INVENTORY_STATUS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></Field>
        <Field label="Classe fiscal"><select value={assetForm.fiscalClass} onChange={(e) => { const fiscal = getInventoryFiscalClass(e.target.value); setAssetForm({ ...assetForm, fiscalClass: e.target.value, depreciationRate: fiscal.annualRate }); }}>{INVENTORY_FISCAL_CLASSES.map((item) => <option key={item.value} value={item.value}>{item.label} ({item.annualRate}% a.a.)</option>)}</select></Field>
        <Field label="Taxa de depreciação (% a.a.)"><input type="number" min="0" step="0.01" value={assetForm.depreciationRate} onChange={(e) => setAssetForm({ ...assetForm, depreciationRate: e.target.value })} /></Field>
        <Field label="Fornecedor"><select value={assetForm.supplierId} onChange={(e) => setAssetForm({ ...assetForm, supplierId: e.target.value })}><option value="">-- nenhum --</option>{suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></Field>
        <Field label="Observações"><textarea rows="2" value={assetForm.notes} onChange={(e) => setAssetForm({ ...assetForm, notes: e.target.value })} /></Field>
      </div>
      <div className="alert-card" style={{ marginTop: '16px' }}>
        <strong>Preview fiscal</strong>
        <p>{selectedFiscal.note}. Vida util estimada: {selectedFiscal.usefulLifeYears} anos. Residual de referencia: {selectedFiscal.residualRate}%.</p>
        <div className="entry-meta" style={{ marginTop: '8px' }}>
          <span>Valor aquisição: {currency(previewDepreciation.acquisitionValue)}</span>
          <span>Depreciado: {currency(previewDepreciation.accumulated)}</span>
          <span>Valor contábil atual: {currency(previewDepreciation.currentValue)}</span>
        </div>
      </div>
      <div className="actions-row" style={{ marginTop: '16px' }}>
        <button className="primary-button" type="button" onClick={saveAsset} disabled={!assetForm.description.trim()}>Salvar ativo</button>
        <button className="ghost-button" type="button" onClick={closeModal}>Cancelar</button>
      </div>
    </div></div> : null}

    <section className="panel">
      <div className="panel-head">
        <div><h3>Inventário de Informática e Comunicação</h3><p>Controle patrimonial de equipamentos com alocação, rastreabilidade e depreciação fiscal.</p></div>
        <button className="primary-button" type="button" onClick={openAddAsset}>+ Novo ativo</button>
      </div>
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '16px' }}>
        {['overview', 'assets'].map((item) => <button key={item} style={tabStyle(item)} onClick={() => setTab(item)}>{item === 'overview' ? 'Visão geral' : 'Ativos cadastrados'}</button>)}
      </div>

      {tab === 'overview' ? <>
        <div className="metrics" style={{ marginBottom: '16px' }}>
          <article className="metric"><span>Total de ativos</span><strong>{enrichedAssets.length}</strong></article>
          <article className="metric success"><span>Alocados</span><strong>{allocatedCount}</strong></article>
          <article className="metric info"><span>Em estoque</span><strong>{stockCount}</strong></article>
          <article className={`metric ${unassignedCount ? 'warn' : 'success'}`}><span>Sem responsável/depto</span><strong>{unassignedCount}</strong></article>
        </div>
        <div className="panel-grid">
          <section className="panel" style={{ marginBottom: 0 }}>
            <div className="panel-head"><div><h3>Visão financeira</h3><p>Base de aquisição e valor contábil atual do inventario.</p></div></div>
            <div className="stack">
              <div className="entry-card"><strong>Valor de aquisição</strong><p>{currency(totalAcquisitionValue)}</p></div>
              <div className="entry-card"><strong>Valor contábil atual</strong><p>{currency(totalBookValue)}</p></div>
              <div className="entry-card"><strong>Depreciação acumulada</strong><p>{currency(totalAcquisitionValue - totalBookValue)}</p></div>
            </div>
          </section>
          <section className="panel" style={{ marginBottom: 0 }}>
            <div className="panel-head"><div><h3>Boas práticas aplicadas</h3><p>Campos inspirados em ITAM e controle patrimonial.</p></div></div>
            <div className="stack">
              <div className="alert-card success"><strong>Rastreabilidade</strong><p>Etiqueta interna, código de barras e serial permitem localizar o bem rápidamente.</p></div>
              <div className="alert-card info"><strong>Responsabilidade</strong><p>Departamento e responsável de uso deixam a guarda do ativo explícita.</p></div>
              <div className="alert-card warn"><strong>Ciclo de vida</strong><p>Compra, status e classe fiscal ajudam na substituição e no fechamento contábil.</p></div>
            </div>
          </section>
        </div>
        <div style={{ fontWeight: 700, margin: '16px 0 8px' }}>Distribuição por classe fiscal</div>
        <div className="card-grid">{INVENTORY_FISCAL_CLASSES.map((item) => {
          const count = enrichedAssets.filter((asset) => asset.fiscalClass === item.value).length;
          if (!count) return null;
          return <div key={item.value} className="receipt-card"><div style={{ fontWeight: 700 }}>{item.label}</div><small>{item.note}</small><span className="badge info">{count} ativo(s)</span><span className="badge neutral">{item.annualRate}% a.a.</span></div>;
        })}</div>
      </> : null}

      {tab === 'assets' ? <>
        <div className="panel-head" style={{ marginBottom: '12px' }}>
          <div><h3>Ativos cadastrados</h3><p>{'Busca rápida por patrimônio, serial, responsável ou descrição.'}</p></div>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar ativo..." style={{ maxWidth: '320px' }} />
        </div>
        {filteredAssets.length === 0 ? <div className="empty-state">Nenhum ativo de TI cadastrado ainda.</div> : <div className="table-wrap"><table><thead><tr><th>Patrimônio</th><th>Equipamento</th><th>Alocação</th><th>Estoque</th><th>Compra</th><th>Depreciação</th><th>Status</th><th></th></tr></thead><tbody>
          {filteredAssets.sort((a, b) => (a.description || '').localeCompare(b.description || '')).map((asset) => <tr key={asset.id}>
            <td><strong>{asset.assetTag || '--'}</strong>{asset.barcode ? <div className="sub-note">CB: {asset.barcode}</div> : null}</td>
            <td><strong>{asset.description}</strong>{asset.brand || asset.model ? <div className="sub-note">{[asset.brand, asset.model].filter(Boolean).join(' - ')}</div> : null}{asset.serialNumber ? <div className="sub-note">S/N: {asset.serialNumber}</div> : null}</td>
            <td>{asset.department || <span style={{ color: 'var(--muted)' }}>--</span>}{asset.assignedTo ? <div className="sub-note">Resp.: {asset.assignedTo}</div> : null}{asset.supplier ? <div className="sub-note">Fornecedor: {asset.supplier.name}</div> : null}</td>
            <td>{asset.stockQuantity}</td>
            <td>{asset.purchaseDate ? <><div>{formatDate(asset.purchaseDate)}</div><div className="sub-note">{currency(asset.depreciation.acquisitionValue)}</div></> : <span style={{ color: 'var(--muted)' }}>Não informada</span>}</td>
            <td><div>{currency(asset.depreciation.currentValue)}</div><div className="sub-note">{asset.depreciation.annualRate}% a.a. - {asset.fiscal.label}</div></td>
            <td><span className={`badge ${statusTone(asset.status)}`}>{statusLabel(asset.status)}</span></td>
            <td><div className="table-actions"><button className="ghost-button" type="button" onClick={() => openEditAsset(asset)}>Editar</button><button className="table-action" type="button" onClick={() => setConfirmDelete(asset)}>Excluir</button></div></td>
          </tr>)}
        </tbody></table></div>}
      </> : null}
    </section>
  </>;
}
function ConsumptionPanel({ items }) {
  const [config, setConfig] = React.useState({ people: 20, bathrooms: 2, profile: 'escritorio', femalePercent: 50, cleaningsPerDay: 2, daysPerWeek: 5, periodDays: 30 });
  const [rates, setRates] = React.useState(() => DEFAULT_CONSUMPTION_RATES.map((r) => ({ ...r, rate: r.rateBase })));
  const [showRates, setShowRates] = React.useState(false);
  const activeDays = (config.daysPerWeek / 7) * config.periodDays;
  const profileMult = CONSUMPTION_PROFILES.find((p) => p.value === config.profile)?.mult || 1;
  const maleRatio = (100 - Number(config.femalePercent)) / 100;
  const femaleRatio = Number(config.femalePercent) / 100;
  const results = rates.map((r) => {
    let qty = 0;
    if (r.basis === 'person') qty = r.rate * (maleRatio + femaleRatio * (r.femaleFactor || 1)) * Number(config.people) * profileMult * activeDays;
    else if (r.basis === 'bathroom_clean') qty = r.rate * Number(config.bathrooms) * Number(config.cleaningsPerDay) * profileMult * activeDays;
    else qty = r.rate * Number(config.bathrooms) * activeDays;
    const catalogMatch = items.find((i) => slug(i.name).includes(r.keyword) || r.keyword.includes(slug(i.name).substring(0, 4)));
    return { ...r, qty: Math.ceil(qty), catalogMatch };
  });
  const categories = [...new Set(results.map((r) => r.category))];
  const profileLabel = CONSUMPTION_PROFILES.find((p) => p.value === config.profile)?.label || '';
  return <>
    <section className="panel no-print">
      <div className="panel-head"><div><h3>Configuração do cálculo</h3><p>Informe os dados da instalação para estimar o consumo no período</p></div></div>
      <div className="form-grid">
        <Field label="Número de pessoas"><input type="number" min="1" step="1" value={config.people} onChange={(e) => setConfig({ ...config, people: e.target.value })} /></Field>
        <Field label="Número de banheiros"><input type="number" min="1" step="1" value={config.bathrooms} onChange={(e) => setConfig({ ...config, bathrooms: e.target.value })} /></Field>
        <Field label="Perfil de uso"><select value={config.profile} onChange={(e) => setConfig({ ...config, profile: e.target.value })}>{CONSUMPTION_PROFILES.map((p) => <option key={p.value} value={p.value}>{p.label} (x{p.mult})</option>)}</select></Field>
        <Field label="% de mulheres no local"><input type="number" min="0" max="100" step="1" value={config.femalePercent} onChange={(e) => setConfig({ ...config, femalePercent: e.target.value })} /></Field>
        <Field label="Limpezas por dia"><input type="number" min="1" step="1" value={config.cleaningsPerDay} onChange={(e) => setConfig({ ...config, cleaningsPerDay: e.target.value })} /></Field>
        <Field label="Dias úteis por semana"><input type="number" min="1" max="7" step="1" value={config.daysPerWeek} onChange={(e) => setConfig({ ...config, daysPerWeek: e.target.value })} /></Field>
        <Field label="Período de cálculo (dias)"><input type="number" min="1" step="1" value={config.periodDays} onChange={(e) => setConfig({ ...config, periodDays: e.target.value })} /></Field>
      </div>
    </section>
    <section className="panel no-print">
      <div className="panel-head">
        <div><h3>Taxas de consumo</h3><p>Médias de mercado ajustáveis conforme sua realidade</p></div>
        <button className="ghost-button" type="button" onClick={() => setShowRates(!showRates)}>{showRates ? 'Ocultar taxas' : 'Ajustar taxas'}</button>
      </div>
      {showRates ? <div className="table-wrap"><table><thead><tr><th>Produto</th><th>Base de cálculo</th><th>Taxa padrão</th><th>Ajuste personalizado</th></tr></thead><tbody>
        {rates.map((r, idx) => <tr key={r.id}>
          <td>{r.name}</td>
          <td><span className="badge neutral">{r.basis === 'person' ? 'por pessoa / dia' : r.basis === 'bathroom_clean' ? 'por banheiro / limpeza' : 'por banheiro / dia'}</span></td>
          <td className="mono">{r.rateBase} {r.unit}</td>
          <td><input type="number" min="0" step="any" value={r.rate} style={{ width: '90px' }} onChange={(e) => setRates(rates.map((x, i) => i === idx ? { ...x, rate: Number(e.target.value) } : x))} /></td>
        </tr>)}
      </tbody></table></div> : null}
    </section>
    <div className="report-print-header"><h2>Consumo Estimado - {config.periodDays} dias</h2><p>Perfil: {profileLabel} - {config.people} pessoas - {config.bathrooms} banheiro(s) - {config.daysPerWeek} dias úteis/semana - {Math.round(activeDays)} dias ativos</p></div>
    {categories.map((cat) => {
      const catItems = results.filter((r) => r.category === cat);
      return <section key={cat} className="panel">
        <div className="panel-head"><div><h3>{cat}</h3><p>Estimativa para {config.periodDays} dias ({Math.round(activeDays)} dias ativos)</p></div></div>
        <div className="table-wrap"><table><thead><tr><th>Produto</th><th>Estimativa</th><th>Un.</th><th>Item no catálogo</th><th>Estoque atual</th><th>Saldo estimado</th></tr></thead>
        <tbody>{catItems.map((r) => {
          const match = r.catalogMatch;
          const stockQty = match ? Number(match.quantity) : null;
          const balance = stockQty !== null ? stockQty - r.qty : null;
          const tone = balance === null ? 'neutral' : balance < 0 ? 'danger' : balance < r.qty * 0.2 ? 'warn' : 'success';
          return <tr key={r.id}>
            <td>{r.name}</td>
            <td><strong className="mono">{r.qty}</strong></td>
            <td>{r.unit}</td>
            <td>{match ? match.name : <span style={{ color: 'var(--muted)' }}>-</span>}</td>
            <td>{stockQty !== null ? <span className="mono">{stockQty} {match?.unit}</span> : <span style={{ color: 'var(--muted)' }}>-</span>}</td>
            <td>{balance !== null ? <span className={`badge ${tone}`}>{balance >= 0 ? `+${balance}` : balance} {match?.unit}</span> : <span style={{ color: 'var(--muted)' }}>-</span>}</td>
          </tr>;
        })}</tbody></table></div>
      </section>;
    })}
    <section className="panel no-print">
      <div className="panel-head"><div><h3>Como interpretar</h3><p>Legenda dos indicadores de saldo</p></div></div>
      <div className="stack">
        <div className="alert-card success"><strong>Verde -</strong> Estoque suficiente para cobrir o período com folga (&gt;20% de margem).</div>
        <div className="alert-card warn"><strong>Amarelo -</strong> Estoque cobre o período, mas com margem abaixo de 20%. Atenção ao prazo de reposição.</div>
        <div className="alert-card danger"><strong>Vermelho -</strong> Estoque insuficiente para o período. Reposição necessária.</div>
        <div className="alert-card"><strong>- (não mapeado) -</strong> Produto não encontrado no catálogo. Cadastre o item em <em>Itens</em> para monitorar o estoque.</div>
        <p className="subtle" style={{ fontSize: '12px', marginTop: '4px' }}>Aviso: os itens com unidade em mL ou g são estimativas brutas. Se o catálogo registra em litros ou kg, verifique a equivalência manualmente.</p>
      </div>
    </section>
  </>;
}
function SettingsPanel({ state, nextPurchaseDate, onSaveCycle, onSaveSettings, onUpdateConsumption }) { const [cycle, setCycle] = useState(state.cycle); const [settings, setSettings] = useState(state.settings); useEffect(() => { setCycle(state.cycle); setSettings(state.settings); }, [state.cycle, state.settings]); return <><section className="panel"><div className="panel-head"><div><h3>Configuração do ciclo</h3><p>Última compra geral e intervalo fixo</p></div><Badge tone="info">Próxima: {formatDate(safeIsoDate(nextPurchaseDate))}</Badge></div><form className="form-grid" onSubmit={(event) => { event.preventDefault(); onSaveCycle({ lastPurchaseDate: cycle.lastPurchaseDate, intervalDays: Number(cycle.intervalDays) }); }}><Field label="Última compra geral"><input type="date" value={cycle.lastPurchaseDate} onChange={(event) => setCycle({ ...cycle, lastPurchaseDate: event.target.value })} /></Field><Field label="Ciclo em dias"><input type="number" min="1" value={cycle.intervalDays} onChange={(event) => setCycle({ ...cycle, intervalDays: event.target.value })} /></Field><div className="actions-row"><button className="primary-button" type="submit">Salvar ciclo</button></div></form></section><section className="panel"><div className="panel-head"><div><h3>Consumo semanal por item</h3><p>Ajuste fino das estimativas de duração</p></div></div><div className="table-wrap"><table><thead><tr><th>Item</th><th>Unidade</th><th>Consumo semanal</th><th>Estoque atual</th></tr></thead><tbody>{state.items.map((item) => <tr key={item.id}><td>{item.name}</td><td>{item.unit}</td><td><input type="number" min="0" step="any" value={item.weeklyConsumption} onChange={(event) => onUpdateConsumption(item.id, Number(event.target.value))} /></td><td>{item.quantity} {item.unit}</td></tr>)}</tbody></table></div></section></>; }
function Field({ label, children }) { return <label className="field"><span>{label}</span>{children}</label>; }
function MetricCard({ label, value, tone = 'neutral' }) { return <article className={`metric ${tone}`}><span>{label}</span><strong>{value}</strong></article>; }
function Badge({ tone = 'neutral', children }) { return <span className={`badge ${tone}`}>{children}</span>; }
function AlertCard({ tone, title, text }) { return <article className={`alert-card ${tone}`}><strong>{title}</strong><p>{text}</p></article>; }
function EmptyState({ text }) { return <div className="empty-state">{text}</div>; }

export default App;













































































