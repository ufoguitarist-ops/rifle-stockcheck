import { parseCSV } from './csv.js';
import { idbGet, idbSet, idbDel } from './idb.js';

const $ = (sel) => document.querySelector(sel);

const KEYS = { dataset:'dataset_v3', scanned:'scanned_v3', mapping:'mapping_v3', ui:'ui_v3' };
const DEFAULT_MAPPING = { stock:null, condition:null, make:null, model:null, calibre:null };

const CANDIDATES = {
  stock: ['stock#','stock #','stock number','stock no','stockno','stock','sku','item','item no','item number','code'],
  condition: ['condition','cond','status','state'],
  make: ['make','brand','manufacturer'],
  model: ['model','rifle model','product model','product'],
  calibre: ['calibre','caliber','cal']
};

function norm(s){ return String(s||'').trim().toLowerCase(); }
function safeVal(row, col){ if (!col) return ''; const v=row[col]; return (v===undefined||v===null)?'':String(v).trim(); }

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

function toObjects(headers, rows){
  return rows.map(r => {
    const o = {};
    headers.forEach((h,i)=> o[h] = (r[i] ?? '').toString().trim());
    return o;
  });
}

function hashText(str){
  let h = 2166136261;
  for (let i=0;i<str.length;i++){ h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h>>>0).toString(16);
}

function setToast(msg, kind='info'){
  const el = $('#toast');
  el.textContent = msg;
  el.dataset.kind = kind;
  el.classList.add('show');
  clearTimeout(setToast._t);
  setToast._t = setTimeout(()=>el.classList.remove('show'), 2200);
}

function renderNoData(){ $('#hasData').hidden=true; $('#noData').hidden=false; $('#datasetInfo').textContent='No CSV loaded yet.'; }
function renderDataShell(){ $('#noData').hidden=true; $('#hasData').hidden=false; }

function renderMappingModal(headers, mapping){
  const keys = [
    ['stock','Stock Number (barcode)'],
    ['condition','Condition'],
    ['make','Make'],
    ['model','Model'],
    ['calibre','Calibre (optional)'],
  ];
  const body = $('#mappingBody');
  body.innerHTML = '';
  for (const [key,label] of keys){
    const wrap=document.createElement('div'); wrap.className='mapRow';
    const l=document.createElement('label'); l.textContent=label;
    const sel=document.createElement('select'); sel.id=`map_${key}`;
    const optBlank=document.createElement('option'); optBlank.value=''; optBlank.textContent=(key==='calibre')?'— None —':'— Select —';
    sel.appendChild(optBlank);
    headers.forEach(h=>{
      const opt=document.createElement('option'); opt.value=h; opt.textContent=h;
      if (mapping[key]===h) opt.selected=true;
      sel.appendChild(opt);
    });
    wrap.appendChild(l); wrap.appendChild(sel);
    body.appendChild(wrap);
  }
  $('#mappingModal').showModal();
}

function filterRows(rows, mapping, filters){
  const stockCol=mapping.stock, condCol=mapping.condition, makeCol=mapping.make, modelCol=mapping.model;
  return rows.filter(r=>{
    const stock=safeVal(r,stockCol); if(!stock) return false;
    const cond=safeVal(r,condCol), make=safeVal(r,makeCol), model=safeVal(r,modelCol);
    const condOk=(filters.condition==='All')?true:(norm(cond)===norm(filters.condition));
    const makeOk=(!filters.make)?true:(make===filters.make);
    const modelOk=(!filters.model)?true:(model===filters.model);
    return condOk && makeOk && modelOk;
  });
}

function uniqueValues(rows, valueCol, condCol, condition, extraFilterFn){
  const set=new Set();
  rows.forEach(r=>{
    if(extraFilterFn && !extraFilterFn(r)) return;
    if(condition!=='All'){ const cond=safeVal(r,condCol); if(norm(cond)!==norm(condition)) return; }
    const v=safeVal(r,valueCol); if(v) set.add(v);
  });
  return Array.from(set).sort((a,b)=>a.localeCompare(b));
}

function formatRowLine(row, mapping){
  const stock=safeVal(row,mapping.stock);
  const make=safeVal(row,mapping.make);
  const model=safeVal(row,mapping.model);
  const cal=safeVal(row,mapping.calibre);
  const parts=[]; if(make) parts.push(make); if(model) parts.push(model); if(cal) parts.push(cal);
  return { stock, meta: parts.join(' • ') };
}

function renderFilters(makes, models, ui){
  $('#conditionSel').value = ui.condition;
  const makeSel=$('#makeSel'); makeSel.innerHTML='';
  const optAll=document.createElement('option'); optAll.value=''; optAll.textContent='All Makes'; makeSel.appendChild(optAll);
  makes.forEach(m=>{ const opt=document.createElement('option'); opt.value=m; opt.textContent=m; if(m===(ui.make||'')) opt.selected=true; makeSel.appendChild(opt); });
  const modelSel=$('#modelSel'); modelSel.innerHTML='';
  const optMAll=document.createElement('option'); optMAll.value=''; optMAll.textContent='All Models'; modelSel.appendChild(optMAll);
  models.forEach(m=>{ const opt=document.createElement('option'); opt.value=m; opt.textContent=m; if(m===(ui.model||'')) opt.selected=true; modelSel.appendChild(opt); });
  $('#activeFilters').textContent = `Condition: ${ui.condition} • Make: ${ui.make || 'All'} • Model: ${ui.model || 'All'}`;
}

function renderCounters(expected, scannedCount, missing){
  $('#expectedVal').textContent=String(expected);
  $('#scannedVal').textContent=String(scannedCount);
  $('#missingVal').textContent=String(missing);
}

function renderList(listEl, items, scannedSet){
  listEl.innerHTML='';
  if(!items.length){ const e=document.createElement('div'); e.className='empty'; e.textContent='Nothing to show.'; listEl.appendChild(e); return; }
  for(const it of items){
    const row=document.createElement('div'); row.className='row';
    const left=document.createElement('div'); left.className='left';
    const stock=document.createElement('div'); stock.className='stock'; stock.textContent=it.stock;
    const meta=document.createElement('div'); meta.className='meta'; meta.textContent=it.meta||'';
    left.appendChild(stock); left.appendChild(meta);
    const pill=document.createElement('div'); pill.className='pill '+(scannedSet.has(it.stock)?'ok':'miss');
    pill.textContent=scannedSet.has(it.stock)?'SCANNED':'MISSING';
    row.appendChild(left); row.appendChild(pill);
    listEl.appendChild(row);
  }
}

function downloadText(filename, text){
  const blob=new Blob([text],{type:'text/csv;charset=utf-8'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a'); a.href=url; a.download=filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),2000);
}

function toCSV(headers, objs){
  const esc=(v)=>{ const s=(v??'').toString(); return (/[",\n]/.test(s)) ? '"' + s.replace(/"/g,'""') + '"' : s; };
  const lines=[]; lines.push(headers.map(esc).join(','));
  for(const o of objs){ lines.push(headers.map(h=>esc(o[h])).join(',')); }
  return lines.join('\n');
}

async function loadState(){
  const dataset=await idbGet(KEYS.dataset);
  const scanned=await idbGet(KEYS.scanned) || {};
  const mapping=await idbGet(KEYS.mapping) || { ...DEFAULT_MAPPING };
  const ui=await idbGet(KEYS.ui) || { condition:'New', make:'', model:'', tab:'missing' };
  return { dataset, scanned, mapping, ui };
}
async function saveUI(ui){ await idbSet(KEYS.ui, ui); }

let quaggaRunning=false, lastCode='', lastAt=0;

function startScanner(onCode){
  $('#scanModal').showModal();
  $('#scanStatus').textContent='Starting camera…';
  const target=document.querySelector('#scanner'); target.innerHTML='';
  if(!window.Quagga){ $('#scanStatus').textContent='Scanner failed to load. Refresh and try again.'; return; }

  const config={
    numOfWorkers:0,
    locate:true,
    inputStream:{
      name:'Live',
      type:'LiveStream',
      target,
      constraints:{ facingMode:'environment', width:{min:640}, height:{min:480} },
      area:{ top:'35%', right:'10%', left:'10%', bottom:'35%' }
    },
    decoder:{ readers:['code_128_reader'], multiple:false }
  };

  try{
    window.Quagga.init(config,(err)=>{
      if(err){ $('#scanStatus').textContent='Camera blocked. Allow camera access (Settings → Safari → Camera).'; return; }
      window.Quagga.start(); quaggaRunning=true;
      $('#scanStatus').textContent='Point at the barcode (hold steady)…';
    });

    window.Quagga.offDetected();
    window.Quagga.onDetected((data)=>{
      const code=data?.codeResult?.code; if(!code) return;
      const now=Date.now();
      if(code===lastCode && (now-lastAt)<1100) return;
      lastCode=code; lastAt=now;
      $('#scanStatus').textContent=`Detected: ${code}`;
      onCode(code);
    });
  }catch{ $('#scanStatus').textContent='Scanner failed to start.'; }
}

function stopScanner(){
  try{ if(window.Quagga && quaggaRunning) window.Quagga.stop(); }catch{}
  quaggaRunning=false;
  try{ $('#scanModal').close(); }catch{}
}

async function main(){
  if('serviceWorker' in navigator){ try{ await navigator.serviceWorker.register('./sw.js'); }catch{} }

  const state=await loadState();
  if(!state.dataset) renderNoData(); else renderDataShell();

  $('#importBtn').addEventListener('click',()=>$('#fileInput').click());
  $('#fileInput').addEventListener('change', async (e)=>{
    const file=e.target.files?.[0]; if(!file) return;
    const text=await file.text();
    const parsed=parseCSV(text);
    if(!parsed.rows.length || parsed.rows.length<2){ setToast('CSV looks empty or invalid.','error'); return; }

    const maxCheck=Math.min(10, parsed.rows.length);
    const scoreRow=(r)=>{
      const joined=r.map(c=>norm(c)).join(' ');
      let score=0;
      if(joined.includes('stock')) score+=3;
      if(joined.includes('condition')) score+=3;
      if(joined.includes('model')) score+=2;
      if(joined.includes('make')) score+=2;
      return score;
    };
    let headerIdx=0, best=-1;
    for(let i=0;i<maxCheck;i++){ const s=scoreRow(parsed.rows[i]); if(s>best){ best=s; headerIdx=i; } }

    const headers=parsed.rows[headerIdx].map(h=>String(h||'').trim()).filter(h=>h!=='');
    const dataRows=parsed.rows.slice(headerIdx+1);
    if(headers.length<3){ setToast('Could not detect header row. Check the CSV export.','error'); return; }

    const objs=toObjects(headers, dataRows);
    const dataset={ id:hashText(text), name:file.name, loadedAt:new Date().toISOString(), headers, rows:objs };
    const mapping=autoMap(headers);

    await idbSet(KEYS.dataset, dataset);
    await idbSet(KEYS.mapping, mapping);
    await idbSet(KEYS.scanned, {});
    await idbSet(KEYS.ui, { condition:'New', make:'', model:'', tab:'missing' });

    if(!mapping.stock || !mapping.condition || !mapping.make || !mapping.model){
      renderMappingModal(headers, mapping);
    } else {
      setToast('CSV loaded.','success'); location.reload();
    }
  });

  $('#resetBtn').addEventListener('click', async ()=>{
    if(!confirm('Reset this stock check? (Your CSV stays saved.)')) return;
    await idbSet(KEYS.scanned, {}); setToast('Reset complete.','success'); location.reload();
  });

  $('#clearCsvBtn').addEventListener('click', async ()=>{
    if(!confirm('Remove the saved CSV from this phone?')) return;
    await idbDel(KEYS.dataset); await idbDel(KEYS.scanned); await idbDel(KEYS.mapping); await idbDel(KEYS.ui);
    setToast('CSV removed.','success'); location.reload();
  });

  $('#exportFilteredBtn').addEventListener('click', async ()=>{
    const { dataset, scanned, mapping } = await loadState(); if(!dataset) return;
    const ui=await idbGet(KEYS.ui) || { condition:'New', make:'', model:'' };
    const scannedSet=new Set(Object.keys(scanned).filter(k=>scanned[k]));
    const filtered=filterRows(dataset.rows, mapping, ui);
    const out=filtered.map(r=>{ const o={...r}; const stock=safeVal(r,mapping.stock); o['StockCheckStatus']=scannedSet.has(stock)?'SCANNED':'MISSING'; return o; });
    const headers=[...dataset.headers]; if(!headers.includes('StockCheckStatus')) headers.push('StockCheckStatus');
    downloadText(`stockcheck_filtered_${dataset.id}.csv`, toCSV(headers,out));
  });

  $('#exportAllBtn').addEventListener('click', async ()=>{
    const { dataset, scanned, mapping } = await loadState(); if(!dataset) return;
    const scannedSet=new Set(Object.keys(scanned).filter(k=>scanned[k]));
    const out=dataset.rows.map(r=>{ const o={...r}; const stock=safeVal(r,mapping.stock); o['StockCheckStatus']=scannedSet.has(stock)?'SCANNED':''; return o; });
    const headers=[...dataset.headers]; if(!headers.includes('StockCheckStatus')) headers.push('StockCheckStatus');
    downloadText(`stockcheck_all_${dataset.id}.csv`, toCSV(headers,out));
  });

  $('#mappingSave').addEventListener('click', async ()=>{
    const dataset=await idbGet(KEYS.dataset); if(!dataset) return;
    const mapping={ ...DEFAULT_MAPPING };
    for(const key of Object.keys(mapping)){ const val=$(`#map_${key}`)?.value || ''; mapping[key]=val||null; }
    if(!mapping.stock || !mapping.condition || !mapping.make || !mapping.model){ setToast('Stock, Condition, Make and Model are required.','error'); return; }
    await idbSet(KEYS.mapping, mapping); setToast('Mapping saved.','success');
    $('#mappingModal').close(); location.reload();
  });
  $('#mappingCancel').addEventListener('click', ()=>{ $('#mappingModal').close(); location.reload(); });

  const dataset=state.dataset; if(!dataset) return;
  const mapping=state.mapping;
  if(!mapping.stock || !mapping.condition || !mapping.make || !mapping.model) renderMappingModal(dataset.headers, mapping);

  const ui=state.ui || { condition:'New', make:'', model:'', tab:'missing' };
  renderDataShell();
  $('#datasetInfo').textContent = `Loaded: ${dataset.name} • Saved on this phone • ${new Date(dataset.loadedAt).toLocaleString()}`;

  const condCol=mapping.condition, makeCol=mapping.make, modelCol=mapping.model;
  const makes=uniqueValues(dataset.rows, makeCol, condCol, ui.condition, null);
  if(ui.make && !makes.includes(ui.make)) ui.make='';
  const models=uniqueValues(dataset.rows, modelCol, condCol, ui.condition, (r)=> !ui.make || safeVal(r, makeCol)===ui.make );
  if(ui.model && !models.includes(ui.model)) ui.model='';

  renderFilters(makes, models, ui);

  $('#conditionSel').addEventListener('change', async (e)=>{ ui.condition=e.target.value; ui.make=''; ui.model=''; await saveUI(ui); location.reload(); });
  $('#makeSel').addEventListener('change', async (e)=>{ ui.make=e.target.value; ui.model=''; await saveUI(ui); location.reload(); });
  $('#modelSel').addEventListener('change', async (e)=>{ ui.model=e.target.value; await saveUI(ui); location.reload(); });

  const tabBtns=document.querySelectorAll('[data-tab]');
  tabBtns.forEach(btn=>{
    if(btn.dataset.tab===ui.tab) btn.classList.add('active');
    btn.addEventListener('click', async ()=>{ ui.tab=btn.dataset.tab; await saveUI(ui); tabBtns.forEach(b=>b.classList.toggle('active', b===btn)); renderEverything(); });
  });

  const search=$('#searchBox');
  search.addEventListener('input', ()=>renderEverything());

  $('#scanBtn').addEventListener('click', ()=>startScanner(handleScanValue));
  $('#scanClose').addEventListener('click', stopScanner);
  $('#manualAddBtn').addEventListener('click', async ()=>{ const v=$('#manualInput').value.trim(); if(!v) return; await handleScanValue(v); $('#manualInput').value=''; });

  async function handleScanValue(value){
    const code=String(value||'').trim(); if(!code) return;
    const { dataset, scanned, mapping } = await loadState();
    const ui=await idbGet(KEYS.ui) || { condition:'New', make:'', model:'' };
    const stockCol=mapping.stock;
    const row=dataset.rows.find(r=>safeVal(r, stockCol)===code);
    const filtered=filterRows(dataset.rows, mapping, ui);
    const inFiltered=filtered.some(r=>safeVal(r, stockCol)===code);
    if(!row){ setToast(`Not found: ${code}`,'error'); return; }
    if(!inFiltered){ setToast(`Not in current filter: ${code}`,'warn'); return; }
    if(scanned[code]){ setToast(`Already scanned: ${code}`,'warn'); return; }
    scanned[code]=true;
    await idbSet(KEYS.scanned, scanned);
    setToast(`Scanned: ${code}`,'success');
    renderEverything();
  }

  async function renderEverything(){
    const { dataset, scanned, mapping } = await loadState();
    const ui=await idbGet(KEYS.ui) || { condition:'New', make:'', model:'', tab:'missing' };
    const filtered=filterRows(dataset.rows, mapping, ui);
    const scannedSet=new Set(Object.keys(scanned).filter(k=>scanned[k]));
    const expected=filtered.length;
    const scannedCount=filtered.reduce((acc,r)=>acc+(scannedSet.has(safeVal(r,mapping.stock))?1:0),0);
    const missing=expected-scannedCount;
    renderCounters(expected, scannedCount, missing);

    const q=norm(search.value);
    const all=filtered.map(r=>formatRowLine(r,mapping)).filter(it=>!q || it.stock.toLowerCase().includes(q) || (it.meta||'').toLowerCase().includes(q));
    const scannedList=all.filter(it=>scannedSet.has(it.stock));
    const missingList=all.filter(it=>!scannedSet.has(it.stock));

    const listEl=$('#list');
    if(ui.tab==='scanned') renderList(listEl, scannedList, scannedSet);
    else if(ui.tab==='all') renderList(listEl, all, scannedSet);
    else renderList(listEl, missingList, scannedSet);
  }

  renderEverything();
}

main();
