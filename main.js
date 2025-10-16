/* main.js — Block Blast Flow+ 版（含 Tap‑to‑Place、Smooth Drag、Hit 一致化、Clear 預視、Quantized Audio/MIDI、Daily/Missions） */

/* ====== 小工具 ====== */
const $  = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));
const px = v => Math.round(v) + "px";
const clamp = (v,a,b)=> Math.max(a, Math.min(b, v));
const isCoarse = matchMedia("(pointer:coarse)").matches;
const lerp = (a,b,t)=> a + (b-a)*t;
const nowMs = ()=> performance.now();

/* 視覺參數（可依喜好微調） */
const ENABLE_TILT = true;          // 拖曳代理 3D 傾斜
const ENABLE_SPRING = true;        // 起飛小彈簧（~140ms）
const DRAG_SPRING_MS = 140;        // 彈簧時長
const TILT_MAX_DEG = 7;            // 傾斜最大角度
const CURVE_BASE_W = 6;            // 橡皮筋曲線基礎線寬

/* ====== 事件匯流（Event Bus） ====== */
class EventBus{
  constructor(){ this.map = new Map(); }
  on(type, fn){ (this.map.get(type) || this.map.set(type,[]).get(type)).push(fn); return ()=>this.off(type, fn); }
  off(type, fn){ const arr=this.map.get(type)||[]; const i=arr.indexOf(fn); if(i>=0) arr.splice(i,1); }
  emit(type, payload){ const arr=this.map.get(type)||[]; for(const fn of arr){ try{ fn(payload); }catch(e){ console.error(e);} } }
}
const bus = new EventBus();

/* ====== Toast / A11y / 震動 ====== */
function toast(text,color="#fff"){
  const el=document.createElement("div"); el.className="toast"; el.textContent=text;
  el.style.left="50%"; el.style.top="12%"; el.style.color=color;
  $("#toasts").appendChild(el); setTimeout(()=>el.remove(),900);
}
const announce = msg => { const el=$("#sr-live"); el.textContent=""; setTimeout(()=>el.textContent=msg,10); };
const buzz = pat => { try{ if(navigator.vibrate) navigator.vibrate(pat); }catch{} };

/* ====== RNG / 每日挑戰用 ====== */
function mulberry32(a){ return function(){ let t=a+=0x6D2B79F5; t=Math.imul(t^t>>>15,t|1); t^=t+Math.imul(t^t>>>7,t|61); return ((t^t>>>14)>>>0)/4294967296; } }
const RNG={ next:Math.random, useSystem(){this.next=Math.random;}, useSeed(seed){this.next=mulberry32(seed|0);} };

/* ====== FEVER：星星沿條飛入 + 流光掃描 ====== */
function animateBezier(el,p0,p1,p2,dur,done){ const t0=performance.now(); (function step(t){ const tt=Math.min(1,(t-t0)/dur),e=1-Math.pow(1-tt,3); const x=(1-e)*(1-e)*p0.x+2*(1-e)*e*p1.x+e*e*p2.x; const y=(1-e)*(1-e)*p0.y+2*(1-e)*e*p1.y+e*e*p2.y; const s=.7+.5*e; el.style.transform=`translate(${x}px,${y}px) scale(${s})`; if(tt<1) requestAnimationFrame(step); else done&&done(); })(t0); }
function animateLinear(el,p0,p1,dur,done){ const t0=performance.now(); (function step(t){ const tt=Math.min(1,(t-t0)/dur),e=tt<.5?2*tt*tt:1-Math.pow(-2*tt+2,2)/2; const x=p0.x+(p1.x-p0.x)*e, y=p0.y+(p1.y-p0.y)*e; el.style.transform=`translate(${x}px,${y}px)`; if(tt<1) requestAnimationFrame(step); else done&&done(); })(t0); }
function flyStarsToFever(count, fromRect){
  const bar=$(".fever-bar"), fill=$("#feverFill"); if(!bar||count<=0) return;
  const br=bar.getBoundingClientRect(); const fr=fill? fill.getBoundingClientRect() : {left:br.left,width:0};
  const y=br.top+br.height/2; const endX=(fr.width>0? fr.left+fr.width-8 : br.left+6);
  for(let i=0;i<count;i++){
    const s=document.createElement("div"); s.className="star-fly"; s.textContent="⭐"; document.body.appendChild(s);
    const sx = fromRect ? (fromRect.left + fromRect.width/2) : (innerWidth/2);
    const sy = fromRect ? (fromRect.top  + fromRect.height/2) : (innerHeight/2);
    const start={x:sx+(Math.random()*40-20), y:sy+(Math.random()*30-15)};
    const entryX = (fr.width>0) ? fr.left + Math.max(12, Math.min(fr.width-26, fr.width*(0.15+0.4*Math.random()))) : br.left+14;
    const slideToX = Math.min(endX-10, entryX + Math.max(30, (fr.width||80)*0.35));
    animateBezier(s, start, {x:(start.x+entryX)/2 + (Math.random()*60-30), y: Math.min(start.y, br.top-40)-Math.random()*60}, {x:entryX,y}, 320, ()=>{
      animateLinear(s, {x:entryX,y}, {x:slideToX,y}, 180, ()=>{
        animateBezier(s, {x:slideToX,y}, {x:(slideToX+endX)/2+10, y:y-14}, {x:endX,y}, 220, ()=>{ s.remove(); sweepFeverBar(); });
      });
    });
  }
}
function sweepFeverBar(){ const bar=$(".fever-bar"), fill=$("#feverFill"); if(!bar) return; const br=bar.getBoundingClientRect(), fr=fill? fill.getBoundingClientRect():{width:0,left:br.left}; const d=document.createElement("div"); d.className="fever-sweep"; const w=br.width*.22; d.style.width=w+"px"; d.style.left=(-w)+"px"; bar.appendChild(d); const travel=Math.max(0,fr.width); d.animate([{transform:'translateX(0)'},{transform:`translateX(${travel}px)`}],{duration:320,easing:'linear'}).onfinish=()=>d.remove(); }

/* ====== 形狀 / 調色 ====== */
const GRID = 8; document.documentElement.style.setProperty('--grid-size', String(GRID));
const SIZE = GRID;
function shape(rows){ let cs=[]; for(let y=0;y<rows.length;y++){ for(let x=0;x<rows[y].length;x++) if(rows[y][x]!==' ') cs.push([x,y]); } const minX=Math.min(...cs.map(c=>c[0])),minY=Math.min(...cs.map(c=>c[1])); cs=cs.map(([x,y])=>[x-minX,y-minY]); const w=Math.max(...cs.map(c=>c[0]))+1, h=Math.max(...cs.map(c=>c[1]))+1; return {cells:cs,w,h,n:cs.length}; }
const SHAPES=[
  shape(["X"]),
  shape(["XX"]),shape(["XXX"]),shape(["XXXX"]),shape(["XXXXX"]),
  shape(["X","X"]),shape(["X","X","X"]),shape(["X","X","X","X"]),shape(["X","X","X","X","X"]),
  shape(["XX","XX"]),
  shape(["X ","XX"]), shape([" X","XX"]),
  shape(["X  ","XXX"]), shape(["  X","XXX"]),
  shape(["X ","X ","XX"]), shape([" X"," X","XX"]),
  shape(["XX "," XX"]), shape([" XX","XX "]),
  shape(["XXX"," X "]),
  shape(["X X","XXX"]),
  shape([" X ","XXX"," X "]),
];
const PALETTE_DEFAULT = ["#7aa2ff","#6ee7b7","#f472b6","#fbbf24","#34d399","#a78bfa","#f87171","#60a5fa","#22d3ee","#f59e0b"];
const PALETTE_CVD     = ["#000000","#E69F00","#56B4E9","#009E73","#F0E442","#0072B2","#D55E00","#CC79A7"];
function currentPalette(){ return state.settings.colorblind ? PALETTE_CVD : PALETTE_DEFAULT; }
function emptyBoard(){ return Array.from({length:SIZE},()=>Array(SIZE).fill(null)); }

/* 形狀配重（控制難度梯度） */
function freeRatio(){ let free=0; for(let y=0;y<SIZE;y++) for(let x=0;x<SIZE;x++) if(!state.board[y][x]) free++; return free/(SIZE*SIZE); }
function chooseWeightedShape(){
  const f=freeRatio();
  const weights=SHAPES.map(s=>{
    let w=1.0;
    if(s.n<=2) w*=1.6; else if(s.n===3) w*=1.3; else if(s.n===4) w*=1.05; else if(s.n>=5) w*=0.85;
    if(s.w===2&&s.h===2&&s.n===4) w*=1.5;
    if((s.w===5&&s.h===1)||(s.w===1&&s.h===5)) w*=0.65;
    if(f<0.35){ if(s.n<=3) w*=1.6; if(s.n>=5) w*=0.65; }
    else if(f>0.70){ if(s.n>=4) w*=1.20; }
    return w;
  });
  const total=weights.reduce((a,b)=>a+b,0);
  let r=RNG.next()*total, idx=0;
  for(let i=0;i<weights.length;i++){ r-=weights[i]; if(r<=0){ idx=i; break; } }
  return SHAPES[idx];
}
function pickPiece(){
  const base=chooseWeightedShape();
  const color=currentPalette()[Math.floor(RNG.next()*currentPalette().length)];
  return { cells:base.cells.map(([x,y])=>[x,y]), w:base.w, h:base.h, n:base.n, color, id:Math.random().toString(36).slice(2,9) };
}

/* ====== 狀態 ====== */
const STORAGE_KEY="bb_flow_full_v33";
const BEST_KEY="bb_flow_best";
const SETTINGS_KEY="bb_flow_settings_v6";
const MISSIONS_KEY="bb_flow_missions_v1";

function loadSettings(){
  const def={
    audio:true, haptics:true, reduce: matchMedia("(prefers-reduced-motion: reduce)").matches,
    contrast:false, colorblind:false, hint:true, midi:false,
    tapPlace: isCoarse  // 觸控裝置預設開啟兩段式放置
  };
  try{ const raw=localStorage.getItem(SETTINGS_KEY); if(!raw) return def; return {...def, ...JSON.parse(raw)}; }catch{ return def; }
}
function saveSettings(){ localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings)); }

const state={
  board:emptyBoard(), score:0, best:Number(localStorage.getItem(BEST_KEY)||0),
  tray:[null,null,null], usedThisSet:0, history:[], gameOver:false,
  streak:0, lastActionAt:Date.now(),
  fever:{ meter:0, active:false, until:0 },
  settings: loadSettings(),
  undoCharges:3, stars:0, hold:null,
  mode:"classic",
  tools:{ hammer:false },
  hintShown:false, awaitingHold:false,
  stats:{ placed:0, lines:0, sessionScore:0, feverTriggers:0, starsGain:0, hammer:0, games:0, maxCombo:0 }
};

/* ====== DOM：棋盤 / HUD ====== */
const boardEl=$("#board"), ghostEl=$("#ghost"), boardWrap=$("#boardWrap"), fx=$("#fx");
const scoreEl=$("#score"), bestEl=$("#best"), starsEl=$("#stars"), feverFill=$("#feverFill");
const comboTag=$("#comboTag"), comboBar=$("#comboBar");

function buildBoardUI(){
  boardEl.innerHTML="";
  for(let y=0;y<SIZE;y++) for(let x=0;x<SIZE;x++){
    const cell=document.createElement("div"); cell.className="cell"; cell.dataset.x=x; cell.dataset.y=y;
    const tile=document.createElement("div"); tile.className="tile"; tile.hidden=true; cell.appendChild(tile);
    boardEl.appendChild(cell);
  }
}
function cellAt(x,y){ return boardEl.querySelector(`.cell[data-x="${x}"][data-y="${y}"]`); }
buildBoardUI();

function renderHUD(){
  scoreEl.textContent=state.score.toLocaleString('zh-Hant');
  bestEl.textContent=state.best.toLocaleString('zh-Hant');
  $("#btn-undo").textContent=`復原 ×${state.undoCharges}`;
  starsEl.textContent=state.stars;
  $("#dailyTag").style.display=(state.mode==='daily')?'inline':'none';
  $("#dailyTag").textContent=(state.mode==='daily')?'每日挑戰中':'';
  if(feverFill) feverFill.style.setProperty('--fever', state.fever.meter/100);
}
function renderBoard(){
  for(let y=0;y<SIZE;y++) for(let x=0;x<SIZE;x++){
    const t=cellAt(x,y).firstElementChild; const c=state.board[y][x];
    if(c){ t.hidden=false; t.style.background=c; }
    else{ t.hidden=true; t.classList.remove("clearing","appear"); t.style.removeProperty("--delay"); t.removeAttribute("data-delay"); }
  }
  renderHUD();
}

/* ====== 托盤渲染（固定槽位；候選縮放置中；clone 時保留 grid） ====== */
function fitPieceIntoSlot(pieceEl, slot, cols, rows){
  const trayCell=parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--tray-cell'))||30;
  const fillBase=parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--tray-fill'))||0.94;
  const maxS=parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--tray-scale-max'))||1.8;
  const gap=parseFloat(getComputedStyle(pieceEl).gap)||4;
  const naturalW=cols*trayCell+(cols-1)*gap;
  const naturalH=rows*trayCell+(rows-1)*gap;
  const scs=getComputedStyle(slot);
  const availW=slot.clientWidth-(parseFloat(scs.paddingLeft)||0)-(parseFloat(scs.paddingRight)||0);
  const availH=slot.clientHeight-(parseFloat(scs.paddingTop)||0)-(parseFloat(scs.paddingBottom)||0);
  const fill=(Math.max(cols,rows)>=4)? fillBase*0.92 : fillBase;
  const s=Math.min(maxS, Math.min(availW/naturalW, availH/naturalH)*fill);
  pieceEl.style.transform=`scale(${s})`; pieceEl.style.transformOrigin='center center';
  pieceEl.dataset.scale=s; pieceEl.dataset.cols=cols; pieceEl.dataset.rows=rows;
}
function renderPieceInto(slotEl,p){
  slotEl.innerHTML=""; if(!p){ slotEl.classList.add("empty"); return; }
  slotEl.classList.remove("empty");

  const wrap=document.createElement("div"); wrap.className="pwrap";
  const inner=document.createElement("div"); inner.className="pinner";
  const el=document.createElement("div"); el.className="piece";

  // 直接用 inline grid，確保 clone 到任何容器都保有 grid
  el.style.display = "grid";
  el.style.gridTemplateColumns=`repeat(${p.w}, var(--tray-cell))`;
  el.style.gridTemplateRows=`repeat(${p.h}, var(--tray-cell))`;

  p.cells.forEach(([x,y])=>{
    const c=document.createElement("div");
    c.className="cell-mini";
    c.style.background=p.color;
    c.style.gridColumnStart = (x+1);
    c.style.gridRowStart    = (y+1);
    c.dataset.gx = x;
    c.dataset.gy = y;
    el.appendChild(c);
  });

  inner.appendChild(el); wrap.appendChild(inner); slotEl.appendChild(wrap);
  fitPieceIntoSlot(el, slotEl, p.w, p.h);
  return el;
}
function renderHold(){
  const slot=$("#holdSlot"); slot.innerHTML="";
  if(!state.hold){ slot.textContent="（空）"; return; }
  const p=state.hold;
  const wrap=document.createElement("div"); wrap.className="pwrap";
  const inner=document.createElement("div"); inner.className="pinner";
  const el=document.createElement("div"); el.className="piece";
  el.style.display="grid";
  el.style.gridTemplateColumns=`repeat(${p.w}, var(--tray-cell))`;
  el.style.gridTemplateRows=`repeat(${p.h}, var(--tray-cell))`;
  p.cells.forEach(([x,y])=>{ const c=document.createElement("div"); c.className="cell-mini"; c.style.background=p.color; c.style.gridColumnStart=x+1; c.style.gridRowStart=y+1; c.dataset.gx=x; c.dataset.gy=y; el.appendChild(c); });
  inner.appendChild(el); wrap.appendChild(inner); slot.appendChild(wrap);
  fitPieceIntoSlot(el, slot, p.w, p.h);
}
function renderTray(){
  $$(".slot").forEach(s=>{ s.innerHTML=""; s.classList.add("empty"); s.classList.remove("hint","hover-mag","selected"); });
  state.tray.forEach((p,idx)=>{
    const s=$(`.slot[data-index="${idx}"]`);
    if(!p){ s.classList.add("empty"); return; }
    const el=renderPieceInto(s,p);
    el.dataset.index=idx;
    el.addEventListener("pointerdown", onPiecePointerDown, {passive:false});
    el.addEventListener("click", onPieceTapSelect, {passive:false}); // Tap‑to‑Place
  });
  renderHold();
  requestAnimationFrame(fitTrayPieces);
}
function fitTrayPieces(){
  $$(".slot .piece").forEach(el=>{
    const slot=el.closest('.slot');
    const cols=Number(el.dataset.cols)||parseInt((el.style.gridTemplateColumns.match(/repeat\((\d+)/)||[])[1]||'1',10);
    const rows=Number(el.dataset.rows)||parseInt((el.style.gridTemplateRows.match(/repeat\((\d+)/)||[])[1]||'1',10);
    fitPieceIntoSlot(el, slot, cols, rows);
  });
  const hold=$("#holdSlot .piece");
  if(hold){
    const cols=Number(hold.dataset.cols)||parseInt((hold.style.gridTemplateColumns.match(/repeat\((\d+)/)||[])[1]||'1',10);
    const rows=Number(hold.dataset.rows)||parseInt((hold.style.gridTemplateRows.match(/repeat\((\d+)/)||[])[1]||'1',10);
    fitPieceIntoSlot(hold, $("#holdSlot"), cols, rows);
  }
}

/* ====== 幽靈層/FX 畫布定位 ====== */
function positionOverlayLayers(){
  const rect=boardEl.getBoundingClientRect();
  const wrap=boardWrap.getBoundingClientRect();
  const padL=parseFloat(getComputedStyle(boardEl).paddingLeft)||0;
  const padT=parseFloat(getComputedStyle(boardEl).paddingTop)||0;

  const L=rect.left-wrap.left+padL,
        T=rect.top -wrap.top +padT,
        W=rect.width -padL*2,
        H=rect.height-padT*2;

  ghostEl.style.left  = px(L);
  ghostEl.style.top   = px(T);
  ghostEl.style.width = px(W);
  ghostEl.style.height= px(H);

  fx.style.left  = px(L);
  fx.style.top   = px(T);
  fx.style.width = px(W);
  fx.style.height= px(H);

  const dpr = Math.min(2, devicePixelRatio||1);
  fx.width  = Math.round(W*dpr);
  fx.height = Math.round(H*dpr);
}
const ro=new ResizeObserver(()=>requestAnimationFrame(positionOverlayLayers));
ro.observe(boardEl); positionOverlayLayers();

/* ====== 把棋盤 (x,y) 轉成 ghost/fx 相對像素 ====== */
function cellRectRel(x,y){
  if(x<0||y<0||x>=SIZE||y>=SIZE) return null;
  const r = cellAt(x,y).getBoundingClientRect();
  const br = boardEl.getBoundingClientRect();
  const padL = parseFloat(getComputedStyle(boardEl).paddingLeft)||0;
  const padT = parseFloat(getComputedStyle(boardEl).paddingTop)||0;
  return {
    left:  r.left - br.left - padL,
    top:   r.top  - br.top  - padT,
    width: r.width,
    height:r.height
  };
}

/* ====== 分數 / FEVER / COMBO ====== */
const FEVER_PER_LINE = Math.round(100 / Math.max(3, Math.round(SIZE/2)));
function addScore(delta){
  state.score += delta;
  if(state.score>state.best){ state.best=state.score; localStorage.setItem(BEST_KEY,String(state.best)); }
  renderHUD(); announce(`分數 ${state.score}，最高分 ${state.best}`);
  bus.emit('score-change', {score:state.score,best:state.best});
}
function addStars(n){ state.stars=Math.min(99, state.stars+n); renderHUD(); }
function spendStars(n){ if(state.stars<n){ toast("⭐ 不足","#ffd1d1"); return false; } state.stars-=n; renderHUD(); return true; }

function setFeverMeter(v){ state.fever.meter=Math.max(0,Math.min(100,v)); if(feverFill) feverFill.style.setProperty('--fever', state.fever.meter/100); saveState(); bus.emit('fever-meter', {value:state.fever.meter}); }
function triggerFever(durationMs=14000){
  if(state.fever.active) return;
  state.fever.active=true; state.fever.until=Date.now()+durationMs; document.body.classList.add("is-fever");
  state.stats.feverTriggers++;
  bus.emit('fever-change', {active:true});
  requestAnimationFrame(function tick(){ if(!state.fever.active) return; if(Date.now()>=state.fever.until){ state.fever.active=false; document.body.classList.remove("is-fever"); setFeverMeter(0); bus.emit('fever-change', {active:false}); } else requestAnimationFrame(tick); });
}

function setCombo(n){
  state.streak=n;
  if(n<=0){ comboBar.style.width="0%"; comboTag.classList.remove("show"); bus.emit('combo-change',{combo:0}); return; }
  comboTag.classList.add("show"); comboTag.textContent=`COMBO ×${n}`;
  comboTag.style.transform="scale(1)"; requestAnimationFrame(()=> comboTag.style.transform="scale(1.06)");
  state.stats.maxCombo=Math.max(state.stats.maxCombo,n);
  bus.emit('combo-change',{combo:n});
}
let comboTimer=null, comboTimeMs=3400;
function startComboTimer(){
  const start=Date.now();
  if(comboTimer) clearInterval(comboTimer);
  comboTimer=setInterval(()=>{
    const p=clamp((Date.now()-start)/comboTimeMs,0,1);
    comboBar.style.width=`${(1-p)*100}%`;
    if(p>=1){ setCombo(0); clearInterval(comboTimer); comboTimer=null; }
  },100);
}

function findFullLines(){
  const rows=[], cols=[];
  for(let y=0;y<SIZE;y++) if(state.board[y].every(Boolean)) rows.push(y);
  for(let x=0;x<SIZE;x++){ let full=true; for(let y=0;y<SIZE;y++){ if(!state.board[y][x]){ full=false; break; } } if(full) cols.push(x); }
  return {rows, cols};
}
function animateAndClear(rows, cols){
  const toClear=[]; const cx=(SIZE-1)/2, cy=(SIZE-1)/2, du=16;
  rows.forEach(y=>{ for(let x=0;x<SIZE;x++){ const d=Math.abs(x-cx)*du; const tile=cellAt(x,y).firstElementChild; tile.classList.add("clearing"); tile.style.setProperty("--delay",`${d}ms`); tile.setAttribute("data-delay",""); toClear.push([x,y,d]); }});
  cols.forEach(x=>{ for(let y=0;y<SIZE;y++){ const d=Math.abs(y-cy)*du; const tile=cellAt(x,y).firstElementChild; tile.classList.add("clearing"); tile.style.setProperty("--delay",`${d}ms`); tile.setAttribute("data-delay",""); toClear.push([x,y,d]); }});
  const maxDelay = toClear.reduce((m,c)=>Math.max(m,c[2]),0);
  setTimeout(()=>{ toClear.forEach(([x,y])=> state.board[y][x]=null); renderBoard(); saveState(); }, maxDelay+240);
}

/* FEVER 期間掉星（樂感更黏） */
function awardFeverStars(linesCleared){
  if(!state.fever.active || !linesCleared) return 0;
  const base=0.22, comboBonus=Math.min(0.25, state.streak*0.05), multiBonus=Math.min(0.15, Math.max(0,linesCleared-1)*0.08);
  const p=Math.min(0.65, base + comboBonus + multiBonus);
  let stars=0; for(let i=0;i<linesCleared;i++){ if(RNG.next()<p) stars++; }
  if(stars>0){ addStars(stars); state.stats.starsGain += stars; flyStarsToFever(stars, boardEl.getBoundingClientRect()); buzz([8,40,8]); }
  return stars;
}

/* ====== Hint ====== */
let hintData=null;
function clearHint(){ $$(".slot.hint").forEach(el=>el.classList.remove("hint")); $$(".ghost-cell").forEach(el=>el.remove()); hintData=null; state.hintShown=false; }
function canPlace(piece,x,y){ for(const [dx,dy] of piece.cells){ const cx=x+dx, cy=y+dy; if(cx<0||cx>=SIZE||cy<0||cy>=SIZE) return false; if(state.board[cy][cx]) return false; } return true; }
function bestPlacement(){
  let best=null;
  state.tray.forEach((p,idx)=>{
    if(!p) return;
    for(let y=0;y<=SIZE-p.h;y++){
      for(let x=0;x<=SIZE-p.w;x++){
        if(!canPlace(p,x,y)) continue;
        let rows=Array(SIZE).fill(0), cols=Array(SIZE).fill(0);
        for(let yy=0;yy<SIZE;yy++) for(let xx=0;xx<SIZE;xx++) if(state.board[yy][xx]){ rows[yy]++; cols[xx]++; }
        p.cells.forEach(([dx,dy])=>{ rows[y+dy]++; cols[x+dx]++; });
        const clearCount = rows.filter(v=>v===SIZE).length + cols.filter(v=>v===SIZE).length;
        const centerBias = - (Math.abs(x - (SIZE-1)/2) + Math.abs(y - (SIZE-1)/2)) * 0.01;
        const score = clearCount*100 + p.n*0.1 + centerBias;
        if(!best || score>best.score) best={ idx, x, y, score, clearCount, p };
      }
    }
  });
  return best;
}
function showHint(){
  clearHint();
  const b=bestPlacement();
  if(!b){ toast("沒有可放置位置","#ffd1d1"); return; }
  document.querySelector(`.slot[data-index="${b.idx}"]`)?.classList.add("hint");
  b.p.cells.forEach(([dx,dy])=>{
    const rr = cellRectRel(b.x+dx, b.y+dy);
    if(!rr) return;
    const g=document.createElement("div");
    g.className="ghost-cell";
    g.style.left=px(rr.left); g.style.top=px(rr.top); g.style.width=px(rr.width); g.style.height=px(rr.height);
    ghostEl.appendChild(g);
  });
  hintData=b; state.hintShown=true;
}

/* ====== 命中格：點擊/拖曳一致化 ====== */
function _measureGrid() {
  const c00 = cellAt(0,0).getBoundingClientRect();
  const c10 = cellAt(Math.min(1,SIZE-1),0).getBoundingClientRect();
  const c01 = cellAt(0,Math.min(1,SIZE-1)).getBoundingClientRect();
  const boardRect = boardEl.getBoundingClientRect();
  const stepX = (SIZE>1) ? (c10.left - c00.left) : c00.width;
  const stepY = (SIZE>1) ? (c01.top  - c00.top ) : c00.height;
  const origin = { x: c00.left, y: c00.top };
  const magnet = isCoarse ? Math.max(c00.width*0.75, 26) : Math.max(c00.width*0.5, 18);
  return { boardRect, stepX, stepY, origin, magnet };
}
function hitCellStrict(clientX, clientY){
  for(let y=0;y<SIZE;y++){
    for(let x=0;x<SIZE;x++){
      const r=cellAt(x,y).getBoundingClientRect();
      if(clientX>=r.left && clientX<r.right && clientY>=r.top && clientY<r.bottom) return {gx:x,gy:y};
    }
  }
  return {gx:-1, gy:-1};
}
function hitCellMagnet(clientX, clientY){
  const g=_measureGrid();
  if(clientX < g.boardRect.left - g.magnet || clientX > g.boardRect.right + g.magnet ||
     clientY < g.boardRect.top  - g.magnet || clientY > g.boardRect.bottom + g.magnet){
    return {gx:-1, gy:-1};
  }
  const gx = Math.round((clientX - g.origin.x) / g.stepX);
  const gy = Math.round((clientY - g.origin.y) / g.stepY);
  if(gx<0||gy<0||gx>=SIZE||gy>=SIZE) return {gx:-1, gy:-1};
  return {gx, gy};
}
function cellIndexFromPoint(x,y){ return hitCellStrict(x,y); }
function nearestCellFromPoint(x,y){ return hitCellMagnet(x,y); }

/* ====== 拖曳（起飛→跟手 + 橡皮筋曲線 + 高亮/磁吸 + 清行預視） ====== */
let drag=null, dragRAF=0, lastMoveEvent=null, highlightCell=null;
function clearHighlight(){ if(highlightCell){ cellAt(highlightCell.x,highlightCell.y)?.classList.remove('highlight'); } highlightCell=null; }
function setHighlight(x,y){ if(highlightCell&&(highlightCell.x!==x||highlightCell.y!==y)){ cellAt(highlightCell.x,highlightCell.y)?.classList.remove('highlight'); } const c=cellAt(x,y); if(c){ c.classList.add('highlight'); highlightCell={x,y}; } }
function clearGhost(){ ghostEl.innerHTML=""; if(drag){ drag.ghostNodes=null; drag.lineNodes=[]; } }

/* 使用實際 .cell-mini 的中心點來找最近格（最穩） */
function computeGrabOffset(e, pieceEl, piece){
  const minis = Array.from(pieceEl.querySelectorAll('.cell-mini'));
  let best = {d: Infinity, sx:0, sy:0};
  for(const m of minis){
    const rc = m.getBoundingClientRect();
    const cx = rc.left + rc.width/2;
    const cy = rc.top  + rc.height/2;
    const d  = (e.clientX-cx)*(e.clientX-cx) + (e.clientY-cy)*(e.clientY-cy);
    if(d < best.d){
      const sx = (m.dataset.gx!=null) ? Number(m.dataset.gx)
               : ((parseInt(m.style.gridColumnStart,10)||1)-1);
      const sy = (m.dataset.gy!=null) ? Number(m.dataset.gy)
               : ((parseInt(m.style.gridRowStart,10)||1)-1);
      best = {d, sx, sy};
    }
  }
  return { sx: best.sx, sy: best.sy };
}
function makeProxy(fromEl, grab, piece){
  const proxy = fromEl.cloneNode(true);
  proxy.className = "drag-proxy";
  document.body.appendChild(proxy);

  // 代理內 .piece 也要保持 grid
  const pieceNode = proxy;
  pieceNode.style.display = "grid";
  pieceNode.style.gridTemplateColumns = fromEl.style.gridTemplateColumns;
  pieceNode.style.gridTemplateRows    = fromEl.style.gridTemplateRows;
  pieceNode.style.gap = getComputedStyle(fromEl).gap;

  const trayCell = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--tray-cell'))||30;
  const gap      = parseFloat(getComputedStyle(fromEl).gap)||4;
  const naturalW = piece.w*trayCell + (piece.w-1)*gap;
  const bboxW    = fromEl.getBoundingClientRect().width;
  const scale    = parseFloat(fromEl.dataset.scale) || (bboxW/naturalW);

  const offX = grab.sx*(trayCell+gap) + trayCell/2; // 未縮放
  const offY = grab.sy*(trayCell+gap) + trayCell/2; // 未縮放

  proxy.dataset.scale = scale;
  proxy.dataset.offX  = offX;
  proxy.dataset.offY  = offY;
  return proxy;
}
function moveProxySmooth(x,y){
  if(!drag) return;
  const sc   = parseFloat(drag.proxyEl.dataset.scale)||1;
  const offX = parseFloat(drag.proxyEl.dataset.offX)||20;
  const offY = parseFloat(drag.proxyEl.dataset.offY)||20;
  const lift = isCoarse?14:6;

  let extraScale=1, rotX=0, rotY=0;
  const lowfx = document.body.classList.contains('lowfx') || state.settings.reduce;
  if(ENABLE_SPRING && !lowfx && drag.launchAt){
    const t = Math.min(1, (nowMs()-drag.launchAt)/DRAG_SPRING_MS);
    const c1=1.70158, c3=c1+1;
    const e = 1 + c3*Math.pow(t-1,3) + c1*Math.pow(t-1,2);
    extraScale = 1 + 0.06*e;
  }
  if(ENABLE_TILT && !lowfx){
    const dx = clamp(drag.targetX - drag.smoothX, -40, 40);
    const dy = clamp(drag.targetY - drag.smoothY, -40, 40);
    rotY = (dx/40) * TILT_MAX_DEG;
    rotX = -(dy/40) * TILT_MAX_DEG;
  }

  const tx = (x / sc) - offX;
  const ty = ((y - lift) / sc) - offY;

  drag.proxyEl.style.transform =
    `translate(${Math.round(tx)}px, ${Math.round(ty)}px) ` +
    `scale(${(sc*extraScale).toFixed(4)}) ` +
    (ENABLE_TILT && !lowfx ? `rotateX(${rotX.toFixed(2)}deg) rotateY(${rotY.toFixed(2)}deg)` : '');
}
function drawDragCurve(){
  if(!drag || document.body.classList.contains('lowfx') || state.settings.reduce){
    const c=fx.getContext('2d'); c.clearRect(0,0,fx.width,fx.height);
    return;
  }
  const c=fx.getContext('2d'), dpr=Math.min(2, devicePixelRatio||1);
  c.clearRect(0,0,fx.width,fx.height);

  const boardRect=boardEl.getBoundingClientRect();
  const pad=parseFloat(getComputedStyle(boardEl).paddingLeft)||0;
  const rel = (sx,sy)=>({ x:(sx - (boardRect.left+pad))*dpr, y:(sy - (boardRect.top+pad))*dpr });

  const end = rel(drag.smoothX, drag.smoothY);
  let startX = clamp(drag.startX, boardRect.left, boardRect.right);
  let startY = clamp(drag.startY, boardRect.top , boardRect.bottom);
  const start = rel(startX, startY);

  const ctrl  = { x: (start.x*0.35 + end.x*0.65), y: Math.min(start.y, end.y) - 30*dpr };

  let pulse=1.0;
  if(state.fever.active){
    const T=600; const ph=((performance.now()%T)/T)*2*Math.PI;
    pulse = 1.15 + 0.25*Math.sin(ph);
  }

  c.lineWidth = CURVE_BASE_W * dpr * pulse;
  c.lineCap   = 'round';
  c.shadowColor='rgba(122,162,255,.35)';
  c.shadowBlur = 8*dpr*pulse;

  const grd = c.createLinearGradient(start.x,start.y,end.x,end.y);
  grd.addColorStop(0,'rgba(122,162,255,0.00)');
  grd.addColorStop(0.35,`rgba(122,162,255,${0.25*pulse})`);
  grd.addColorStop(1,`rgba(122,162,255,${0.65*pulse})`);
  c.strokeStyle = grd;

  c.beginPath();
  c.moveTo(start.x,start.y);
  c.quadraticCurveTo(ctrl.x, ctrl.y, end.x, end.y);
  c.stroke();
}
function ensureGhostNodesFor(piece){
  if(!drag) return;
  if(!drag.ghostNodes || drag.ghostNodes.length!==piece.cells.length){
    ghostEl.innerHTML="";
    drag.ghostNodes = piece.cells.map(()=>{ const n=document.createElement("div"); n.className="ghost-cell"; ghostEl.appendChild(n); return n; });
  }else if(ghostEl.childElementCount < drag.ghostNodes.length){
    ghostEl.innerHTML="";
    drag.ghostNodes.forEach(n=>ghostEl.appendChild(n));
  }
  drag.lineNodes = drag.lineNodes || [];
}
function showClearPreview(ax,ay,piece,ok){
  if(drag.lineNodes && drag.lineNodes.length){ drag.lineNodes.forEach(n=>n.remove()); drag.lineNodes=[]; }
  if(!ok) return;
  let rows=Array(SIZE).fill(0), cols=Array(SIZE).fill(0);
  for(let yy=0;yy<SIZE;yy++) for(let xx=0;xx<SIZE;xx++) if(state.board[yy][xx]){ rows[yy]++; cols[xx]++; }
  piece.cells.forEach(([dx,dy])=>{ rows[ay+dy]++; cols[ax+dx]++; });
  const R = rows.map((v,i)=> (v===SIZE? i : -1)).filter(v=>v>=0);
  const C = cols.map((v,i)=> (v===SIZE? i : -1)).filter(v=>v>=0);

  const mkRow=(y)=>{
    const r0=cellRectRel(0,y), r1=cellRectRel(SIZE-1,y); if(!r0||!r1) return;
    const n=document.createElement('div');
    n.style.position='absolute';
    n.style.left=px(r0.left); n.style.top=px(r0.top);
    n.style.width=px(r1.left+r1.width-r0.left); n.style.height=px(r0.height);
    n.style.background='rgba(62,240,180,.12)';
    n.style.boxShadow='0 0 0 2px rgba(62,240,180,.35) inset';
    n.style.borderRadius='8px';
    ghostEl.appendChild(n); drag.lineNodes.push(n);
  };
  const mkCol=(x)=>{
    const r0=cellRectRel(x,0), r1=cellRectRel(x,SIZE-1); if(!r0||!r1) return;
    const n=document.createElement('div');
    n.style.position='absolute';
    n.style.left=px(r0.left); n.style.top=px(r0.top);
    n.style.width=px(r0.width); n.style.height=px(r1.top+r1.height-r0.top);
    n.style.background='rgba(62,240,180,.10)';
    n.style.boxShadow='0 0 0 2px rgba(62,240,180,.32) inset';
    n.style.borderRadius='8px';
    ghostEl.appendChild(n); drag.lineNodes.push(n);
  };
  R.forEach(mkRow); C.forEach(mkCol);
}

/* === 拖曳流程 === */
function onPiecePointerDown(e){
  if(state.gameOver || (state.tutorial && state.tutorial.active)) return;
  if(state.settings.tapPlace) return; // Tap 模式下，拖曳改由兩段式，不在 pointerdown 啟動

  const idx=Number(e.currentTarget.dataset.index);

  if(state.awaitingHold){
    const tmp=state.hold; state.hold=state.tray[idx]; state.tray[idx]=tmp||null;
    state.awaitingHold=false; renderTray(); saveState(); buzz(12); return;
  }

  const src=state.tray[idx]; if(!src) return;
  const piece=JSON.parse(JSON.stringify(src));

  e.currentTarget.setPointerCapture(e.pointerId);
  e.currentTarget.classList.add("grabbed");

  const grab=computeGrabOffset(e, e.currentTarget, piece);
  const proxy=makeProxy(e.currentTarget, grab, piece);

  const slotRect = e.currentTarget.getBoundingClientRect();
  const sc = parseFloat(proxy.dataset.scale)||1;
  const startX = slotRect.left + parseFloat(proxy.dataset.offX)*sc;
  const startY = slotRect.top  + parseFloat(proxy.dataset.offY)*sc;

  drag = {
    piece, idx, proxyEl:proxy, grab,
    lastOk:null, anchor:null,
    startX, startY,
    targetX:e.clientX, targetY:e.clientY,
    smoothX:startX, smoothY:startY,
    lastT: nowMs(),
    launchAt: nowMs(),
    ghostNodes:null,
    lineNodes:[]
  };

  clearGhost(); clearHighlight();
  moveProxySmooth(drag.smoothX, drag.smoothY);

  addEventListener("pointermove", onDragMove, {passive:false});
  addEventListener("pointerup",    onDragEnd,  {once:true});
  addEventListener("pointercancel",onDragCancel,{once:true});

  if(!dragRAF) dragRAF=requestAnimationFrame(dragTick);
  lastMoveEvent=e;
}
function onDragMove(e){
  e.preventDefault();
  const latest = e.getCoalescedEvents ? e.getCoalescedEvents().at(-1) : e;
  lastMoveEvent = latest;
  if(drag){
    drag.targetX = latest.clientX;
    drag.targetY = latest.clientY;
  }
}
function dragTick(){
  if(drag){
    const t = nowMs();
    drag.lastT = t;
    const k = 0.22;
    drag.smoothX = lerp(drag.smoothX, drag.targetX, k);
    drag.smoothY = lerp(drag.smoothY, drag.targetY, k);

    moveProxySmooth(drag.smoothX, drag.smoothY);
    updateGhost(drag.smoothX, drag.smoothY);
    drawDragCurve();

    dragRAF = requestAnimationFrame(dragTick);
  }else{
    cancelAnimationFrame(dragRAF); dragRAF=0;
    const c=fx.getContext('2d'); c.clearRect(0,0,fx.width,fx.height);
  }
}
function onDragEnd(){
  if(!drag) return;
  const {piece,idx,anchor}=drag;

  $(`.piece[data-index="${idx}"]`)?.classList.remove("grabbed");
  try{ drag.proxyEl.remove(); }catch{}

  const c=fx.getContext('2d'); c.clearRect(0,0,fx.width,fx.height);
  clearGhost(); clearHighlight();

  if(anchor && anchor.ok){ commitPlacement(piece, idx, anchor.x, anchor.y); buzz(10); }
  drag=null;
  removeEventListener("pointermove", onDragMove);
}
function onDragCancel(){
  if(!drag) return;
  try{ drag.proxyEl.remove(); }catch{}
  const c=fx.getContext('2d'); c.clearRect(0,0,fx.width,fx.height);
  drag=null; clearGhost(); clearHighlight();
  removeEventListener("pointermove", onDragMove);
}
function updateGhost(clientX,clientY){
  positionOverlayLayers();
  let hit = cellIndexFromPoint(clientX,clientY);
  if(hit.gx<0 || hit.gy<0) hit = nearestCellFromPoint(clientX,clientY);
  if(hit.gx<0 || hit.gy<0){ drag && (drag.anchor=null); clearHighlight(); if(drag && drag.lineNodes){ drag.lineNodes.forEach(n=>n.remove()); drag.lineNodes=[]; } return; }

  const sx=drag.grab.sx, sy=drag.grab.sy;
  let ax = hit.gx - sx, ay = hit.gy - sy;
  let ok = canPlace(drag.piece, ax, ay);

  if(!ok && drag.lastOk){
    const dx = hit.gx - (drag.lastOk.x + sx);
    const dy = hit.gy - (drag.lastOk.y + sy);
    if(Math.hypot(dx,dy) < 0.35){ ax=drag.lastOk.x; ay=drag.lastOk.y; ok=true; }
  }

  ensureGhostNodesFor(drag.piece);
  drag.ghostNodes.forEach((node,i)=>{
    const [dx,dy]=drag.piece.cells[i];
    const rr=cellRectRel(ax+dx, ay+dy); if(!rr) return;
    node.style.left=px(rr.left); node.style.top=px(rr.top);
    node.style.width=px(rr.width); node.style.height=px(rr.height);
    node.className = "ghost-cell" + (ok?"":" ghost-invalid");
  });

  drag.anchor={x:ax,y:ay,ok};
  if(ok){ drag.lastOk={x:ax,y:ay}; setHighlight(ax+sx, ay+sy); showClearPreview(ax,ay,drag.piece,true); }
  else   { clearHighlight(); showClearPreview(ax,ay,drag.piece,false); }
}

/* ====== Tap‑to‑Place 兩段式放置 ====== */
let tapSel=null, tapNodes=null, tapLastOk=null, tapAnchor=null, tapTracking=false;
function clearTapGhost(){ if(tapNodes){ tapNodes.forEach(n=>n.remove()); tapNodes=null; } tapLastOk=null; tapAnchor=null; clearHighlight(); }
function clearTapSelect(){ if(!tapSel) return; document.querySelector(`.slot[data-index="${tapSel.idx}"]`)?.classList.remove("selected"); clearTapGhost(); tapSel=null; }
function ensureTapNodesFor(piece){
  if(!tapNodes || tapNodes.length!==piece.cells.length){
    ghostEl.innerHTML="";
    tapNodes = piece.cells.map(()=>{ const n=document.createElement("div"); n.className="ghost-cell"; ghostEl.appendChild(n); return n; });
  }else if(ghostEl.childElementCount < tapNodes.length){
    ghostEl.innerHTML=""; tapNodes.forEach(n=>ghostEl.appendChild(n));
  }
}
function updateGhostTap(clientX,clientY){
  if(!tapSel) return;
  positionOverlayLayers();
  let hit = hitCellStrict(clientX,clientY);
  if(hit.gx<0 || hit.gy<0) hit = hitCellMagnet(clientX,clientY);
  if(hit.gx<0 || hit.gy<0){ tapAnchor=null; clearHighlight(); return; }

  const sx=tapSel.grab.sx, sy=tapSel.grab.sy;
  let ax = hit.gx - sx, ay = hit.gy - sy;
  let ok = canPlace(tapSel.piece, ax, ay);

  if(!ok && tapLastOk){
    const dx = hit.gx - (tapLastOk.x + sx);
    const dy = hit.gy - (tapLastOk.y + sy);
    if(Math.hypot(dx,dy) < 0.35){ ax=tapLastOk.x; ay=tapLastOk.y; ok=true; }
  }

  ensureTapNodesFor(tapSel.piece);
  tapSel.piece.cells.forEach(([dx,dy],i)=>{
    const rr=cellRectRel(ax+dx, ay+dy); if(!rr) return;
    const node=tapNodes[i];
    node.style.left=px(rr.left); node.style.top=px(rr.top);
    node.style.width=px(rr.width); node.style.height=px(rr.height);
    node.className = "ghost-cell" + (ok?"":" ghost-invalid");
  });

  tapAnchor={x:ax,y:ay,ok};
  if(ok){ tapLastOk={x:ax,y:ay}; setHighlight(ax+sx, ay+sy); }
  else   { clearHighlight(); }
}
function onPieceTapSelect(e){
  if(!state.settings.tapPlace) return;
  if(state.gameOver || (state.tutorial && state.tutorial.active)) return;

  const idx=Number(e.currentTarget.dataset.index);
  const src=state.tray[idx]; if(!src) return;

  // 再點同一個：取消選取
  if(tapSel && tapSel.idx===idx){ clearTapSelect(); return; }
  clearTapSelect();

  const piece=JSON.parse(JSON.stringify(src));
  const grab=computeGrabOffset(e, e.currentTarget, piece);
  tapSel = { piece, idx, grab };
  document.querySelector(`.slot[data-index="${idx}"]`)?.classList.add("selected");
  toast("點棋盤放下","#cfe");
}
function onBoardTapDown(e){
  if(!state.settings.tapPlace || !tapSel || state.tools.hammer) return;
  e.preventDefault();
  tapTracking=true;
  updateGhostTap(e.clientX,e.clientY);
  addEventListener("pointermove", onBoardTapMove, {passive:false});
  addEventListener("pointerup",   onBoardTapUp,   {once:true});
  addEventListener("pointercancel", onBoardTapCancel, {once:true});
}
function onBoardTapMove(e){ if(!tapTracking || !tapSel) return; e.preventDefault(); updateGhostTap(e.clientX,e.clientY); }
function onBoardTapUp(){
  if(!tapSel){ tapTracking=false; return; }
  tapTracking=false;
  if(tapAnchor && tapAnchor.ok){ commitPlacement(tapSel.piece, tapSel.idx, tapAnchor.x, tapAnchor.y); buzz(10); }
  clearTapSelect();
}
function onBoardTapCancel(){ tapTracking=false; clearTapSelect(); }
boardEl.addEventListener("pointerdown", onBoardTapDown, {passive:false});

/* ====== 放置邏輯 ====== */
function commitPlacement(piece, trayIdx, x, y){
  clearGhost(); clearHighlight(); clearTapGhost();

  const prev={ board: JSON.parse(JSON.stringify(state.board)), score:state.score, tray: JSON.parse(JSON.stringify(state.tray)), usedThisSet:state.usedThisSet, streak:state.streak, hold:state.hold?JSON.parse(JSON.stringify(state.hold)):null, fever: JSON.parse(JSON.stringify(state.fever)), stats: JSON.parse(JSON.stringify(state.stats)) };

  piece.cells.forEach(([dx,dy])=>{ state.board[y+dy][x+dx]=piece.color; });
  piece.cells.forEach(([dx,dy])=>{
    const tile=cellAt(x+dx,y+dy).firstElementChild;
    tile.hidden=false; tile.style.background=piece.color; tile.classList.add("appear");
    setTimeout(()=>tile.classList.remove("appear"), 200);
  });
  bus.emit('place', {piece, at:{x,y}});

  state.tray[trayIdx]=null; state.usedThisSet++; renderTray();
  state.stats.placed += piece.n; missionsAddProgress('place', piece.n);

  let deltaScore=piece.n;
  const {rows,cols}=findFullLines();
  const linesCleared=rows.length+cols.length;
  if(linesCleared){
    animateAndClear(rows,cols);
    state.stats.lines+=linesCleared; missionsAddProgress('lines', linesCleared);

    deltaScore += 10*linesCleared + (linesCleared>1 ? 10*(linesCleared-1) : 0);

    let starsEarn = 0;
    if(linesCleared>=2){ starsEarn += (linesCleared-1); addStars(linesCleared-1); flyStarsToFever(linesCleared-1, boardEl.getBoundingClientRect()); }
    starsEarn += awardFeverStars(linesCleared);
    if(starsEarn>0) missionsAddProgress('stars', starsEarn);

    setFeverMeter(state.fever.meter + linesCleared*FEVER_PER_LINE + Math.min(10, piece.n));
    if(state.fever.meter >= 100) triggerFever();

    setCombo(state.streak+1); startComboTimer();
    bus.emit('clear', {lines:linesCleared});
  } else {
    setCombo(0);
  }

  const mult=state.fever.active?2:1;
  addScore(Math.round(deltaScore * mult));
  state.stats.sessionScore += Math.round(deltaScore * mult);
  missionsSetProgressMax('sessionScore', state.stats.sessionScore);
  missionsSetProgressMax('comboMax', state.streak);

  state.history.push(prev); if(state.history.length>50) state.history.shift();

  if(state.usedThisSet>=3) refillTrayFair();
  if(!hasAnyValidMove()) endGame();
  else { renderBoard(); saveState(); }
  state.lastActionAt=Date.now();
}

/* ====== 公平補牌 ====== */
function hasAnyValidMoveForTray(tray){ for(const p of tray){ if(!p) continue; for(let y=0;y<SIZE;y++) for(let x=0;x<SIZE;x++) if(canPlace(p,x,y)) return true; } return false; }
function hasAnyValidMove(){ return hasAnyValidMoveForTray(state.tray); }
function refillTrayFair(){
  let pieces=[pickPiece(),pickPiece(),pickPiece()];
  let tries=0; while(!hasAnyValidMoveForTray(pieces) && tries<30){ pieces=[pickPiece(),pickPiece(),pickPiece()]; tries++; }
  state.tray=pieces; state.usedThisSet=0; renderTray(); saveState();
  requestAnimationFrame(fitTrayPieces);
}

/* ====== 任務 / 每日挑戰 ====== */
let missions=null;
function getWeekKey(d=new Date()){ const dt=new Date(d); const onejan=new Date(dt.getFullYear(),0,1); const week=Math.ceil((((dt-onejan)/86400000)+onejan.getDay()+1)/7); return `${dt.getFullYear()}-W${week}`; }
const DAILY_POOL=[
  {id:'d_lines10', title:'清除 10 行', metric:'lines', target:10, reward:1},
  {id:'d_lines12', title:'清除 12 行', metric:'lines', target:12, reward:2},
  {id:'d_combo3',  title:'達成 3 連擊', metric:'comboMax', target:3, reward:1},
  {id:'d_place20', title:'放置 20 塊', metric:'place', target:20, reward:1},
  {id:'d_score200',title:'單局得分 200', metric:'sessionScore', target:200, reward:2},
  {id:'d_fever1',  title:'觸發 1 次 FEVER', metric:'fever', target:1, reward:2},
  {id:'d_hammer1', title:'使用錘子 1 次', metric:'hammer', target:1, reward:1}
];
const WEEKLY_DEF=[
  {id:'w_score1800', title:'累積總分 1800', metric:'scoreSum', target:1800, reward:4},
  {id:'w_lines70',   title:'清除 70 行', metric:'lines', target:70, reward:3},
  {id:'w_games5',    title:'完成 5 局', metric:'games', target:5, reward:3},
  {id:'w_stars10',   title:'獲得 10 顆星', metric:'stars', target:10, reward:2}
];
function seededPick(arr,count,seed){ const r=mulberry32(seed|0); const bag=[...arr]; const out=[]; for(let i=0;i<count && bag.length;i++){ const idx=Math.floor(r()*bag.length); out.push(bag.splice(idx,1)[0]); } return out; }
function missionsLoad(){ const raw=localStorage.getItem(MISSIONS_KEY); missions=raw?JSON.parse(raw):{ daily:{date:"",tasks:[]}, weekly:{week:"",tasks:[]} }; missionsEnsureFresh(); }
function missionsEnsureFresh(){ const today=new Date().toISOString().slice(0,10); if(missions.daily.date!==today){ const seed=Number(today.replace(/-/g,'')); missions.daily={ date:today, tasks:seededPick(DAILY_POOL,3,seed).map(t=>({...t,progress:0,claimed:false})) }; } const wk=getWeekKey(); if(missions.weekly.week!==wk){ missions.weekly={ week:wk, tasks:WEEKLY_DEF.map(t=>({...t,progress:0,claimed:false})) }; } missionsSave(); }
function missionsSave(){ localStorage.setItem(MISSIONS_KEY, JSON.stringify(missions)); }
function renderMissionsUI(){
  const renderList=(host,tasks)=>{
    host.innerHTML="";
    tasks.forEach((t,i)=>{ const p=Math.round(100*(t.progress/t.target));
      const wrap=document.createElement('div');
      wrap.style.cssText="padding:10px 8px;border:1px solid #2a3568;border-radius:10px;margin:6px 0;background:#151a2f;";
      wrap.innerHTML=`<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;"><div style="font-weight:800">${t.title}</div><div style="font-size:12px;color:#a3acd6">${t.progress} / ${t.target}</div></div>
        <div style="position:relative;height:10px;background:#0f1528;border:1px solid #27305b;border-radius:999px;margin:8px 0 6px"><i style="position:absolute;left:0;top:0;height:100%;width:${p}%;background:linear-gradient(90deg,#3ef0b4,#7aa2ff);border-radius:999px"></i></div>
        <div style="display:flex;justify-content:flex-end;gap:8px;"><button class="claim" ${(t.progress>=t.target && !t.claimed) ? "" : "disabled"} data-scope="${host.id==='dailyList'?'daily':'weekly'}" data-idx="${i}">領取 ⭐${t.reward}</button>${t.claimed?'<span style="color:#a3acd6;font-size:12px">已領取</span>':''}</div>`;
      host.appendChild(wrap);
    });
    host.querySelectorAll('button.claim').forEach(btn=>{
      btn.addEventListener('click', ()=>{ const scope=btn.dataset.scope; const idx=Number(btn.dataset.idx); const t=missions[scope].tasks[idx]; if(!t||t.claimed||t.progress<t.target) return; t.claimed=true; addStars(t.reward); missionsSave(); renderMissionsUI(); toast("任務獎勵已領取 ⭐","#cfe"); });
    });
  };
  renderList($("#dailyList"), missions.daily.tasks);
  renderList($("#weeklyList"), missions.weekly.tasks);
}
function missionsAddProgress(metric,delta){ ['daily','weekly'].forEach(s=>{ missions[s].tasks.forEach(t=>{ if(t.metric!==metric||t.claimed) return; t.progress=Math.min(t.target,(t.progress||0)+delta); }); }); missionsSave(); }
function missionsSetProgressMax(metric,value){ ['daily','weekly'].forEach(s=>{ missions[s].tasks.forEach(t=>{ if(t.metric!==metric||t.claimed) return; t.progress=Math.min(t.target,Math.max(t.progress||0,value)); }); }); missionsSave(); }

/* ====== 海報分享（Canvas） ====== */
function roundRectPath(ctx,x,y,w,h,r){ const rr=Math.min(r,w/2,h/2); ctx.beginPath(); ctx.moveTo(x+rr,y); ctx.arcTo(x+w,y, x+w,y+h, rr); ctx.arcTo(x+w,y+h, x,y+h, rr); ctx.arcTo(x,y+h, x,y, rr); ctx.arcTo(x,y, x+w,y, rr); ctx.closePath(); }
function renderPosterCanvas(){
  const W=1080,H=1350,PAD=64; const cvs=document.createElement('canvas'); cvs.width=W; cvs.height=H; const ctx=cvs.getContext('2d');
  const g=ctx.createLinearGradient(0,0,0,H); g.addColorStop(0,'#0f1637'); g.addColorStop(1,'#0a0d21'); ctx.fillStyle=g; ctx.fillRect(0,0,W,H);
  ctx.fillStyle='#cfe1ff'; ctx.font='700 44px system-ui,-apple-system,"PingFang TC","Noto Sans TC",sans-serif'; ctx.fillText('Block Blast — Flow+ 版', PAD, PAD+32);
  ctx.font='800 40px system-ui,-apple-system,"PingFang TC","Noto Sans TC",sans-serif'; ctx.fillStyle='#fff'; ctx.fillText(`分數 ${state.score}`, PAD, PAD+96);
  ctx.fillStyle='#a3acd6'; ctx.font='700 28px system-ui,-apple-system,"PingFang TC","Noto Sans TC",sans-serif'; ctx.fillText(`最高分 ${state.best}  |  ⭐ ${state.stars}`, PAD, PAD+136); ctx.fillText(new Date().toLocaleString(), PAD, PAD+168);
  const B=Math.min(W-PAD*2,860); const boardX=(W-B)/2; const boardY=PAD+200; roundRectPath(ctx,boardX,boardY,B,B,26); ctx.fillStyle='#0e1228'; ctx.fill(); ctx.save(); ctx.clip();
  const gap=8,pad=16,cellSize=(B-pad*2-gap*(SIZE-1))/SIZE;
  for(let y=0;y<SIZE;y++) for(let x=0;x<SIZE;x++){ const cx=boardX+pad+x*(cellSize+gap), cy=boardY+pad+y*(cellSize+gap);
    roundRectPath(ctx,cx,cy,cellSize,cellSize,10); ctx.fillStyle='#141837'; ctx.fill();
    const c2=state.board[y][x]; if(c2){ roundRectPath(ctx,cx,cy,cellSize,cellSize,12); ctx.fillStyle=c2; ctx.fill(); const gg=ctx.createLinearGradient(cx,cy,cx,cy+cellSize); gg.addColorStop(0,'rgba(255,255,255,.14)'); gg.addColorStop(1,'rgba(0,0,0,.1)'); roundRectPath(ctx,cx,cy,cellSize,cellSize,12); ctx.fillStyle=gg; ctx.fill(); }
  }
  ctx.restore();
  ctx.fillStyle='#ffd08a'; ctx.font='800 28px system-ui,-apple-system,"PingFang TC","Noto Sans TC",sans-serif'; ctx.fillText(`FEVER ${(state.fever.meter|0)}%  ·  COMBO ×${Math.max(1,state.streak)}`, PAD, boardY+B+52);
  ctx.fillStyle='#5a6aa0'; ctx.font='700 22px system-ui,-apple-system,"PingFang TC","Noto Sans TC",sans-serif'; ctx.fillText('生成自 Block Blast — Flow+ 版', PAD, H-PAD+6);
  return cvs;
}
async function sharePoster(){
  const cvs=renderPosterCanvas();
  return new Promise((resolve)=>{ cvs.toBlob(async blob=>{
    const file=new File([blob],'blockblast-poster.png',{type:'image/png'});
    try{
      if(navigator.canShare && navigator.canShare({files:[file]})){
        await navigator.share({ files:[file], title:'Block Blast — Flow+ 版', text:`我在 Flow+ 版拿到 ${state.score} 分！` });
      }else{
        const a=document.createElement('a'); a.href=URL.createObjectURL(file); a.download='blockblast-poster.png'; document.body.appendChild(a); a.click(); a.remove(); toast("已下載海報","#cfe");
      }
      resolve();
    }catch(e){ toast("分享已取消","#ffd08a"); resolve(); }
  },'image/png'); });
}

/* ====== 音樂引擎（WebAudio + 可選 WebMIDI，拍點量化） ====== */
class AudioEngine{
  constructor(bus){
    this.bus=bus;
    this.ctx=null; this.master=null; this.enabled=true; this.running=false;
    this.hatGain=this.kickGain=this.snrGain=this.bassGain=this.padGain=null;
    this.padOsc1=this.padOsc2=this.padOsc3=null; this.padFilter=null;
    this.currentStep=0; this.nextNoteTime=0; this.timer=null;
    this.fever=false; this.comboLevel=0; this.midi=null; this.midiOut=null;
    this.baseTempo=112; this.quantum=0.25; // 1/16 拍
    this.mix = [
      {hat:.18,kick:.62,snr:.42,bass:0.00,pad:.03},
      {hat:.24,kick:.68,snr:.48,bass:.22,pad:.04},
      {hat:.30,kick:.74,snr:.56,bass:.34,pad:.05},
      {hat:.36,kick:.80,snr:.64,bass:.46,pad:.06},
      {hat:.42,kick:.86,snr:.72,bass:.58,pad:.08},
    ];
    this.patterns={
      hat:[[1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0],[1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],[1,1,1,1,1,1,1,0,1,1,1,1,1,1,1,0],[1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],[1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1]],
      kick:[[1,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0],[1,0,0,0,0,0,1,0,1,0,0,1,0,0,0,0],[1,0,0,1,0,1,0,0,1,0,1,0,0,1,0,0],[1,0,0,1,0,1,0,0,1,0,1,0,0,1,1,0],[1,0,1,0,0,1,0,1,1,0,1,0,0,1,1,0]],
      snr:[[0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0],[0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0],[0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0],[0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0],[0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0]],
      bass:[[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],[1,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0],[1,0,0,0,0,1,0,0,1,0,0,1,0,1,0,0],[1,0,0,0,0,1,0,1,1,0,0,1,0,1,0,1]],
    };
    this._bindBus();
  }
  _bindBus(){
    this.bus.on('place',   ({piece})=> this.trigger('place',{n:piece.n}));
    this.bus.on('clear',   ({lines})=> this.trigger('clear',{lines}));
    this.bus.on('combo-change', ({combo})=> this.setCombo(combo));
    this.bus.on('fever-change', ({active})=> this.setFever(active));
    this.bus.on('gameover', ()=> this.trigger('gameover'));
  }
  async init(){
    const AC = window.AudioContext || window.webkitAudioContext;
    if(!AC) return;
    if(this.ctx) return;
    this.ctx=new AC();
    this.master=this.ctx.createGain(); this.master.gain.value=.7; this.master.connect(this.ctx.destination);
    this.hatGain=this.ctx.createGain(); this.kickGain=this.ctx.createGain(); this.snrGain=this.ctx.createGain(); this.bassGain=this.ctx.createGain(); this.padGain=this.ctx.createGain();
    [this.hatGain,this.kickGain,this.snrGain,this.bassGain,this.padGain].forEach(g=>{ g.gain.value=0; g.connect(this.master); });

    this.padOsc1=this.ctx.createOscillator(); this.padOsc2=this.ctx.createOscillator(); this.padOsc3=this.ctx.createOscillator();
    [this.padOsc1,this.padOsc2,this.padOsc3].forEach(o=>o.type='sine');
    this.padFilter=this.ctx.createBiquadFilter(); this.padFilter.type='lowpass'; this.padFilter.frequency.value=380;
    this.padOsc1.frequency.value=196; this.padOsc2.frequency.value=246.94; this.padOsc3.frequency.value=293.66;
    this.padOsc1.connect(this.padFilter); this.padOsc2.connect(this.padFilter); this.padOsc3.connect(this.padFilter); this.padFilter.connect(this.padGain);
    this.padOsc1.start(); this.padOsc2.start(); this.padOsc3.start();

    if(navigator.requestMIDIAccess){
      try{
        this.midi = await navigator.requestMIDIAccess();
        if(state.settings.midi){
          const outs=[...this.midi.outputs.values()];
          if(outs.length) this.midiOut=outs[0];
        }
      }catch{}
    }
  }
  async resume(){ await this.init(); if(!this.ctx) return; try{ await this.ctx.resume(); }catch{} this.start(); }
  setEnabled(on){ this.enabled=on; if(on) this.start(); else this.stop(); }
  setFever(on){ this.fever=!!on; this._applyMix(); }
  setCombo(combo){ this.comboLevel = combo>=7?4: combo>=5?3: combo>=3?2: combo>=1?1: 0; this._applyMix(); }
  _applyMix(){ if(!this.ctx) return; const m=this.mix[this.comboLevel]||this.mix[0]; const boost=this.fever?1.15:1.0; this.hatGain.gain.setTargetAtTime(m.hat, this.ctx.currentTime,.05); this.kickGain.gain.setTargetAtTime(m.kick, this.ctx.currentTime,.05); this.snrGain.gain.setTargetAtTime(m.snr, this.ctx.currentTime,.05); this.bassGain.gain.setTargetAtTime(m.bass, this.ctx.currentTime,.05); this.padGain.gain.setTargetAtTime(Math.min(.12, m.pad*boost), this.ctx.currentTime,.20); }
  start(){ if(!this.enabled) return; if(!this.ctx) return; if(this.running) return; this.running=true; this.nextNoteTime=this.ctx.currentTime+0.05; this.currentStep=0; this.timer=setInterval(()=>this._schedule(), 25); }
  stop(){ this.running=false; if(this.timer) clearInterval(this.timer), this.timer=null; }
  bpm(){ return this.baseTempo*(this.fever?1.16:1.0); }
  secPerBeat(){ return 60/this.bpm(); }
  _schedule(){ if(!this.ctx) return; while(this.nextNoteTime<this.ctx.currentTime+0.15){ this._scheduleStep(this.currentStep,this.nextNoteTime); const secPerBeat=this.secPerBeat(); this.nextNoteTime+= this.quantum*secPerBeat; this.currentStep=(this.currentStep+1)%16; } }
  _scheduleStep(step,t){ const lvl=this.comboLevel; if(this.patterns.hat[lvl][step]) this._hat(t); if(this.patterns.kick[lvl][step]) this._kick(t); if(this.patterns.snr[lvl][step]) this._snr(t); if(this.patterns.bass[lvl][step]) this._bass(t,step); }
  _hat(t){ const b=this.ctx.createBuffer(1,(this.ctx.sampleRate*0.03)|0,this.ctx.sampleRate); const d=b.getChannelData(0); for(let i=0;i<d.length;i++) d[i]=(Math.random()*2-1); const s=this.ctx.createBufferSource(); s.buffer=b; const hp=this.ctx.createBiquadFilter(); hp.type='highpass'; hp.frequency.value=6000; const g=this.ctx.createGain(); g.gain.value=.0001; s.connect(hp).connect(g).connect(this.hatGain); s.start(t); g.gain.setValueAtTime(.0001,t); g.gain.linearRampToValueAtTime(.7,t+.002); g.gain.exponentialRampToValueAtTime(.0001,t+.06); this._midiPerc(42,t); }
  _kick(t){ const o=this.ctx.createOscillator(); o.type='sine'; const g=this.ctx.createGain(); g.gain.value=.0001; o.frequency.setValueAtTime(140,t); o.frequency.exponentialRampToValueAtTime(42,t+.12); o.connect(g).connect(this.kickGain); o.start(t); g.gain.setValueAtTime(.0001,t); g.gain.linearRampToValueAtTime(1.0,t+.005); g.gain.exponentialRampToValueAtTime(.0001,t+.18); o.stop(t+.2); this._midiPerc(36,t); }
  _snr(t){ const b=this.ctx.createBuffer(1,(this.ctx.sampleRate*0.18)|0,this.ctx.sampleRate); const d=b.getChannelData(0); for(let i=0;i<d.length;i++){ const env=1-i/d.length; d[i]=(Math.random()*2-1)*env; } const s=this.ctx.createBufferSource(); s.buffer=b; const bp=this.ctx.createBiquadFilter(); bp.type='bandpass'; bp.frequency.value=1800; bp.Q.value=.6; const g=this.ctx.createGain(); g.gain.value=.0001; s.connect(bp).connect(g).connect(this.snrGain); s.start(t); g.gain.setValueAtTime(.0001,t); g.gain.linearRampToValueAtTime(.9,t+.008); g.gain.exponentialRampToValueAtTime(.0001,t+.22); this._midiPerc(38,t); }
  _bass(t,step){ const o=this.ctx.createOscillator(); o.type='sawtooth'; const g=this.ctx.createGain(); g.gain.value=.0001; const f=this.ctx.createBiquadFilter(); f.type='lowpass'; f.frequency.value=360+(this.fever?140:0); const notes=[55,73.42,65.41]; const n=(step<8)?notes[0]:(step<12?notes[1]:notes[2]); o.frequency.setValueAtTime(n,t); o.connect(f).connect(g).connect(this.bassGain); o.start(t); g.gain.setValueAtTime(.0001,t); g.gain.linearRampToValueAtTime(.7,t+.02); g.gain.exponentialRampToValueAtTime(.0001,t+.28); o.stop(t+.32); this._midiNote(36, t, .28, 80, 2); }
  _midiPerc(note,t){ if(!this.midiOut) return; const ts=Math.round((t-this.ctx.currentTime)*1000); setTimeout(()=>{ this.midiOut.send([0x99, note, 0x64]); this.midiOut.send([0x89, note, 0x00], window.performance.now()+80); }, Math.max(0,ts)); }
  _midiNote(note,t,len=0.25,vel=90,ch=1){ if(!this.midiOut) return; const ts=Math.round((t-this.ctx.currentTime)*1000); setTimeout(()=>{ this.midiOut.send([0x90+(ch-1), note, vel]); this.midiOut.send([0x80+(ch-1), note, 0x00], window.performance.now()+len*1000); }, Math.max(0,ts)); }
  nextGridTime(sub=4){ const spb=60/this.bpm(); const q=1/sub; const now=this.ctx.currentTime; const phase = (now - this.nextNoteTime + 100*spb) % (q*spb); const t = now + (q*spb - phase); return t; }
  quantize(t, sub=4){ const spb=60/this.bpm(); const q=1/sub; const now = this.ctx.currentTime; const dt = t - now; const target = Math.round(dt/(q*spb))*(q*spb); return now + target; }
  trigger(type, payload={}){
    if(!this.ctx || !this.enabled) return;
    const now=this.ctx.currentTime; let when=now+.01;
    if(type==='place'){ when=this.nextGridTime(8); this._tick('click', when); }
    if(type==='clear'){ const n=payload.lines||1; when=this.nextGridTime(4); for(let i=0;i<n;i++){ this._tick('clear', when + i*0.04); } }
    if(type==='gameover'){ when=this.nextGridTime(4); this._tick('boom', when); }
  }
  _tick(kind,t){
    if(kind==='click'){ const o=this.ctx.createOscillator(); const g=this.ctx.createGain(); o.type='triangle'; o.frequency.setValueAtTime(660,t); g.gain.setValueAtTime(.0001,t); o.connect(g).connect(this.master); o.start(t); g.gain.linearRampToValueAtTime(.24,t+.005); g.gain.exponentialRampToValueAtTime(.0001,t+.12); o.stop(t+.14); this._midiPerc(37,t); }
    if(kind==='clear'){ const o=this.ctx.createOscillator(); const g=this.ctx.createGain(); o.type='square'; o.frequency.setValueAtTime(880,t); g.gain.setValueAtTime(.0001,t); o.connect(g).connect(this.master); o.start(t); g.gain.linearRampToValueAtTime(.32,t+.01); g.gain.exponentialRampToValueAtTime(.0001,t+.22); o.stop(t+.24); this._midiPerc(39,t); }
    if(kind==='boom'){ const b=this.ctx.createBuffer(1,(this.ctx.sampleRate*0.5)|0,this.ctx.sampleRate); const d=b.getChannelData(0); for(let i=0;i<d.length;i++){ const env=1-i/d.length; d[i]=(Math.random()*2-1)*env; } const s=this.ctx.createBufferSource(); s.buffer=b; const g=this.ctx.createGain(); g.gain.value=.0001; s.connect(g).connect(this.master); s.start(t); g.gain.setValueAtTime(.0001,t); g.gain.linearRampToValueAtTime(1.0,t+.02); g.gain.exponentialRampToValueAtTime(.0001,t+.6); }
  }
}
const audio = new AudioEngine(bus);

/* ====== 教學模式（慢速自動放置） ====== */
state.tutorial={ active:false, busy:false, timer:null };
function startTutorial(){ if(state.tutorial.active) return; state.tutorial.active=true; state.tutorial.busy=false; toast("教學模式：系統將自動示範放置","#cfe"); scheduleTutorialStep(); renderHUD(); }
function stopTutorial(){ if(!state.tutorial.active) return; state.tutorial.active=false; state.tutorial.busy=false; if(state.tutorial.timer) clearTimeout(state.tutorial.timer), state.tutorial.timer=null; clearGhost(); clearHighlight(); toast("已退出教學模式","#ffd08a"); renderHUD(); }
function scheduleTutorialStep(){ if(!state.tutorial.active || state.gameOver || drag) return; if(state.usedThisSet>=3){ refillTrayFair(); } const b=bestPlacement(); if(!b){ endGame(); return; } tutorialPlace(b); }
function animateProxyTo(el,x,y,ms,easing){ return new Promise(res=>{ el.style.transition=`transform ${ms}ms ${easing}`; requestAnimationFrame(()=>{ el.style.transform=`translate(${x}px,${y}px) scale(${el.dataset.scale})`; }); setTimeout(()=>{ el.style.transition=''; res(); }, ms+30); }); }
async function tutorialPlace(best){
  if(state.tutorial.busy) return; state.tutorial.busy=true;
  clearGhost();
  best.p.cells.forEach(([dx,dy])=>{ const rr=cellRectRel(best.x+dx, best.y+dy); if(!rr) return; const g=document.createElement("div"); g.className="ghost-cell"; g.style.left=px(rr.left); g.style.top=px(rr.top); g.style.width=px(rr.width); g.style.height=px(rr.height); ghostEl.appendChild(g); });
  const slot=document.querySelector(`.slot[data-index="${best.idx}"]`); const fromEl=slot?.querySelector('.piece'); if(!fromEl){ state.tutorial.busy=false; return; }
  const proxy=fromEl.cloneNode(true); proxy.className="guide-proxy"; document.body.appendChild(proxy);
  const trayCell=parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--tray-cell'))||30; const gap=parseFloat(getComputedStyle(fromEl).gap)||4; const naturalW=best.p.w*trayCell+(best.p.w-1)*gap; const bboxW=fromEl.getBoundingClientRect().width; const scale=parseFloat(fromEl.dataset.scale)||(bboxW/naturalW); proxy.dataset.scale=scale;
  const mini=fromEl.querySelector('.cell-mini'); const r0=mini.getBoundingClientRect(); proxy.style.transform=`translate(${r0.left}px, ${r0.top}px) scale(${scale})`;
  const targetRect=cellAt(best.x,best.y).getBoundingClientRect();
  await animateProxyTo(proxy, targetRect.left, r0.top, 180, 'cubic-bezier(.22,.61,.36,1)');
  await animateProxyTo(proxy, targetRect.left, targetRect.top, 360, 'cubic-bezier(.16,.84,.23,1)');
  proxy.remove(); commitPlacement(best.p,best.idx,best.x,best.y); clearGhost();
  state.tutorial.busy=false;
  if(state.tutorial.active){ state.tutorial.timer=setTimeout(scheduleTutorialStep, 420); }
}

/* ====== 控制/按鈕 ====== */
$("#btn-new").addEventListener("click", newGame);
$("#btn-again").addEventListener("click", newGame);
$("#btn-close").addEventListener("click", ()=> $("#overlayGameOver").classList.remove("show"));

$("#btn-undo").addEventListener("click", ()=>{
  if(!state.history.length||state.undoCharges<=0) return;
  const prev=state.history.pop(); state.undoCharges--;
  state.board=prev.board; state.score=prev.score; state.tray=prev.tray; state.usedThisSet=prev.usedThisSet; state.streak=prev.streak; state.hold=prev.hold; state.fever=prev.fever; state.stats=prev.stats;
  renderBoard(); renderTray(); renderHUD(); saveState();
});

$("#btn-settings").addEventListener("click", ()=> $("#overlaySettings").classList.add("show"));
$("#btn-close-settings").addEventListener("click", ()=>{
  $("#overlaySettings").classList.remove("show");
  state.settings.reduce=$("#opt-reduce")?.checked ?? state.settings.reduce;
  state.settings.colorblind=$("#opt-colorblind")?.checked ?? state.settings.colorblind;
  state.settings.contrast=$("#opt-contrast")?.checked ?? state.settings.contrast;
  state.settings.haptics=$("#opt-haptics")?.checked ?? state.settings.haptics;
  state.settings.audio=$("#opt-audio")?.checked ?? state.settings.audio;
  state.settings.midi=$("#opt-midi")?.checked ?? state.settings.midi;
  state.settings.tapPlace=$("#opt-tap")?.checked ?? state.settings.tapPlace; // 若 UI 有此選項
  saveSettings(); renderTray();
  audio.setEnabled(state.settings.audio);
  if(state.settings.midi && audio.midi && !audio.midiOut){ const outs=[...audio.midi.outputs.values()]; if(outs.length) audio.midiOut=outs[0]; }
});

$("#btn-hold").addEventListener("click", ()=>{ state.awaitingHold = !state.awaitingHold; toast(state.awaitingHold ? "點托盤任一方塊以暫存／交換" : "已退出暫存模式", state.awaitingHold?"#cfe":"#ffd08a"); });
$("#btn-shuffle").addEventListener("click", ()=>{ if(!spendStars(1)) return; refillTrayFair(); state.lastActionAt=Date.now(); toast("托盤已重抽","#cfe"); });
$("#btn-hammer").addEventListener("click", ()=>{ if(state.tools.hammer){ state.tools.hammer=false; boardEl.classList.remove("hammer-cursor"); return; } if(state.stars<=0){ toast("⭐ 不足","#ffd1d1"); return; } state.tools.hammer=true; boardEl.classList.add("hammer-cursor"); toast("點選任一格進行清除","#ffe49a"); });

/* 錘子點擊：嚴格 → 失敗再磁吸（與拖曳一致） */
boardEl.addEventListener("click",(e)=>{
  if(!state.tools.hammer) return;
  let hit = hitCellStrict(e.clientX,e.clientY);
  if(hit.gx<0||hit.gy<0) hit = hitCellMagnet(e.clientX,e.clientY);
  if(hit.gx<0||hit.gy<0){
    state.tools.hammer=false; boardEl.classList.remove("hammer-cursor");
    return;
  }
  if(!state.board[hit.gy][hit.gx]){ toast("該格為空","#ffd1d1"); return; }
  if(!spendStars(1)) return;
  state.board[hit.gy][hit.gx]=null; renderBoard(); saveState();
  state.tools.hammer=false; boardEl.classList.remove("hammer-cursor");
  state.stats.hammer++; toast("已清除 1 格","#cfe");
});

$("#btn-hint").addEventListener("click", showHint);
$("#btn-daily").addEventListener("click", ()=>{ const todaySeed=Number(new Date().toISOString().slice(0,10).replace(/-/g,'')); RNG.useSeed(todaySeed); state.mode='daily'; newGame(); toast("每日挑戰開始","#cfe"); });
$("#btn-pass").addEventListener("click", ()=>{ RNG.useSystem(); state.mode='classic'; newGame(); toast("經典模式","#cfe"); });
$("#btn-share").addEventListener("click", async ()=>{
  const data={ title:"Block Blast — Flow+ 版", text:`我在 Flow+ 版拿到 ${state.score} 分！` };
  try{ if(navigator.share){ await navigator.share(data); } else { await navigator.clipboard.writeText(`${data.title}\n${data.text}`); toast("已複製分享文字","#cfe"); } }catch{ toast("分享已取消","#ffd08a"); }
});
$("#btn-share-img").addEventListener("click", ()=> sharePoster());
$("#btn-mission").addEventListener("click", ()=>{ missionsEnsureFresh(); renderMissionsUI(); $("#overlayMission").classList.add("show"); });
$("#btn-close-mission").addEventListener("click", ()=> $("#overlayMission").classList.remove("show"));
$("#btn-tutorial").addEventListener("click", ()=>{ state.tutorial.active ? stopTutorial() : startTutorial(); });

addEventListener('keydown',(e)=>{
  if(e.key==='n'||e.key==='N') newGame();
  if(e.key==='u'||e.key==='U') $("#btn-undo").click();
  if(e.key==='h'||e.key==='H') showHint();
  if(e.key==='1'||e.key==='2'||e.key==='3'){
    const i=Number(e.key)-1; const slot=document.querySelector(`.slot[data-index="${i}"] .piece`);
    if(slot && !state.tutorial.active && !state.settings.tapPlace){
      slot.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true, clientX:innerWidth/2, clientY:innerHeight/2}));
    }
  }
  if(e.key==='Escape'){ clearGhost(); clearHighlight(); clearHint(); boardEl.classList.remove("hammer-cursor"); state.tools.hammer=false; state.awaitingHold=false; clearTapSelect(); stopTutorial(); }
});

/* 點一下解鎖 AudioContext */
addEventListener('pointerdown', ()=>{ if(state.settings.audio) audio.resume(); }, { once:true });

/* ====== 新局 / 結束 ====== */
function saveState(){
  const data={ board:state.board, tray:state.tray, usedThisSet:state.usedThisSet, score:state.score, best:state.best, stars:state.stars, hold:state.hold, fever:state.fever, undoCharges:state.undoCharges, mode:state.mode, stats:state.stats };
  try{ localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); }catch{}
}
function loadState(){
  try{
    const raw=localStorage.getItem(STORAGE_KEY); if(!raw) return false;
    const d=JSON.parse(raw);
    state.board=(d.board&&Array.isArray(d.board)&&d.board.length===SIZE)?d.board:emptyBoard();
    state.tray=Array.isArray(d.tray)?d.tray.map(p=>(p&&p.cells&&p.w)?p:null):[null,null,null];
    state.usedThisSet=d.usedThisSet||0;
    state.score=d.score||0; state.best=typeof d.best==='number'?d.best:state.best;
    state.stars=d.stars||0; state.hold=d.hold||null;
    state.fever=d.fever||{meter:0,active:false,until:0};
    state.undoCharges=d.undoCharges??3; state.mode=d.mode||'classic';
    state.stats=d.stats||state.stats;
    localStorage.setItem(BEST_KEY, String(state.best||0));
    return true;
  }catch{ return false; }
}
function newGame(){
  if(state.settings.audio) audio.resume();
  clearTapSelect();
  state.board=emptyBoard(); state.score=0; state.tray=[null,null,null]; state.usedThisSet=0; state.history=[]; state.gameOver=false;
  setCombo(0); setFeverMeter(0); document.body.classList.remove("is-fever"); state.undoCharges=3;
  clearGhost(); clearHighlight(); clearHint(); state.tools.hammer=false; state.awaitingHold=false;
  state.stats={ placed:0, lines:0, sessionScore:0, feverTriggers:0, starsGain:0, hammer:0, games:state.stats.games, maxCombo:0 };
  refillTrayFair(); renderBoard(); renderTray(); renderHUD(); saveState(); state.lastActionAt=Date.now();
}
function endGame(){
  state.gameOver=true; $("#finalScore").textContent=state.score; $("#overlayGameOver").classList.add("show"); state.stats.games++; announce(`遊戲結束。本局 ${state.score} 分。`);
  bus.emit('gameover');
}

/* ====== 直/橫向自動排版（橫向 70%：左右各 35%） ====== */
function updateVHVar(){ const vh=(visualViewport?visualViewport.height:innerHeight)*0.01; document.documentElement.style.setProperty('--vh', `${vh}px`); }
function setSizes(S){ const root=document.documentElement.style; const trayCell=Math.max(22, Math.min(40, Math.round(S/13))); root.setProperty('--board-size', `${Math.round(S)}px`); root.setProperty('--tray-cell', `${trayCell}px`); root.setProperty('--gap', `${Math.max(4, Math.round(S/120))}px`); root.setProperty('--tile-radius', `${Math.max(6, Math.round(S/70))}px`); requestAnimationFrame(fitTrayPieces); }
function measurePortraitTotal(S){ setSizes(S); positionOverlayLayers(); const app=$(".app"); const header=$("header").offsetHeight; const board=$("#board").offsetHeight; const hold=$(".hold-row").offsetHeight; const tray=$("#tray").offsetHeight; const cs=getComputedStyle(app); const padTop=parseFloat(cs.paddingTop)||0, padBot=parseFloat(cs.paddingBottom)||0, rowGap=parseFloat(cs.rowGap)||10; return header+board+hold+tray+(rowGap*3)+padTop+padBot; }
function fitPortraitTight(){ const vw=innerWidth, vh=(visualViewport?visualViewport.height:innerHeight); let lo=240, hi=Math.floor(Math.min(vw*0.94, vh)), best=lo; let test=Math.floor(Math.min(vw*0.94, vh*0.82, 720)); if(measurePortraitTotal(test)<=vh) best=test, lo=test; for(let i=0;i<14;i++){ const mid=Math.floor((lo+hi)/2); if(mid<=240){best=240;break;} const sum=measurePortraitTotal(mid); if(sum<=vh){ best=mid; lo=mid+1; } else { hi=mid-1; } } setSizes(best); positionOverlayLayers(); }
function fitLandscape(){ const vw=innerWidth, vh=(visualViewport?visualViewport.height:innerHeight); const SmaxByH=Math.min(860, vh*0.90); const side=Math.max(320, Math.floor(vw*0.35)); const S=Math.max(260, Math.min(SmaxByH, side)); document.documentElement.style.setProperty('--side-w', side+'px'); setSizes(S); positionOverlayLayers(); }
const fitLayout = (()=>{ let p=0; return ()=>{ if(p) return; p=requestAnimationFrame(()=>{ p=0; updateVHVar(); const vw=innerWidth, vh=(visualViewport?visualViewport.height:innerHeight); (vw>=900 && vw/vh>=1.25)?fitLandscape():fitPortraitTight(); }); }; })();
addEventListener('resize',fitLayout,{passive:true});
addEventListener('orientationchange',fitLayout,{passive:true});
if(visualViewport){ visualViewport.addEventListener('resize',fitLayout,{passive:true}); visualViewport.addEventListener('scroll',fitLayout,{passive:true}); }
if(document.fonts && document.fonts.ready) document.fonts.ready.then(fitLayout);
fitLayout();

/* ====== FPS 動態降噪（<45fps 降低陰影/亮片） ====== */
(function fpsDenoise(){
  const samples=[]; let last=performance.now();
  function loop(t){
    const dt=t-last; last=t;
    const fps=1000/dt; samples.push(fps); if(samples.length>60) samples.shift();
    const avg=samples.reduce((a,b)=>a+b,0)/samples.length;
    if(avg<45) document.body.classList.add('lowfx'); else if(avg>52) document.body.classList.remove('lowfx');
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
})();

/* ====== 啟動 ====== */
function missionsInit(){ missionsLoad(); }
missionsInit();
const loaded=loadState(); if(!loaded) refillTrayFair();
renderBoard(); renderTray(); renderHUD();
audio.setEnabled(state.settings.audio);

/* 閒置自動提示 */
setInterval(()=>{ if(state.settings.hint && !state.gameOver && !drag && !tapSel && !state.hintShown && Date.now()-state.lastActionAt>8000){ showHint(); } }, 1000);