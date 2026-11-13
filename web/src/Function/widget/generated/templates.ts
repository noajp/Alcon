import type { AppSource } from './model';
import { summaryApp } from './summaryApp';

// Canvases that need no AI: known code a person picks to start from. Each is
// an ordinary app source, so asking AI to revise one afterwards works the
// same as revising a generated one. Their few words are English or Japanese,
// by the browser's language (an app cannot reach the host's translations).

const BASE_CSS = '.bar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:12px;font-size:12px;color:var(--muted-foreground)}.bar .grow{flex:1}button{background:transparent;color:var(--foreground)}button[aria-pressed=true]{background:var(--muted)}select{border:1px solid var(--border);border-radius:var(--control-field-radius,6px);background:var(--background);color:var(--foreground);padding:4px 8px;font-size:12px;min-height:28px}.empty{padding:24px 0;text-align:center;font-size:12px;color:var(--muted-foreground)}text{fill:var(--muted-foreground);font-size:11px}';

const SHARED_JS = String.raw`const JA=(navigator.language||'').toLowerCase().startsWith('ja');
const L=(en,ja)=>JA?ja:en;
const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
const NS='http://www.w3.org/2000/svg';
const svg=(tag,attrs)=>{const n=document.createElementNS(NS,tag);for(const k in attrs)n.setAttribute(k,attrs[k]);return n;};
const TONES=['var(--accent-default,var(--primary))','color-mix(in oklab,var(--status-danger) 72%,var(--background))','color-mix(in oklab,var(--accent-default,var(--primary)) 55%,var(--background))','var(--muted-foreground)','color-mix(in oklab,var(--accent-default,var(--primary)) 30%,var(--background))','color-mix(in oklab,var(--status-danger) 40%,var(--background))','color-mix(in oklab,var(--muted-foreground) 45%,var(--background))'];
const tone=i=>TONES[i%TONES.length];
const today=()=>{const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');};
const tally=(rows,key)=>{const m=new Map();for(const r of rows){const k=key(r)||L('None','なし');m.set(k,(m.get(k)||0)+1);}return [...m.entries()].sort((a,b)=>b[1]-a[1]);};
function bars(rows,width){
 const h=rows.length*28+4;const max=Math.max(1,...rows.map(r=>r[1]));const s=svg('svg',{viewBox:'0 0 '+width+' '+h,width:'100%'});
 rows.forEach((r,i)=>{const y=i*28+4;const w=Math.max(2,(width-190)*r[1]/max);
  const name=svg('text',{x:0,y:y+14});name.textContent=String(r[0]).slice(0,18);s.append(name);
  s.append(svg('rect',{x:130,y:y+2,width:w,height:16,rx:3,style:'fill:'+tone(i)}));
  const v=svg('text',{x:136+w,y:y+14});v.textContent=String(r[1]);s.append(v);});
 return s;
}
function donut(rows,size){
 const total=rows.reduce((a,r)=>a+r[1],0)||1;const r=size/2-10;const c=2*Math.PI*r;const s=svg('svg',{viewBox:'0 0 '+size+' '+size,width:size,height:size});
 let off=0;rows.forEach((row,i)=>{const len=c*row[1]/total;
  s.append(svg('circle',{cx:size/2,cy:size/2,r:r,fill:'none','stroke-width':16,style:'stroke:'+tone(i),'stroke-dasharray':len+' '+(c-len),'stroke-dashoffset':-off,transform:'rotate(-90 '+size/2+' '+size/2+')'}));off+=len;});
 const t=svg('text',{x:size/2,y:size/2+6,'text-anchor':'middle',style:'font-size:20px;font-weight:600;fill:var(--foreground)'});t.textContent=String(total===1&&!rows.length?0:rows.reduce((a,r)=>a+r[1],0));s.append(t);
 return s;
}
function legend(rows){const box=el('div','legend');rows.forEach((r,i)=>{const row=el('div','lg');const dot=el('span','dot');dot.style.background=tone(i);row.append(dot,el('span','',String(r[0])),el('b','',String(r[1])));box.append(row);});return box;}
`;

const LEGEND_CSS = '.legend{display:grid;gap:4px;font-size:12px;min-width:140px}.lg{display:flex;align-items:center;gap:6px;color:var(--muted-foreground)}.lg b{margin-left:auto;color:var(--foreground);font-weight:600}.dot{width:8px;height:8px;border-radius:2px;flex-shrink:0}';

/** Where the Object stands: counts, Status and priority, what is due next. */
const dashboardApp: AppSource = {
  title: 'Dashboard', usesObjectData: true,
  html: '<div class="bar"><span id="stamp" role="status"></span><span class="grow"></span><button id="refresh" type="button">↻</button></div><div id="root"></div>',
  css: BASE_CSS + LEGEND_CSS + '.kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}.kpi{padding:10px 12px;border:1px solid var(--border);border-radius:8px}.kpi b{display:block;font-size:22px;font-weight:600}.kpi span{font-size:11.5px;color:var(--muted-foreground)}.meter{height:6px;border-radius:3px;background:var(--muted);margin:14px 0 4px;overflow:hidden}.meter i{display:block;height:100%;background:var(--accent-default,var(--primary))}.cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:20px;margin-top:8px}h3{font-size:12px;font-weight:500;color:var(--muted-foreground);margin:14px 0 8px}.split{display:flex;align-items:center;gap:16px}.due{display:flex;gap:8px;padding:6px 0;border-bottom:1px solid var(--border);font-size:12px}.due span:first-child{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.due .late{color:var(--status-danger,inherit)}',
  js: SHARED_JS + String.raw`const root=document.getElementById('root');const stamp=document.getElementById('stamp');const refresh=document.getElementById('refresh');
async function load(){
 refresh.disabled=true;
 try{
  const data=await clayware.readContext();const all=data.elements;const t=today();
  const done=all.filter(e=>e.status==='done');const open=all.filter(e=>e.status!=='done'&&e.status!=='cancelled');
  const late=open.filter(e=>e.due_date&&e.due_date<t);
  root.replaceChildren();
  if(!all.length){root.append(el('p','empty',L('This Object has no Elements yet.','この Object にはまだ Element がありません。')));}
  else{
   const kpis=el('div','kpis');
   for(const [label,value] of [[L('Elements','Element'),all.length],[L('Done','完了'),done.length],[L('Open','未完了'),open.length],[L('Overdue','期限超過'),late.length]]){const k=el('div','kpi');k.append(el('b','',String(value)),el('span','',label));kpis.append(k);}
   const meter=el('div','meter');const fill=el('i');fill.style.width=Math.round(100*done.length/all.length)+'%';meter.append(fill);
   const cols=el('div','cols');
   const a=el('div');a.append(el('h3','',L('By Status','ステータス別')));const st=tally(all,e=>e.status);const split=el('div','split');split.append(donut(st,132),legend(st));a.append(split);
   const b=el('div');b.append(el('h3','',L('By priority','優先度別')),bars(tally(all,e=>e.priority),360));
   const c=el('div');c.append(el('h3','',L('Due next','次の期限')));
   const next=open.filter(e=>e.due_date).sort((x,y)=>x.due_date.localeCompare(y.due_date)).slice(0,6);
   if(!next.length)c.append(el('p','empty',L('Nothing has a due date.','期限のあるものはありません。')));
   for(const e of next){const row=el('div','due');row.append(el('span','',e.title),el('span',e.due_date<t?'late':'',e.due_date.slice(5).replace('-','/')));c.append(row);}
   cols.append(a,b,c);root.append(kpis,meter,cols);
  }
  stamp.textContent=new Date(data.fetchedAt).toLocaleString();
 }catch(e){root.replaceChildren(el('p','empty',String(e.message||e)));stamp.textContent='';}
 finally{refresh.disabled=false;}
}
refresh.addEventListener('click',load);await load();`,
};

/** One chart of the Object's Elements: pick what to count by and its shape. */
const chartApp: AppSource = {
  title: 'Chart', usesObjectData: true,
  html: '<div class="bar"><select id="by" aria-label="Group by"></select><select id="shape" aria-label="Chart type"></select><span class="grow"></span><span id="stamp" role="status"></span><button id="refresh" type="button">↻</button></div><div id="root"></div>',
  css: BASE_CSS + LEGEND_CSS + '.split{display:flex;align-items:center;gap:24px;flex-wrap:wrap}',
  js: SHARED_JS + String.raw`const root=document.getElementById('root');const stamp=document.getElementById('stamp');const refresh=document.getElementById('refresh');
const by=document.getElementById('by');const shape=document.getElementById('shape');
const AXES=[['status',L('Status','ステータス')],['priority',L('Priority','優先度')],['phase',L('Phase','Phase')],['due',L('Due month','期限の月')]];
const SHAPES=[['bar',L('Bars','棒')],['donut',L('Donut','ドーナツ')],['line',L('Line','折れ線')]];
for(const [v,l] of AXES){const o=el('option','',l);o.value=v;by.append(o);}
for(const [v,l] of SHAPES){const o=el('option','',l);o.value=v;shape.append(o);}
let data=null;
const pick=()=>{by.value=AXES.some(a=>a[0]===clayware.state.chartBy)?clayware.state.chartBy:'status';shape.value=SHAPES.some(a=>a[0]===clayware.state.chartShape)?clayware.state.chartShape:'bar';};
function lineChart(rows,width){
 const h=200;const max=Math.max(1,...rows.map(r=>r[1]));const s=svg('svg',{viewBox:'0 0 '+width+' '+h,width:'100%'});
 const step=rows.length>1?(width-40)/(rows.length-1):0;const pts=rows.map((r,i)=>[20+i*step,h-30-(h-50)*r[1]/max]);
 s.append(svg('line',{x1:20,y1:h-30,x2:width-20,y2:h-30,style:'stroke:var(--border)'}));
 s.append(svg('polyline',{points:pts.map(p=>p.join(',')).join(' '),fill:'none','stroke-width':2,style:'stroke:'+tone(0)}));
 pts.forEach((p,i)=>{s.append(svg('circle',{cx:p[0],cy:p[1],r:3,style:'fill:'+tone(0)}));const t=svg('text',{x:p[0],y:h-12,'text-anchor':'middle'});t.textContent=String(rows[i][0]).slice(0,10);s.append(t);const v=svg('text',{x:p[0],y:p[1]-8,'text-anchor':'middle'});v.textContent=String(rows[i][1]);s.append(v);});
 return s;
}
function draw(){
 if(!data)return;root.replaceChildren();
 const phases=new Map(data.phases.map(p=>[p.id,p.name]));
 const key={status:e=>e.status,priority:e=>e.priority,phase:e=>phases.get(e.phase_id),due:e=>e.due_date?e.due_date.slice(0,7):''}[by.value];
 let rows=tally(data.elements,key);
 if(by.value==='due')rows=rows.sort((a,b)=>String(a[0]).localeCompare(String(b[0])));
 if(!rows.length){root.append(el('p','empty',L('This Object has no Elements yet.','この Object にはまだ Element がありません。')));return;}
 if(shape.value==='donut'){const split=el('div','split');split.append(donut(rows,180),legend(rows));root.append(split);}
 else if(shape.value==='line')root.append(lineChart(rows,640));
 else root.append(bars(rows,640));
}
async function load(){refresh.disabled=true;try{data=await clayware.readContext();stamp.textContent=new Date(data.fetchedAt).toLocaleString();draw();}catch(e){data=null;root.replaceChildren(el('p','empty',String(e.message||e)));stamp.textContent='';}finally{refresh.disabled=false;}}
const changed=async()=>{draw();try{await clayware.save({...clayware.state,chartBy:by.value,chartShape:shape.value});}catch(e){stamp.textContent=String(e.message||e);}};
by.addEventListener('change',changed);shape.addEventListener('change',changed);
clayware.onChange(()=>{pick();draw();});
refresh.addEventListener('click',load);pick();await load();`,
};

/** A whiteboard: notes and shapes to place, drag, write in and join with arrows. */
const whiteboardApp: AppSource = {
  title: 'Whiteboard',
  html: '<div class="bar"><button id="add-note" type="button"></button><button id="add-rect" type="button"></button><button id="add-ellipse" type="button"></button><button id="add-diamond" type="button"></button><button id="link" type="button" aria-pressed="false"></button><span id="swatches"></span><span id="hint" role="status"></span><button id="remove" type="button" disabled></button></div><div id="board"><svg id="wires"><defs><marker id="tip" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 10 5 0 10z"></path></marker></defs></svg></div>',
  css: BASE_CSS + '#hint{flex:1;min-width:0;text-align:right;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.bar{flex-wrap:nowrap}#board{--edge:color-mix(in oklab,var(--muted-foreground) 65%,transparent);position:relative;height:560px;border:1px solid var(--border);border-radius:8px;overflow:hidden;touch-action:none;background-image:radial-gradient(color-mix(in oklab,var(--muted-foreground) 28%,transparent) 1px,transparent 1px);background-size:20px 20px}#wires{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}#wires line{stroke:var(--muted-foreground);stroke-width:1.5}#wires line.on{stroke:var(--accent-default,var(--primary));stroke-width:2.5}#wires path{fill:var(--muted-foreground)}.hit{position:absolute;height:14px;transform-origin:0 50%;cursor:pointer}.node{position:absolute;display:flex;align-items:center;justify-content:center;padding:8px;font-size:12.5px;line-height:1.4;text-align:center;cursor:grab;user-select:none;border:1px solid var(--edge);background:var(--background);color:var(--foreground);overflow:hidden;word-break:break-word}.node.note{align-items:flex-start;justify-content:flex-start;text-align:left;border-color:transparent;border-radius:3px;box-shadow:var(--shadow-card)}.node.rect{border-radius:6px}.node.ellipse{border-radius:50%}.node.diamond{border:0;background:transparent}.node.diamond i{position:absolute;inset:14%;transform:rotate(45deg);border:1px solid var(--edge);background:var(--background)}.node.diamond span{position:relative}.node.sel{outline:2px solid var(--accent-default,var(--primary));outline-offset:2px}.node [contenteditable=true]{cursor:text;user-select:text;outline:none}.sw{display:inline-block;width:16px;height:16px;border-radius:50%;border:1px solid var(--border);margin-right:4px;cursor:pointer;vertical-align:middle}',
  js: SHARED_JS + String.raw`const board=document.getElementById('board');const wires=document.getElementById('wires');const hint=document.getElementById('hint');
const link=document.getElementById('link');const removeBtn=document.getElementById('remove');const swatches=document.getElementById('swatches');
document.getElementById('add-note').textContent=L('+ Note','+ 付箋');document.getElementById('add-rect').textContent=L('+ Box','+ 四角');
document.getElementById('add-ellipse').textContent=L('+ Ellipse','+ 楕円');document.getElementById('add-diamond').textContent=L('+ Diamond','+ ひし形');
link.textContent=L('Connect','つなぐ');removeBtn.textContent=L('Delete','削除');
const HUES=[null,48,140,205,275,350];
const fill=h=>h===null||h===undefined?'var(--background)':'color-mix(in oklab,hsl('+h+' 85% 60%) 34%,var(--background))';
const SIZE={note:[150,110],rect:[150,70],ellipse:[140,80],diamond:[130,130]};
let selected=null;let from=null;let linking=false;let drag=null;let editing=null;
const nodes=()=>Object.entries(clayware.state).filter(([k,v])=>k.startsWith('n_')&&v&&typeof v==='object');
const edges=()=>Object.entries(clayware.state).filter(([k,v])=>k.startsWith('e_')&&v&&typeof v==='object');
const say=text=>{hint.textContent=text||'';};
async function commit(next){try{await clayware.save(next);say('');}catch(e){say(L('Could not save: ','保存できませんでした：')+(e.message||e));}render();}
function edgePoint(a,b){
 const cx=a.x+a.w/2,cy=a.y+a.h/2,dx=b.x+b.w/2-cx,dy=b.y+b.h/2-cy;if(!dx&&!dy)return [cx,cy];
 const s=a.kind==='ellipse'?1/Math.hypot(dx/(a.w/2),dy/(a.h/2)):a.kind==='diamond'?1/(Math.abs(dx)/(a.w/2)+Math.abs(dy)/(a.h/2)):Math.min(Math.abs(a.w/2/(dx||1e-9)),Math.abs(a.h/2/(dy||1e-9)));
 return [cx+dx*s,cy+dy*s];
}
function drawWires(){
 for(const n of [...wires.querySelectorAll('line')])n.remove();for(const n of [...board.querySelectorAll('.hit')])n.remove();
 const map=new Map(nodes());
 for(const [id,e] of edges()){const a=map.get(e.a),b=map.get(e.b);if(!a||!b)continue;
  const p=edgePoint(a,b),q=edgePoint(b,a);
  const line=svg('line',{x1:p[0],y1:p[1],x2:q[0],y2:q[1],'marker-end':'url(#tip)'});if(selected===id)line.setAttribute('class','on');wires.append(line);
  const hit=el('div','hit');hit.style.left=p[0]+'px';hit.style.top=(p[1]-7)+'px';hit.style.width=Math.hypot(q[0]-p[0],q[1]-p[1])+'px';hit.style.transform='rotate('+Math.atan2(q[1]-p[1],q[0]-p[0])+'rad)';
  hit.addEventListener('pointerdown',ev=>{ev.stopPropagation();select(id);});board.insertBefore(hit,wires.nextSibling);}
}
function select(id){selected=id;removeBtn.disabled=!id;render();}
function render(){
 if(drag||editing)return;
 for(const n of [...board.querySelectorAll('.node')])n.remove();
 for(const [id,n] of nodes()){
  const box=el('div','node '+(n.kind||'note')+(selected===id?' sel':''));box.dataset.id=id;
  box.style.left=n.x+'px';box.style.top=n.y+'px';box.style.width=n.w+'px';box.style.height=n.h+'px';
  const text=el('span','',n.text||'');
  if(n.kind==='diamond'){const shape=el('i');shape.style.background=fill(n.hue);box.append(shape);}else box.style.background=fill(n.hue);
  box.append(text);board.append(box);
 }
 drawWires();
 swatches.replaceChildren();
 if(selected&&selected.startsWith('n_')&&clayware.state[selected])for(const h of HUES){const s=el('span','sw');s.style.background=fill(h);s.addEventListener('click',()=>commit({...clayware.state,[selected]:{...clayware.state[selected],hue:h}}));swatches.append(s);}
}
function add(kind){
 const id='n_'+Date.now().toString(36)+Math.random().toString(36).slice(2,6);const [w,h]=SIZE[kind];const count=nodes().length;
 const x=Math.min(board.clientWidth-w-10,24+(count%6)*28),y=Math.min(board.clientHeight-h-10,24+(count%6)*28);
 selected=id;removeBtn.disabled=false;
 commit({...clayware.state,[id]:{kind,x,y,w,h,text:'',hue:kind==='note'?48:null}});
}
for(const kind of ['note','rect','ellipse','diamond'])document.getElementById('add-'+kind).addEventListener('click',()=>add(kind));
link.addEventListener('click',()=>{linking=!linking;from=null;link.setAttribute('aria-pressed',String(linking));say(linking?L('Click one shape, then another.','つなぐ図形を順に2つクリックします。'):'');});
removeBtn.addEventListener('click',()=>{
 if(!selected)return;const next={...clayware.state};delete next[selected];
 if(selected.startsWith('n_'))for(const [id,e] of edges())if(e.a===selected||e.b===selected)delete next[id];
 selected=null;removeBtn.disabled=true;commit(next);
});
board.addEventListener('pointerdown',ev=>{
 const box=ev.target.closest('.node');
 if(editing){if(box&&box.dataset.id===editing)return;document.activeElement&&document.activeElement.blur();}
 if(!box){if(ev.target===board||ev.target===wires)select(null);return;}
 const id=box.dataset.id;
 if(linking){
  if(!from){from=id;select(id);say(L('Now click the shape it points to.','つなぐ先の図形をクリックします。'));}
  else if(from!==id){const key='e_'+from.slice(2)+'_'+id.slice(2);const a=from;from=null;linking=false;link.setAttribute('aria-pressed','false');commit({...clayware.state,[key]:{a,b:id}});}
  return;
 }
 const n=clayware.state[id];selected=id;removeBtn.disabled=false;
 for(const other of board.querySelectorAll('.node'))other.classList.toggle('sel',other===box);
 drag={id,box,dx:ev.clientX-n.x,dy:ev.clientY-n.y,x:n.x,y:n.y,moved:false};box.setPointerCapture(ev.pointerId);
});
board.addEventListener('pointermove',ev=>{
 if(!drag)return;const n=clayware.state[drag.id];
 drag.x=Math.max(0,Math.min(board.clientWidth-n.w,ev.clientX-drag.dx));drag.y=Math.max(0,Math.min(board.clientHeight-n.h,ev.clientY-drag.dy));
 if(Math.abs(drag.x-n.x)+Math.abs(drag.y-n.y)>2)drag.moved=true;
 drag.box.style.left=drag.x+'px';drag.box.style.top=drag.y+'px';
});
const drop=()=>{
 if(!drag)return;const d=drag;drag=null;
 if(d.moved)commit({...clayware.state,[d.id]:{...clayware.state[d.id],x:Math.round(d.x),y:Math.round(d.y)}});else render();
};
board.addEventListener('pointerup',drop);board.addEventListener('pointercancel',drop);
board.addEventListener('dblclick',ev=>{
 const box=ev.target.closest('.node');if(!box||linking)return;const id=box.dataset.id;const text=box.querySelector('span');
 editing=id;text.contentEditable='true';text.focus();document.getSelection().selectAllChildren(text);
 text.addEventListener('blur',()=>{editing=null;const value=text.textContent.slice(0,400);if(clayware.state[id]&&value!==(clayware.state[id].text||''))commit({...clayware.state,[id]:{...clayware.state[id],text:value}});else render();},{once:true});
 text.addEventListener('keydown',e=>{if(e.key==='Escape'||(e.key==='Enter'&&!e.shiftKey&&!e.isComposing)){e.preventDefault();text.blur();}});
});
clayware.onChange(()=>{if(selected&&!clayware.state[selected]){selected=null;removeBtn.disabled=true;}render();});
if(!nodes().length)say(L('Add a note or a shape. Double-click to write in it.','付箋や図形を追加します。ダブルクリックで文字を書けます。'));
render();`,
};

export interface CanvasTemplate { id: string; label: string; source: AppSource }

/** The canvases offered without AI, in the order shown. */
export const CANVAS_TEMPLATES: CanvasTemplate[] = [
  { id: 'dashboard', label: 'Dashboard', source: dashboardApp },
  { id: 'chart', label: 'Chart', source: chartApp },
  { id: 'whiteboard', label: 'Whiteboard', source: whiteboardApp },
  { id: 'summary', label: 'Summary', source: summaryApp },
];
