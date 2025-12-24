
import { parseCSV } from './csv.js';
import { idbGet, idbSet, idbDel } from './idb.js';

const $ = (sel) => document.querySelector(sel);

const KEYS = {
  dataset: 'dataset_v1',
  scanned: 'scanned_v1',
  mapping: 'mapping_v1',
  ui: 'ui_v1'
};

const DEFAULT_MAPPING = {
  stock: null,
  condition: null,
  model: null,
  make: null,
  calibre: null
};

const CANDIDATES = {
  stock: ['stocknumber','stock number','stock no','stockno','stock','stock#','stock #','stock_num','stock num','stockid','stock id','item','item number','item no'],
  condition: ['condition','cond','state','status'],
  model: ['model','rifle model','product model'],
  make: ['make','brand','manufacturer'],
  calibre: ['calibre','caliber','cal','caliber/ga','calibre/ga']
};

function norm(s){ return String(s||'').trim().toLowerCase(); }

function autoMap(headers){
  const m = { ...DEFAULT_MAPPING };
  const hNorm = headers.map(norm);
  for (const key of Object.keys(CANDIDATES)) {
    for (const cand of CANDIDATES[key]) {
      const idx = hNorm.indexOf(cand);
      if (idx !== -1) { m[key] = headers[idx]; break; }
    }
  }
  return m;
}

function safeVal(row, col){
  if (!col) return '';
  const v = row[col];
  return (v === undefined || v === null) ? '' : String(v).trim();
}

function toObjects(headers, rows){
  return rows.map(r => {
    const o = {};
    headers.forEach((h, i) => o[h] = (r[i] ?? '').toString().trim());
    return o;
  });
}

function hashText(str){
  // simple hash for dataset id
  let h = 2166136261;
  for (let i=0;i<str.length;i++){
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

function setToast(msg, kind='info'){
  const el = $('#toast');
  el.textContent = msg;
  el.dataset.kind = kind;
  el.classList.add('show');
  clearTimeout(setToast._t);
  setToast._t = setTimeout(()=>el.classList.remove('show'), 2200);
}

function haptic(kind='success'){
  // best-effort haptic for iOS
  try {
    if (window.navigator.vibrate) window.navigator.vibrate(kind==='warn'?30:15);
  } catch {}
}

function formatRowLine(row, mapping){
  const parts = [];
  const stock = safeVal(row, mapping.stock);
  const make = safeVal(row, mapping.make);
  const model = safeVal(row, mapping.model);
  const cal = safeVal(row, mapping.calibre);
  if (make) parts.push(make);
  if (model) parts.push(model);
  if (cal) parts.push(cal);
  return { stock, meta: parts.join(' • ') };
}

function normalizeCondition(val){
  const v = norm(val);
  if (!v) return '';
  if (v === 'new') return 'New';
  if (v === 'used') return 'Used';
  if (v === 'all') return 'All';
  // keep original case-ish
  return val.trim();
}

function filterRows(rows, mapping, filters){
  const condCol = mapping.condition;
  const modelCol = mapping.model;
  const stockCol = mapping.stock;

  const targetCond = filters.condition; // 'New'/'Used'/'All'
  const targetModel = filters.model; // exact string or ''

  return rows.filter(r => {
    const stock = safeVal(r, stockCol);
    if (!stock) return false;
    const cond = safeVal(r, condCol);
    const model = safeVal(r, modelCol);

    const condOk = (targetCond === 'All') ? true : (norm(cond) === norm(targetCond));
    const modelOk = (!targetModel) ? true : (model === targetModel);
    return condOk && modelOk;
  });
}

function uniqueModels(rows, mapping, condition){
  const modelCol = mapping.model;
  const condCol = mapping.condition;
  const set = new Set();
  rows.forEach(r => {
    const cond = safeVal(r, condCol);
    if (condition !== 'All' && norm(cond) !== norm(condition)) return;
    const m = safeVal(r, modelCol);
    if (m) set.add(m);
  });
  return Array.from(set).sort((a,b)=>a.localeCompare(b));
}

function downloadText(filename, text){
  const blob = new Blob([text], {type: 'text/csv;charset=utf-8'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 2000);
}

function toCSV(headers, objs){
  const esc = (v) => {
    const s = (v ?? '').toString();
    if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  };
  const lines = [];
  lines.push(headers.map(esc).join(','));
  for (const o of objs){
    lines.push(headers.map(h => esc(o[h])).join(','));
  }
  return lines.join('\n');
}

async function loadState(){
  const dataset = await idbGet(KEYS.dataset);
  const scanned = await idbGet(KEYS.scanned) || {};
  const mapping = await idbGet(KEYS.mapping) || { ...DEFAULT_MAPPING };
  const ui = await idbGet(KEYS.ui) || { condition: 'New', model: '', tab: 'missing' };
  return { dataset, scanned, mapping, ui };
}

async function saveUI(ui){ await idbSet(KEYS.ui, ui); }

function renderNoData(){
  $('#hasData').hidden = true;
  $('#noData').hidden = false;
  $('#datasetInfo').textContent = 'No CSV loaded yet.';
}

function renderDataShell(){
  $('#noData').hidden = true;
  $('#hasData').hidden = false;
}

function renderMappingModal(headers, mapping){
  const keys = [
    ['stock','Stock Number (barcode)'],
    ['condition','Condition'],
    ['model','Model'],
    ['make','Make (optional)'],
    ['calibre','Calibre (optional)'],
  ];
  const body = $('#mappingBody');
  body.innerHTML = '';
  for (const [key, label] of keys){
    const wrap = document.createElement('div');
    wrap.className = 'mapRow';
    const l = document.createElement('label');
    l.textContent = label;
    l.htmlFor = `map_${key}`;
    const sel = document.createElement('select');
    sel.id = `map_${key}`;
    const optBlank = document.createElement('option');
    optBlank.value = '';
    optBlank.textContent = key==='stock'||key==='condition'||key==='model' ? '— Select —' : '— None —';
    sel.appendChild(optBlank);
    headers.forEach(h => {
      const opt = document.createElement('option');
      opt.value = h; opt.textContent = h;
      if (mapping[key] === h) opt.selected = true;
      sel.appendChild(opt);
    });
    wrap.appendChild(l);
    wrap.appendChild(sel);
    body.appendChild(wrap);
  }
  $('#mappingModal').showModal();
}

function renderFilters(models, ui){
  $('#conditionSel').value = ui.condition;
  const modelSel = $('#modelSel');
  const current = ui.model || '';
  modelSel.innerHTML = '';
  const optAll = document.createElement('option');
  optAll.value = '';
  optAll.textContent = 'All Models';
  modelSel.appendChild(optAll);
  models.forEach(m => {
    const opt = document.createElement('option');
    opt.value = m; opt.textContent = m;
    if (m === current) opt.selected = true;
    modelSel.appendChild(opt);
  });
  // show selection line
  $('#activeFilters').textContent = `Condition: ${ui.condition} • Model: ${ui.model || 'All'}`;
}

function renderCounters(expected, scannedCount, missing){
  $('#expectedVal').textContent = expected.toString();
  $('#scannedVal').textContent = scannedCount.toString();
  $('#missingVal').textContent = missing.toString();
}

function renderList(listEl, items, scannedSet){
  listEl.innerHTML = '';
  if (!items.length){
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'Nothing to show.';
    listEl.appendChild(empty);
    return;
  }
  for (const it of items){
    const row = document.createElement('div');
    row.className = 'row';
    const left = document.createElement('div');
    left.className = 'left';
    const stock = document.createElement('div');
    stock.className = 'stock';
    stock.textContent = it.stock;
    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = it.meta || '';
    left.appendChild(stock);
    left.appendChild(meta);
    const pill = document.createElement('div');
    pill.className = 'pill ' + (scannedSet.has(it.stock) ? 'ok' : 'miss');
    pill.textContent = scannedSet.has(it.stock) ? 'SCANNED' : 'MISSING';
    row.appendChild(left);
    row.appendChild(pill);
    listEl.appendChild(row);
  }
}

async function main(){
  // Register SW
  if ('serviceWorker' in navigator) {
    try { await navigator.serviceWorker.register('./sw.js'); } catch {}
  }

  const state = await loadState();

  if (!state.dataset){
    renderNoData();
  } else {
    renderDataShell();
  }

  // Wire import
  $('#importBtn').addEventListener('click', () => $('#fileInput').click());
  $('#fileInput').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const parsed = parseCSV(text);
    if (!parsed.length || parsed.length < 2){
      setToast('CSV looks empty or invalid.', 'error'); return;
    }
    const headers = parsed[0];
    const rows = parsed.slice(1);
    const objs = toObjects(headers, rows);
    const dataset = {
      id: hashText(text),
      name: file.name,
      loadedAt: new Date().toISOString(),
      headers,
      rows: objs
    };
    const mapping = autoMap(headers);
    await idbSet(KEYS.dataset, dataset);
    await idbSet(KEYS.mapping, mapping);
    await idbSet(KEYS.scanned, {}); // reset scans for new dataset
    await idbSet(KEYS.ui, { condition: 'New', model: '', tab: 'missing' });

    // Validate required
    if (!mapping.stock || !mapping.condition || !mapping.model){
      renderMappingModal(headers, mapping);
    } else {
      setToast('CSV loaded.', 'success');
      location.reload();
    }
  });

  // Wire reset / export / clear
  $('#resetBtn').addEventListener('click', async () => {
    if (!confirm('Reset this stock check? (Your CSV stays saved.)')) return;
    await idbSet(KEYS.scanned, {});
    setToast('Reset complete.', 'success');
    location.reload();
  });
  $('#clearCsvBtn').addEventListener('click', async () => {
    if (!confirm('Remove the saved CSV from this phone?')) return;
    await idbDel(KEYS.dataset);
    await idbDel(KEYS.scanned);
    await idbDel(KEYS.mapping);
    await idbDel(KEYS.ui);
    setToast('CSV removed.', 'success');
    location.reload();
  });

  $('#exportFilteredBtn').addEventListener('click', async () => {
    const { dataset, scanned, mapping } = await loadState();
    if (!dataset) return;
    const ui = await idbGet(KEYS.ui) || { condition: 'New', model: '' };
    const scannedSet = new Set(Object.keys(scanned).filter(k => scanned[k]));
    const filtered = filterRows(dataset.rows, mapping, ui);
    const out = filtered.map(r => {
      const o = { ...r };
      const stock = safeVal(r, mapping.stock);
      o['StockCheckStatus'] = scannedSet.has(stock) ? 'SCANNED' : 'MISSING';
      return o;
    });
    const headers = [...dataset.headers];
    if (!headers.includes('StockCheckStatus')) headers.push('StockCheckStatus');
    const csv = toCSV(headers, out);
    downloadText(`stockcheck_filtered_${dataset.id}.csv`, csv);
  });

  $('#exportAllBtn').addEventListener('click', async () => {
    const { dataset, scanned, mapping } = await loadState();
    if (!dataset) return;
    const scannedSet = new Set(Object.keys(scanned).filter(k => scanned[k]));
    const out = dataset.rows.map(r => {
      const o = { ...r };
      const stock = safeVal(r, mapping.stock);
      o['StockCheckStatus'] = scannedSet.has(stock) ? 'SCANNED' : '';
      return o;
    });
    const headers = [...dataset.headers];
    if (!headers.includes('StockCheckStatus')) headers.push('StockCheckStatus');
    const csv = toCSV(headers, out);
    downloadText(`stockcheck_all_${dataset.id}.csv`, csv);
  });

  // Mapping modal actions
  $('#mappingSave').addEventListener('click', async () => {
    const dataset = await idbGet(KEYS.dataset);
    if (!dataset) return;
    const mapping = { ...DEFAULT_MAPPING };
    for (const key of Object.keys(mapping)){
      const val = $(`#map_${key}`)?.value || '';
      mapping[key] = val || null;
    }
    if (!mapping.stock || !mapping.condition || !mapping.model){
      setToast('Stock, Condition, and Model are required.', 'error');
      return;
    }
    await idbSet(KEYS.mapping, mapping);
    setToast('Mapping saved.', 'success');
    $('#mappingModal').close();
    location.reload();
  });

  $('#mappingCancel').addEventListener('click', async () => {
    $('#mappingModal').close();
    location.reload();
  });

  // If dataset exists render core UI
  const dataset = state.dataset;
  if (!dataset) return;

  const mapping = state.mapping;
  // If mapping incomplete, open modal
  if (!mapping.stock || !mapping.condition || !mapping.model){
    renderMappingModal(dataset.headers, mapping);
  }

  // Populate model list based on condition (exact match values)
  const ui = state.ui || { condition: 'New', model: '', tab: 'missing' };
  renderDataShell();

  $('#datasetInfo').textContent = `Loaded: ${dataset.name} • Saved on this phone • ${new Date(dataset.loadedAt).toLocaleString()}`;
  const models = uniqueModels(dataset.rows, mapping, ui.condition);
  // If current model not in list, clear it
  if (ui.model && !models.includes(ui.model)) ui.model = '';
  renderFilters(models, ui);

  // Handle filter changes
  $('#conditionSel').addEventListener('change', async (e) => {
    ui.condition = e.target.value;
    ui.model = ''; // reset model on condition change to avoid confusion
    await saveUI(ui);
    location.reload();
  });
  $('#modelSel').addEventListener('change', async (e) => {
    ui.model = e.target.value;
    await saveUI(ui);
    location.reload();
  });

  // Tabs
  const tabBtns = document.querySelectorAll('[data-tab]');
  tabBtns.forEach(btn => {
    if (btn.dataset.tab === ui.tab) btn.classList.add('active');
    btn.addEventListener('click', async () => {
      ui.tab = btn.dataset.tab;
      await saveUI(ui);
      tabBtns.forEach(b=>b.classList.toggle('active', b===btn));
      renderEverything(); // rerender
    });
  });

  // Search box
  const search = $('#searchBox');
  search.addEventListener('input', () => renderEverything());

  // Scanner
  let stream = null;
  let scanning = false;
  let detector = null;

  async function startCamera(){
    const video = $('#video');
    $('#scanModal').showModal();
    $('#scanStatus').textContent = 'Starting camera…';
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      video.srcObject = stream;
      await video.play();
      $('#scanStatus').textContent = 'Point at the barcode…';
      scanning = true;

      if ('BarcodeDetector' in window) {
        const formats = ['code_128','ean_13','ean_8','upc_a','upc_e','code_39','itf'];
        detector = new BarcodeDetector({ formats });
      } else {
        detector = null;
        $('#scanStatus').textContent = 'BarcodeDetector not supported on this iPhone. Use Manual Entry.';
      }

      tick();
    } catch (err){
      $('#scanStatus').textContent = 'Camera blocked. Allow camera access in Settings → Safari.';
      scanning = false;
    }
  }

  function stopCamera(){
    scanning = false;
    const video = $('#video');
    video.pause();
    if (stream){
      stream.getTracks().forEach(t=>t.stop());
      stream = null;
    }
    $('#scanModal').close();
  }

  async function handleScanValue(value){
    const code = String(value||'').trim();
    if (!code) return;

    const { dataset, scanned, mapping } = await loadState();
    const ui = await idbGet(KEYS.ui) || { condition: 'New', model: '' };

    const stockCol = mapping.stock;
    const row = dataset.rows.find(r => safeVal(r, stockCol) === code);

    // Check against current filtered list
    const filtered = filterRows(dataset.rows, mapping, ui);
    const isInFiltered = filtered.some(r => safeVal(r, stockCol) === code);

    if (!row){
      setToast(`Not found: ${code}`, 'error');
      haptic('warn');
      return;
    }
    if (!isInFiltered){
      setToast(`Not in current filter: ${code}`, 'warn');
      haptic('warn');
      return;
    }

    if (scanned[code]){
      setToast(`Already scanned: ${code}`, 'warn');
      haptic('warn');
      return;
    }

    scanned[code] = true;
    await idbSet(KEYS.scanned, scanned);
    setToast(`Scanned: ${code}`, 'success');
    haptic('success');
    renderEverything();
  }

  async function tick(){
    if (!scanning) return;
    if (!detector) {
      requestAnimationFrame(tick);
      return;
    }
    const video = $('#video');
    try{
      const barcodes = await detector.detect(video);
      if (barcodes && barcodes.length){
        const code = barcodes[0].rawValue;
        $('#scanStatus').textContent = `Detected: ${code}`;
        await handleScanValue(code);
        // small pause to avoid double reads
        await new Promise(r=>setTimeout(r, 700));
      }
    } catch {}
    requestAnimationFrame(tick);
  }

  $('#scanBtn').addEventListener('click', startCamera);
  $('#scanClose').addEventListener('click', stopCamera);
  $('#manualAddBtn').addEventListener('click', async () => {
    const v = $('#manualInput').value.trim();
    if (!v) return;
    await handleScanValue(v);
    $('#manualInput').value = '';
  });

  // Render everything based on filters and scanned
  async function renderEverything(){
    const { dataset, scanned, mapping } = await loadState();
    const ui = await idbGet(KEYS.ui) || { condition: 'New', model: '', tab: 'missing' };

    const filteredRows = filterRows(dataset.rows, mapping, ui);
    const scannedSet = new Set(Object.keys(scanned).filter(k => scanned[k]));

    const expected = filteredRows.length;
    const scannedCount = filteredRows.reduce((acc, r) => acc + (scannedSet.has(safeVal(r, mapping.stock)) ? 1 : 0), 0);
    const missing = expected - scannedCount;

    renderCounters(expected, scannedCount, missing);

    const q = norm(search.value);
    const listAll = filteredRows.map(r => formatRowLine(r, mapping))
      .filter(it => !q || it.stock.toLowerCase().includes(q) || (it.meta||'').toLowerCase().includes(q));

    const listScanned = listAll.filter(it => scannedSet.has(it.stock));
    const listMissing = listAll.filter(it => !scannedSet.has(it.stock));

    const listEl = $('#list');
    if (ui.tab === 'scanned') renderList(listEl, listScanned, scannedSet);
    else if (ui.tab === 'all') renderList(listEl, listAll, scannedSet);
    else renderList(listEl, listMissing, scannedSet);

    // Quick status
    $('#quickStatus').textContent = (missing === 0 && expected > 0) ? '✅ Complete for this filter' : '';
  }

  renderEverything();
}

main();
