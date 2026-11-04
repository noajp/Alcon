import type { AppSource } from './model';

/** A ready-to-use starting app; all business content comes from readContext. */
export const summaryApp: AppSource = {
  title: 'Project summary', usesObjectData: true,
  html: '<div class="toolbar"><span id="context-status" role="status">Loading data…</span><button id="refresh" type="button">Refresh data</button></div><div id="summary"></div><label class="memo">Review notes<textarea id="memo" rows="2" placeholder="What to check next (shared with everyone on this Object)"></textarea></label><p id="save-status" role="status"></p>',
  css: '.toolbar{display:flex;align-items:center;justify-content:space-between;gap:12px;color:var(--muted-foreground);font-size:12px}button{border:1px solid var(--border);border-radius:var(--control-action-radius);padding:8px 10px;background:var(--muted);color:var(--foreground)}button:disabled{opacity:.5}.metrics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin:16px 0}.metric{padding:12px;background:var(--muted);border-radius:8px}.metric strong{display:block;font-size:24px}.metric span{font-size:12px;color:var(--muted-foreground)}h3{font-size:13px;margin:18px 0 8px}p{white-space:pre-wrap;font-size:12px;line-height:1.6}ul{padding:0;list-style:none;margin:0}li{padding:8px 0;border-bottom:1px solid var(--border);font-size:12px;line-height:1.6}.source{color:var(--muted-foreground);font-size:11px}.memo{display:block;margin-top:16px;font-size:12px}textarea{display:block;margin-top:6px;width:100%;padding:10px;border:1px solid var(--border);border-radius:var(--control-field-radius);background:var(--muted);color:var(--foreground);resize:vertical}',
  js: String.raw`const root=document.getElementById('summary');
const status=document.getElementById('context-status');
const refresh=document.getElementById('refresh');
const memo=document.getElementById('memo');
memo.value=typeof alcon.state.memo==='string'?alcon.state.memo:'';
alcon.onChange(state=>{if(document.activeElement!==memo)memo.value=typeof state.memo==='string'?state.memo:'';});
let timer;
memo.addEventListener('input',()=>{clearTimeout(timer);timer=setTimeout(async()=>{const output=document.getElementById('save-status');try{await alcon.save({...alcon.state,memo:memo.value});output.textContent='Notes saved';}catch(e){output.textContent='Could not save: '+e.message;}},400);});
function node(tag,text,cls){const el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(cls)el.className=cls;return el;}
function section(title,lines){root.append(node('h3',title));const list=node('ul');for(const line of lines)list.append(node('li',line));root.append(list);}
async function load(){
 refresh.disabled=true;root.replaceChildren();status.textContent='Loading data…';
 try{
  const data=await alcon.readContext();
  const now=new Date();const today=now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0')+'-'+String(now.getDate()).padStart(2,'0');
  const done=data.elements.filter(e=>e.status==='done');
  const open=data.elements.filter(e=>!['done','cancelled'].includes(e.status));
  const overdue=open.filter(e=>e.due_date&&e.due_date<today);
  const metrics=node('div',undefined,'metrics');
  for(const [label,value] of [['Done / All Elements',done.length+' / '+data.elements.length],['Overdue',overdue.length],['Related Strategies',data.initiatives.length]]){const card=node('div',undefined,'metric');card.append(node('strong',String(value)),node('span',label));metrics.append(card);}root.append(metrics);
  root.append(node('p',data.object.name+' · Due '+(data.object.due_date||'Not set')+' · '+(data.domains.map(d=>d.name).join(' / ')||'No visible Domains'),'source'));
  section('Strategy · Purpose and success criteria',data.initiatives.length?data.initiatives.map(i=>i.name+'\n'+(i.description||'No purpose described yet')):['No related Strategies are visible.']);
  if(data.intents.length)section('Intent · Decisions and measures',data.intents.map(i=>{const parent=data.initiatives.find(s=>s.id===i.strategy_id);return (parent?parent.name+' / ':'')+i.title+' ['+i.kind+']'+(i.superseded_by_intent_id?' (superseded)':'')+(i.kind==='measure'?' — Actual '+(i.actual_value===null?'Not measured':i.actual_value)+' / Target '+(i.target_value===null?'Not set':i.target_value)+' '+(i.unit||'')+' · '+(i.direction==='at_most'?'At most':i.direction==='at_least'?'At least':'Direction not set')+' · Measured '+(i.measured_at||'Not recorded'):'')+(i.subtitle?'\n'+i.subtitle:'');}));
  const ordered=[...open].sort((a,b)=>(a.due_date||'9999').localeCompare(b.due_date||'9999'));
  section('Execution · Elements to review next',ordered.length?ordered.slice(0,8).map(e=>(e.display_id||e.id)+' · '+e.title+'\n'+e.status+' · Due '+(e.due_date||'Not set')+(e.due_date&&e.due_date<today?' · Overdue':'')):['No open Elements.']);
  if(ordered.length>8)root.append(node('p','First 8 by due date / Open: '+ordered.length+'','source'));
  status.textContent='Fetched '+new Date(data.fetchedAt).toLocaleString();
  root.append(node('p','Summarized from records you can access. Review strategic measures separately from Element completion.','source'));
 }catch(e){root.replaceChildren();status.textContent='Could not fetch: '+e.message;}
 finally{refresh.disabled=false;}
}
refresh.addEventListener('click',load);await load();`,
};
