import type { AppSource } from './model';

/** A ready-to-use starting app; all business content comes from readContext. */
export const summaryApp: AppSource = {
  title: '案件サマリー', usesObjectData: true,
  html: '<div class="toolbar"><span id="context-status" role="status">データを取得しています…</span><button id="refresh" type="button">最新データに更新</button></div><div id="summary"></div><label class="memo">確認メモ<textarea id="memo" rows="2" placeholder="次に確認したいこと（自分だけに保存）"></textarea></label><p id="save-status" role="status"></p>',
  css: '.toolbar{display:flex;align-items:center;justify-content:space-between;gap:12px;color:var(--muted-foreground);font-size:12px}button{border:0;border-radius:6px;padding:8px 10px;background:var(--muted);color:var(--foreground)}button:disabled{opacity:.5}.metrics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin:16px 0}.metric{padding:12px;background:var(--muted);border-radius:8px}.metric strong{display:block;font-size:24px}.metric span{font-size:12px;color:var(--muted-foreground)}h3{font-size:13px;margin:18px 0 8px}p{white-space:pre-wrap;font-size:12px;line-height:1.6}ul{padding:0;list-style:none;margin:0}li{padding:8px 0;border-bottom:1px solid var(--border);font-size:12px;line-height:1.6}.source{color:var(--muted-foreground);font-size:11px}.memo{display:block;margin-top:16px;font-size:12px}textarea{display:block;margin-top:6px;width:100%;padding:10px;border:0;border-radius:6px;background:var(--muted);color:var(--foreground);resize:vertical}',
  js: String.raw`const root=document.getElementById('summary');
const status=document.getElementById('context-status');
const refresh=document.getElementById('refresh');
const memo=document.getElementById('memo');
memo.value=typeof alcon.state.memo==='string'?alcon.state.memo:'';
let timer;
memo.addEventListener('input',()=>{clearTimeout(timer);timer=setTimeout(async()=>{const output=document.getElementById('save-status');try{await alcon.save({...alcon.state,memo:memo.value});output.textContent='メモを保存しました';}catch(e){output.textContent='保存できませんでした: '+e.message;}},400);});
function node(tag,text,cls){const el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(cls)el.className=cls;return el;}
function section(title,lines){root.append(node('h3',title));const list=node('ul');for(const line of lines)list.append(node('li',line));root.append(list);}
async function load(){
 refresh.disabled=true;root.replaceChildren();status.textContent='データを取得しています…';
 try{
  const data=await alcon.readContext();
  const now=new Date();const today=now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0')+'-'+String(now.getDate()).padStart(2,'0');
  const done=data.elements.filter(e=>e.status==='done');
  const open=data.elements.filter(e=>!['done','cancelled'].includes(e.status));
  const overdue=open.filter(e=>e.due_date&&e.due_date<today);
  const metrics=node('div',undefined,'metrics');
  for(const [label,value] of [['完了 / 全Elements',done.length+' / '+data.elements.length],['期限超過',overdue.length],['関連Initiatives',data.initiatives.length]]){const card=node('div',undefined,'metric');card.append(node('strong',String(value)),node('span',label));metrics.append(card);}root.append(metrics);
  root.append(node('p',data.object.name+' · 期限 '+(data.object.due_date||'未設定')+' · '+(data.domains.map(d=>d.name).join(' / ')||'閲覧可能なDomainなし'),'source'));
  section('Strategy · 目的と成功条件',data.initiatives.length?data.initiatives.map(i=>i.name+'\n'+(i.description||'目的の記述はまだありません')):['関連する閲覧可能なInitiativeはありません。']);
  if(data.intents.length)section('Intent · 判断・指標',data.intents.map(i=>{const parent=data.initiatives.find(s=>s.id===i.strategy_id);return (parent?parent.name+' / ':'')+i.title+' ['+i.kind+']'+(i.superseded_by_intent_id?'（置き換え済み）':'')+(i.kind==='measure'?' — 実績 '+(i.actual_value===null?'未測定':i.actual_value)+' / 目標 '+(i.target_value===null?'未設定':i.target_value)+' '+(i.unit||'')+' · '+(i.direction==='at_most'?'以下':i.direction==='at_least'?'以上':'判定方向未設定')+' · 測定 '+(i.measured_at||'未記録'):'')+(i.subtitle?'\n'+i.subtitle:'');}));
  const ordered=[...open].sort((a,b)=>(a.due_date||'9999').localeCompare(b.due_date||'9999'));
  section('Execution · 次に確認するElements',ordered.length?ordered.slice(0,8).map(e=>(e.display_id||e.id)+' · '+e.title+'\n'+e.status+' · 期限 '+(e.due_date||'未設定')+(e.due_date&&e.due_date<today?' · 期限超過':'')):['未完了のElementsはありません。']);
  if(ordered.length>8)root.append(node('p','期限順の先頭8件 / 未完了 '+ordered.length+'件','source'));
  status.textContent='取得 '+new Date(data.fetchedAt).toLocaleString();
  root.append(node('p','現在の閲覧権限で取得した記録の集計です。指標の達成とElementsの完了は別々に確認してください。','source'));
 }catch(e){root.replaceChildren();status.textContent='取得できませんでした: '+e.message;}
 finally{refresh.disabled=false;}
}
refresh.addEventListener('click',load);await load();`,
};
