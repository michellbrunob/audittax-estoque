import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createWorker } from 'tesseract.js';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker?url';
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

const STORAGE_KEY = 'controle-limpeza-react-v1';
const todayString = () => new Date().toISOString().split('T')[0];
const formatDate = (value) => new Date(`${value}T12:00:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
const addDays = (dateString, days) => { const date = new Date(`${dateString}T12:00:00`); date.setDate(date.getDate() + days); return date; };
const diffDays = (a, b) => Math.ceil((a - b) / 86400000);
const currency = (value) => Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const slug = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

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
  ['reader', 'Leitor de NF', 'Analise'],
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
  const [reader, setReader] = useState({ loading: false, error: '', fileName: '', preview: '', parsed: null, draftItems: [], supplierId: '' });
  const timer = useRef(null);

  useEffect(() => { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }, [state]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const itemsById = useMemo(() => Object.fromEntries(state.items.map((item) => [item.id, item])), [state.items]);
  const suppliersById = useMemo(() => Object.fromEntries(state.suppliers.map((supplier) => [supplier.id, supplier])), [state.suppliers]);
  const nextPurchaseDate = useMemo(() => addDays(state.cycle.lastPurchaseDate, Number(state.cycle.intervalDays)), [state.cycle]);
  const daysUntilNextPurchase = useMemo(() => diffDays(nextPurchaseDate, new Date()), [nextPurchaseDate]);
  const durationForItem = (item) => !item.weeklyConsumption ? Infinity : Math.floor((item.quantity / item.weeklyConsumption) * 7);
  const lowStockItems = state.items.filter((item) => item.quantity <= item.minStock);
  const vulnerableItems = state.items.filter((item) => durationForItem(item) < daysUntilNextPurchase);
  const priceMap = useMemo(() => { const grouped = {}; state.priceHistory.forEach((row) => { if (!grouped[row.itemId]) grouped[row.itemId] = []; grouped[row.itemId].push(row); }); Object.values(grouped).forEach((rows) => rows.sort((a, b) => a.date.localeCompare(b.date))); return grouped; }, [state.priceHistory]);

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
    setReader({ loading: true, error: '', fileName: file.name, preview: '', parsed: null, draftItems: [], supplierId: '' });
    let worker;
    try {
      if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
        const rendered = await renderPdfFirstPage(file);
        previewDataUrl = rendered.dataUrl;
        sourceForOcr = rendered.blob;
      } else {
        previewDataUrl = String(await fileToDataUrl(file));
      }
      worker = await createWorker('por');
      const result = await worker.recognize(sourceForOcr);
      const parsed = parseReceiptText(result.data.text, state.items);
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
      setReader({ loading: false, error: '', fileName: file.name, preview: previewDataUrl, parsed, draftItems, supplierId: '' });
      showFlash('Comprovante lido com OCR local.');
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
      const market = reader.parsed.mercado || 'Mercado nao identificado';
      const date = reader.parsed.data || todayString();
      reader.draftItems.filter((entry) => entry.include && entry.nome).forEach((entry) => {
        const matchName = slug(entry.item_cadastrado || entry.nome);
        let item = next.items.find((candidate) => slug(candidate.name) === matchName);
        if (!item) { item = { id: next.counters.item, name: entry.nome, unit: entry.unidade || 'un', quantity: 0, minStock: 1, weeklyConsumption: 0 }; next.items.push(item); next.counters.item += 1; }
        item.quantity = Number((item.quantity + Number(entry.quantidade || 0)).toFixed(2));
        next.movements.push({ id: next.counters.movement, type: 'entrada', itemId: item.id, quantity: Number(entry.quantidade || 0), date, notes: `NF - ${market}` });
        next.counters.movement += 1;
        if (entry.preco_unitario) { next.priceHistory.push({ id: next.counters.price, itemId: item.id, supplierId: Number(reader.supplierId || 0) || undefined, market, price: Number(entry.preco_unitario), date }); next.counters.price += 1; }
      });
      return next;
    }, 'Itens importados do comprovante.');
    setReader({ loading: false, error: '', fileName: '', preview: '', parsed: null, draftItems: [], supplierId: '' });
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
        <header className="topbar"><div><p className="eyebrow">Reserva Fiscal • Setor de limpeza</p><h2>{screens.find((screenItem) => screenItem[0] === screen)?.[1]}</h2><p className="subtle">{state.items.length} itens cadastrados, proxima compra em {formatDate(nextPurchaseDate.toISOString().split('T')[0])}</p></div>{flash ? <div className={`flash ${flash.tone}`}>{flash.message}</div> : null}</header>

        {screen === 'dashboard' ? <><div className="metrics"><MetricCard label="Itens ativos" value={state.items.length} /><MetricCard label="Abaixo do minimo" value={lowStockItems.length} tone={lowStockItems.length ? 'danger' : 'success'} /><MetricCard label="Nao chegam ate a compra" value={vulnerableItems.length} tone={vulnerableItems.length ? 'warn' : 'success'} /><MetricCard label="Custo extra no ciclo" value={currency(state.extraPurchases.reduce((sum, entry) => sum + entry.cost, 0))} tone="warn" /></div><div className="panel-grid"><section className="panel"><div className="panel-head"><div><h3>Alertas automaticos</h3><p>Compra geral prevista para {formatDate(nextPurchaseDate.toISOString().split('T')[0])}</p></div><Badge tone={daysUntilNextPurchase <= 7 ? 'danger' : 'info'}>{daysUntilNextPurchase} dias restantes</Badge></div>{!lowStockItems.length && !vulnerableItems.length ? <EmptyState text="Nenhum alerta no momento." /> : <div className="stack">{lowStockItems.map((item) => <AlertCard key={`low-${item.id}`} tone="danger" title={`${item.name} abaixo do estoque minimo`} text={`Atual ${item.quantity} ${item.unit}. Minimo ${item.minStock} ${item.unit}.`} />)}{vulnerableItems.map((item) => <AlertCard key={`vul-${item.id}`} tone="warn" title={`${item.name} nao chega ate a proxima compra`} text={`Duracao estimada: ${durationForItem(item)} dias.`} />)}</div>}</section><section className="panel"><div className="panel-head"><div><h3>Ultimas movimentacoes</h3><p>Entradas, saidas e reposicoes avulsas</p></div></div><div className="stack">{[...state.movements].slice(-6).reverse().map((entry) => <div className="history-row" key={entry.id}><span className={`dot ${entry.type}`}></span><div className="history-main"><strong>{entry.type === 'entrada' ? '+' : '-'}{entry.quantity}</strong> {itemsById[entry.itemId]?.name || 'Item removido'} <span className="sub-note">{entry.notes}</span></div><span className="mono">{formatDate(entry.date)}</span></div>)}</div></section></div></> : null}

        {screen === 'cycle' ? <><section className={`panel cycle-banner ${daysUntilNextPurchase <= 7 ? 'danger' : daysUntilNextPurchase <= 20 ? 'warn' : 'success'}`}><div><p className="eyebrow">Proxima compra geral</p><h3>{daysUntilNextPurchase} dias</h3><p>Data prevista: {formatDate(nextPurchaseDate.toISOString().split('T')[0])}</p></div><div className="cycle-meter"><div className="progress"><span style={{ width: `${cycleProgress}%` }}></span></div><p>Custo extra no ciclo atual: {currency(state.extraPurchases.filter((entry) => new Date(`${entry.date}T00:00:00`) >= new Date(`${state.cycle.lastPurchaseDate}T00:00:00`)).reduce((sum, entry) => sum + entry.cost, 0))}</p></div></section><section className="panel"><div className="panel-head"><div><h3>Itens vs proxima compra</h3><p>Quais itens aguentam ate o fechamento do ciclo</p></div></div><div className="table-wrap"><table><thead><tr><th>Item</th><th>Estoque</th><th>Esgota em</th><th>Dias restantes</th><th>Situacao</th></tr></thead><tbody>{state.items.map((item) => { const days = durationForItem(item); return <tr key={item.id}><td>{item.name}</td><td>{item.quantity} {item.unit}</td><td>{Number.isFinite(days) ? `${days} dias` : 'Sem consumo'}</td><td>{daysUntilNextPurchase}</td><td><Badge tone={days >= daysUntilNextPurchase ? 'success' : 'warn'}>{days >= daysUntilNextPurchase ? 'Aguenta o ciclo' : 'Precisa repor'}</Badge></td></tr>; })}</tbody></table></div></section></> : null}

        {screen === 'timeline' ? <section className="panel"><div className="panel-head"><div><h3>Linha do tempo cronologica</h3><p>Esgotamentos projetados, reposicoes avulsas e compra geral</p></div></div><div className="timeline">{state.items.map((item) => ({ id: `item-${item.id}`, date: addDays(todayString(), Number.isFinite(durationForItem(item)) ? durationForItem(item) : 3650).toISOString().split('T')[0], tone: durationForItem(item) <= 7 ? 'danger' : durationForItem(item) <= daysUntilNextPurchase ? 'warn' : 'success', title: `${item.name} deve acabar`, subtitle: `${item.quantity} ${item.unit} em estoque, consumo ${item.weeklyConsumption} ${item.unit}/semana` })).concat(state.extraPurchases.map((entry) => ({ id: `extra-${entry.id}`, date: entry.date, tone: 'info', title: `Reposicao avulsa de ${itemsById[entry.itemId]?.name || 'Item removido'}`, subtitle: `${entry.quantity} ${itemsById[entry.itemId]?.unit || ''} em ${suppliersById[entry.supplierId]?.name || entry.location || 'local nao informado'} por ${currency(entry.cost)}` }))).concat([{ id: 'cycle', date: nextPurchaseDate.toISOString().split('T')[0], tone: 'neutral', title: 'Proxima compra geral', subtitle: `Ciclo fixo de ${state.cycle.intervalDays} dias` }]).sort((a, b) => new Date(`${a.date}T00:00:00`) - new Date(`${b.date}T00:00:00`)).map((event) => <div className="timeline-item" key={event.id}><span className={`timeline-dot ${event.tone}`}></span><div><span className="mono">{formatDate(event.date)}</span><h4>{event.title}</h4><p>{event.subtitle}</p></div></div>)}</div></section> : null}

        {screen === 'items' ? <section className="panel"><div className="panel-head"><div><h3>Cadastro de itens</h3><p>Produtos monitorados no estoque do setor</p></div></div><div className="table-wrap"><table><thead><tr><th>Item</th><th>Unidade</th><th>Quantidade</th><th>Minimo</th><th>Consumo semanal</th></tr></thead><tbody>{state.items.map((item) => <tr key={item.id}><td>{item.name}</td><td>{item.unit}</td><td>{item.quantity}</td><td>{item.minStock}</td><td>{item.weeklyConsumption}</td></tr>)}</tbody></table></div></section> : null}
        {screen === 'entry' ? <MovementForm title="Registrar entrada" items={state.items} onSubmit={(payload) => registerMovement({ ...payload, type: 'entrada' })} /> : null}
        {screen === 'output' ? <MovementForm title="Registrar saida" items={state.items} onSubmit={(payload) => registerMovement({ ...payload, type: 'saida' })} /> : null}
        {screen === 'extra' ? <ExtraForm items={state.items} entries={state.extraPurchases} onSubmit={registerExtra} itemsById={itemsById} suppliers={state.suppliers} suppliersById={suppliersById} /> : null}
        {screen === 'history' ? <section className="panel"><div className="panel-head"><div><h3>Historico completo</h3><p>Movimentacoes filtraveis por item</p></div><select value={historyFilter} onChange={(event) => setHistoryFilter(event.target.value)}><option value="">Todos os itens</option>{state.items.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div><div className="stack">{[...state.movements].reverse().filter((entry) => !historyFilter || String(entry.itemId) === historyFilter).map((entry) => <div className="history-row" key={entry.id}><span className={`dot ${entry.type}`}></span><div className="history-main"><strong>{entry.type === 'entrada' ? '+' : '-'}{entry.quantity} {itemsById[entry.itemId]?.unit || ''}</strong> {itemsById[entry.itemId]?.name || 'Item removido'} <span className="sub-note">{entry.notes}</span></div><span className="mono">{formatDate(entry.date)}</span></div>)}</div></section> : null}
        {screen === 'reader' ? <ReaderPanel state={reader} items={state.items} suppliers={state.suppliers} onAnalyze={analyzeReceipt} onConfirm={confirmReaderImport} onDraftChange={(draftItems) => setReader((current) => ({ ...current, draftItems }))} onSupplierChange={(supplierId) => setReader((current) => ({ ...current, supplierId }))} onReset={() => setReader({ loading: false, error: '', fileName: '', preview: '', parsed: null, draftItems: [], supplierId: '' })} /> : null}
        {screen === 'prices' ? <PricesPanel items={!priceFilter ? state.items : state.items.filter((item) => String(item.id) === priceFilter)} allItems={state.items} suppliers={state.suppliers} suppliersById={suppliersById} priceMap={priceMap} filter={priceFilter} onFilterChange={setPriceFilter} onSubmit={addPrice} /> : null}
        {screen === 'duration' ? <section><section className="panel"><div className="panel-head"><div><h3>Estimativa de duracao</h3><p>Baseada no consumo semanal configurado</p></div></div>{vulnerableItems.length ? <div className="stack">{vulnerableItems.map((item) => <AlertCard key={item.id} tone="warn" title={`${item.name} nao chega ate a proxima compra`} text={`Duracao estimada de ${durationForItem(item)} dias.`} />)}</div> : <EmptyState text="Todos os itens configurados aguentam ate a proxima compra." />}</section><section className="panel"><div className="stack">{state.items.map((item) => { const days = durationForItem(item); const tone = days <= 7 ? 'danger' : days <= 21 ? 'warn' : 'success'; const width = Number.isFinite(days) ? Math.min(100, (days / 60) * 100) : 100; return <div className="duration-card" key={item.id}><div className="panel-head"><div><h3>{item.name}</h3><p>{item.quantity} {item.unit} em estoque, {item.weeklyConsumption || 0} {item.unit}/semana</p></div><Badge tone={tone}>{Number.isFinite(days) ? `${days} dias` : 'Sem consumo configurado'}</Badge></div><div className="progress duration"><span className={tone} style={{ width: `${width}%` }}></span></div></div>; })}</div></section></section> : null}
        {screen === 'receipts' ? <ReceiptsPanel open={receiptOpen} password={receiptPassword} onPasswordChange={setReceiptPassword} onUnlock={() => { if (receiptPassword === state.settings.receiptPassword) { setReceiptOpen(true); setReceiptPassword(''); showFlash('Area de comprovantes liberada.'); } else { showFlash('Senha incorreta.', 'error'); } }} onLock={() => setReceiptOpen(false)} receipts={state.receipts} onAdd={addReceipt} /> : null}
        {screen === 'suppliers' ? <SuppliersPanel suppliers={state.suppliers} priceHistory={state.priceHistory} extraPurchases={state.extraPurchases} onSubmit={addSupplier} onUpdate={updateSupplier} onDelete={deleteSupplier} /> : null}
        {screen === 'settings' ? <SettingsPanel state={state} nextPurchaseDate={nextPurchaseDate} onSaveCycle={updateCycle} onSaveSettings={saveSettings} onUpdateConsumption={updateConsumption} /> : null}
        <section className="panel"><NewItemForm onSubmit={addItem} /></section>
      </main>
    </div>
  );
}

function MovementForm({ title, items, onSubmit }) { const [form, setForm] = useState({ itemId: String(items[0]?.id || ''), quantity: 1, date: todayString(), notes: '' }); return <section className="panel"><div className="panel-head"><div><h3>{title}</h3><p>Registro de movimentacao de estoque</p></div></div><form className="form-grid" onSubmit={(event) => { event.preventDefault(); onSubmit({ itemId: Number(form.itemId), quantity: Number(form.quantity), date: form.date, notes: form.notes }); setForm({ itemId: String(items[0]?.id || ''), quantity: 1, date: todayString(), notes: '' }); }}><Field label="Item"><select value={form.itemId} onChange={(event) => setForm({ ...form, itemId: event.target.value })}>{items.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field><Field label="Quantidade"><input type="number" min="0.01" step="0.01" value={form.quantity} onChange={(event) => setForm({ ...form, quantity: event.target.value })} /></Field><Field label="Data"><input type="date" value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} /></Field><Field label="Observacao"><input value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></Field><div className="actions-row"><button className="primary-button" type="submit">Salvar</button></div></form></section>; }
function ExtraForm({ items, entries, onSubmit, itemsById, suppliers, suppliersById }) { const [form, setForm] = useState({ itemId: String(items[0]?.id || ''), quantity: 1, date: todayString(), cost: '', reason: '', supplierId: String(suppliers[0]?.id || ''), location: '' }); return <><section className="panel"><div className="panel-head"><div><h3>Registrar reposicao avulsa</h3><p>Compras fora do ciclo fixo com custo e motivo</p></div></div><form className="form-grid" onSubmit={(event) => { event.preventDefault(); onSubmit({ itemId: Number(form.itemId), quantity: Number(form.quantity), date: form.date, cost: Number(form.cost || 0), reason: form.reason, supplierId: Number(form.supplierId), location: '' }); setForm({ itemId: String(items[0]?.id || ''), quantity: 1, date: todayString(), cost: '', reason: '', supplierId: String(suppliers[0]?.id || ''), location: '' }); }}><Field label="Item"><select value={form.itemId} onChange={(event) => setForm({ ...form, itemId: event.target.value })}>{items.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field><Field label="Quantidade"><input type="number" min="0.01" step="0.01" value={form.quantity} onChange={(event) => setForm({ ...form, quantity: event.target.value })} /></Field><Field label="Data"><input type="date" value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} /></Field><Field label="Custo"><input type="number" min="0" step="0.01" value={form.cost} onChange={(event) => setForm({ ...form, cost: event.target.value })} /></Field><Field label="Motivo"><input value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} /></Field><Field label="Fornecedor"><select value={form.supplierId} onChange={(event) => setForm({ ...form, supplierId: event.target.value })}>{suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></Field><div className="actions-row"><button className="primary-button" type="submit">Salvar reposicao</button></div></form></section><section className="panel"><div className="panel-head"><div><h3>Historico de reposicoes avulsas</h3><p>Compras fora do planejamento</p></div></div><div className="stack">{entries.map((entry) => <div className="entry-card" key={entry.id}><div><strong>{itemsById[entry.itemId]?.name || 'Item removido'}</strong><p>{entry.reason}</p></div><div className="entry-meta"><span>{entry.quantity} {itemsById[entry.itemId]?.unit || ''}</span><span>{currency(entry.cost)}</span><span>{formatDate(entry.date)}</span><span>{suppliersById[entry.supplierId]?.name || entry.location || 'Fornecedor nao informado'}</span></div></div>)}</div></section></>; }
function ReaderPanel({ state, items, suppliers, onAnalyze, onConfirm, onDraftChange, onSupplierChange, onReset }) {
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
  return <><section className="panel"><div className="panel-head"><div><h3>Upload do comprovante</h3><p>Envie imagem ou PDF. O OCR local extrai os itens e abre a conferencia antes da importacao.</p></div>{state.preview || state.draftItems?.length ? <button className="ghost-button" onClick={onReset}>Limpar leitura</button> : null}</div><label className={`dropzone ${state.loading ? 'loading' : ''}`}><input type="file" accept="image/*,.pdf,application/pdf" onChange={(event) => { const file = event.target.files?.[0]; if (file) onAnalyze(file); }} /><strong>{state.loading ? 'Processando comprovante...' : 'Selecionar comprovante'}</strong><p>{state.fileName || 'Imagem ou PDF do comprovante para importar itens'}</p></label>{state.error ? <p className="error-text">{state.error}</p> : null}{state.preview ? <div className="preview-shell"><img className="preview" src={state.preview} alt="Preview do comprovante" /></div> : null}</section>{state.parsed ? <section className="panel"><div className="panel-head"><div><h3>Conferencia da importacao</h3><p>{state.parsed.mercado || 'Mercado nao identificado'} em {formatDate(state.parsed.data || todayString())} - ajuste item, quantidade, valor, vinculacao e fornecedor antes de importar.</p></div><div className="reader-summary"><Badge tone="info">{importCount} item(ns)</Badge><Badge tone="neutral">Soma dos itens {currency(importTotal)}</Badge>{receiptTotal ? <Badge tone={totalDiff <= 0.5 ? 'success' : 'warn'}>Total da nota {currency(receiptTotal)}</Badge> : null}<button className="primary-button" onClick={onConfirm}>Importar itens</button></div></div><div className="reader-summary" style={{ marginBottom: '14px' }}><Field label="Fornecedor"><select value={state.supplierId || ''} onChange={(event) => onSupplierChange(event.target.value)}><option value="">Fornecedor nao informado</option>{suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></Field></div>{receiptTotal ? <div className="total-audit"><strong>Diferenca entre total da nota e itens:</strong> <span className={totalDiff <= 0.5 ? 'audit-good' : 'audit-warn'}>{currency(totalDiff)}</span></div> : null}<div className="table-wrap"><table><thead><tr><th>Importar</th><th>Item lido</th><th>Vincular a item cadastrado</th><th>Qtd</th><th>Un</th><th>Valor unit.</th><th>Total linha</th><th>Confianca</th><th></th></tr></thead><tbody>{(state.draftItems || []).map((entry) => { const lineTotal = computeLineTotal(entry.quantidade, entry.preco_unitario, entry.unidade); return <tr key={entry.id}><td><input type="checkbox" checked={entry.include} onChange={(event) => updateDraftItem(entry.id, 'include', event.target.checked)} /></td><td><div className="ocr-cell"><input value={entry.nome} onChange={(event) => updateDraftItem(entry.id, 'nome', event.target.value)} />{entry.rawLine ? <small>{entry.rawLine}</small> : null}</div></td><td><select value={entry.matchedItemId || ''} onChange={(event) => updateDraftItem(entry.id, 'matchedItemId', event.target.value)}><option value="">Criar como novo item</option>{items.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></td><td><input type="number" min="0" step="0.01" value={entry.quantidade} onChange={(event) => updateDraftItem(entry.id, 'quantidade', Number(event.target.value))} /></td><td><select value={normalizeUnit(entry.unidade || 'un')} onChange={(event) => updateDraftItem(entry.id, 'unidade', event.target.value)}>{UNIT_OPTIONS.map((unit) => <option key={unit.value} value={unit.value}>{unit.value}</option>)}</select></td><td><input type="number" min="0" step="0.01" value={entry.preco_unitario} onChange={(event) => updateDraftItem(entry.id, 'preco_unitario', Number(event.target.value))} /></td><td>{currency(lineTotal)}</td><td><Badge tone={entry.confidence >= 0.75 ? 'success' : entry.confidence >= 0.5 ? 'warn' : 'danger'}>{Math.round(Number(entry.confidence || 0) * 100)}%</Badge></td><td><button className="table-action" onClick={() => removeDraftItem(entry.id)}>Excluir</button></td></tr>; })}</tbody></table></div></section> : null}</>;
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
 function ReceiptsPanel({ open, password, onPasswordChange, onUnlock, onLock, receipts, onAdd }) { const [form, setForm] = useState({ title: '', value: '', date: todayString(), notes: '' }); if (!open) return <section className="panel lock-panel"><h3>Area protegida por senha</h3><p>Os comprovantes ficam separados do restante do sistema.</p><div className="lock-row"><input type="password" value={password} onChange={(event) => onPasswordChange(event.target.value)} placeholder="Senha" /><button className="primary-button" onClick={onUnlock}>Entrar</button></div></section>; return <><section className="panel"><div className="panel-head"><div><h3>Comprovantes protegidos</h3><p>Registros armazenados com valor, data e observacao</p></div><button className="ghost-button" onClick={onLock}>Fechar area</button></div><form className="form-grid" onSubmit={(event) => { event.preventDefault(); onAdd({ title: form.title, value: Number(form.value), date: form.date, notes: form.notes }); setForm({ title: '', value: '', date: todayString(), notes: '' }); }}><Field label="Titulo"><input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} /></Field><Field label="Valor"><input type="number" min="0" step="0.01" value={form.value} onChange={(event) => setForm({ ...form, value: event.target.value })} /></Field><Field label="Data"><input type="date" value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} /></Field><Field label="Observacao"><input value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></Field><div className="actions-row"><button className="primary-button" type="submit">Salvar comprovante</button></div></form></section><section className="panel card-grid">{receipts.map((receipt) => <article className="receipt-card" key={receipt.id}><strong>{receipt.title}</strong><p>{currency(receipt.value)}</p><span>{formatDate(receipt.date)}</span><small>{receipt.notes || 'Sem observacao'}</small></article>)}</section></>; }
function SettingsPanel({ state, nextPurchaseDate, onSaveCycle, onSaveSettings, onUpdateConsumption }) { const [cycle, setCycle] = useState(state.cycle); const [settings, setSettings] = useState(state.settings); useEffect(() => { setCycle(state.cycle); setSettings(state.settings); }, [state.cycle, state.settings]); return <><section className="panel"><div className="panel-head"><div><h3>Configuracao do ciclo</h3><p>Ultima compra geral e intervalo fixo</p></div><Badge tone="info">Proxima: {formatDate(nextPurchaseDate.toISOString().split('T')[0])}</Badge></div><form className="form-grid" onSubmit={(event) => { event.preventDefault(); onSaveCycle({ lastPurchaseDate: cycle.lastPurchaseDate, intervalDays: Number(cycle.intervalDays) }); }}><Field label="Ultima compra geral"><input type="date" value={cycle.lastPurchaseDate} onChange={(event) => setCycle({ ...cycle, lastPurchaseDate: event.target.value })} /></Field><Field label="Ciclo em dias"><input type="number" min="1" value={cycle.intervalDays} onChange={(event) => setCycle({ ...cycle, intervalDays: event.target.value })} /></Field><div className="actions-row"><button className="primary-button" type="submit">Salvar ciclo</button></div></form></section><section className="panel"><div className="panel-head"><div><h3>Seguranca e OCR local</h3><p>Senha dos comprovantes e informacoes do modo de leitura local</p></div></div><form className="form-grid" onSubmit={(event) => { event.preventDefault(); onSaveSettings(settings); }}><Field label="Senha dos comprovantes"><input type="password" value={settings.receiptPassword} onChange={(event) => setSettings({ ...settings, receiptPassword: event.target.value })} /></Field><Field label="OCR local"><input value="Tesseract.js ativo neste navegador" readOnly /></Field><div className="actions-row"><button className="primary-button" type="submit">Salvar configuracoes</button></div></form></section><section className="panel"><div className="panel-head"><div><h3>Consumo semanal por item</h3><p>Ajuste fino das estimativas de duracao</p></div></div><div className="table-wrap"><table><thead><tr><th>Item</th><th>Unidade</th><th>Consumo semanal</th><th>Estoque atual</th></tr></thead><tbody>{state.items.map((item) => <tr key={item.id}><td>{item.name}</td><td>{item.unit}</td><td><input type="number" min="0" step="0.1" value={item.weeklyConsumption} onChange={(event) => onUpdateConsumption(item.id, Number(event.target.value))} /></td><td>{item.quantity} {item.unit}</td></tr>)}</tbody></table></div></section></>; }
function NewItemForm({ onSubmit }) { const [form, setForm] = useState({ name: '', unit: 'un', quantity: '', minStock: '', weeklyConsumption: '' }); return <><div className="panel-head"><div><h3>Novo item</h3><p>Cadastro rapido para ampliar o estoque base</p></div></div><form className="form-grid" onSubmit={(event) => { event.preventDefault(); if (!form.name.trim()) return; onSubmit({ name: form.name.trim(), unit: normalizeUnit(form.unit) || 'un', quantity: Number(form.quantity || 0), minStock: Number(form.minStock || 0), weeklyConsumption: Number(form.weeklyConsumption || 0) }); setForm({ name: '', unit: 'un', quantity: '', minStock: '', weeklyConsumption: '' }); }}><Field label="Nome"><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></Field><Field label="Unidade"><select value={form.unit} onChange={(event) => setForm({ ...form, unit: event.target.value })}>{UNIT_OPTIONS.map((unit) => <option key={unit.value} value={unit.value}>{unit.label}</option>)}</select></Field><Field label="Quantidade inicial"><input type="number" min="0" step="0.01" value={form.quantity} onChange={(event) => setForm({ ...form, quantity: event.target.value })} /></Field><Field label="Estoque minimo"><input type="number" min="0" step="0.01" value={form.minStock} onChange={(event) => setForm({ ...form, minStock: event.target.value })} /></Field><Field label="Consumo semanal"><input type="number" min="0" step="0.01" value={form.weeklyConsumption} onChange={(event) => setForm({ ...form, weeklyConsumption: event.target.value })} /></Field><div className="actions-row"><button className="primary-button" type="submit">Cadastrar item</button></div></form></>; }
function Field({ label, children }) { return <label className="field"><span>{label}</span>{children}</label>; }
function MetricCard({ label, value, tone = 'neutral' }) { return <article className={`metric ${tone}`}><span>{label}</span><strong>{value}</strong></article>; }
function Badge({ tone = 'neutral', children }) { return <span className={`badge ${tone}`}>{children}</span>; }
function AlertCard({ tone, title, text }) { return <article className={`alert-card ${tone}`}><strong>{title}</strong><p>{text}</p></article>; }
function EmptyState({ text }) { return <div className="empty-state">{text}</div>; }

export default App;
































