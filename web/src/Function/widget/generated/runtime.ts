import { type AppSource, type AppState, parseAppSource } from './model';
const json = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c');
export function appDocument(source: AppSource, state: AppState, context: { objectId: string; objectName: string }, channel: string, theme: Record<string, string>) {
  const app = parseAppSource(source);
  const bootstrap = `
const channel=${json(channel)};
const send=(type,payload={})=>parent.postMessage({channel,type,...payload},'*');
const pending=new Map(); let sequence=0;
const requestContext=()=>new Promise((resolve,reject)=>{
 const id=++sequence;
 const timer=setTimeout(()=>{pending.delete(id);reject(new Error('Object data request timed out. Retry.'));},30000);
 pending.set(id,{resolve,reject,timer});send('read-context',{id});
});
const watchers=[];
const alcon={readContext:requestContext,context:${json(context)},state:${json(state)},save(value){
  return new Promise((resolve,reject)=>{
    const id=++sequence;
    const timer=setTimeout(()=>{pending.delete(id);reject(new Error('Save timed out. Check your connection.'));},20000);
    // The host answers with the state everyone now has, which may carry other people's changes.
    pending.set(id,{resolve:merged=>{alcon.state=merged===undefined?value:merged;resolve();},reject,timer});
    // The state this save started from goes with it: the host sends only what changed since then.
    send('save',{id,value,base:alcon.state});
  });
},onChange(fn){if(typeof fn==='function')watchers.push(fn);}};
window.addEventListener('message',event=>{
  if(event.source!==parent||event.data?.channel!==channel||event.data?.type!=='state')return;
  alcon.state=event.data.value;
  for(const fn of watchers){try{fn(alcon.state);}catch(error){send('error',{message:String(error?.message||error)});}}
});
window.addEventListener('message',event=>{
  if(event.source!==parent||event.data?.channel!==channel||!['saved','context'].includes(event.data?.type))return;
  const p=pending.get(event.data.id);if(!p)return;pending.delete(event.data.id);clearTimeout(p.timer);
  if(event.data.error)p.reject(new Error(event.data.error));else p.resolve(event.data.value);
});
window.addEventListener('error',event=>send('error',{message:event.message}));
window.addEventListener('unhandledrejection',event=>send('error',{message:String(event.reason?.message||event.reason)}));
document.addEventListener('submit',event=>event.preventDefault());
document.addEventListener('click',event=>{if(event.target.closest?.('a'))event.preventDefault();},true);
let started=false;
window.addEventListener('message',event=>{
 if(event.source!==parent||event.data?.channel!==channel||!['start','theme'].includes(event.data?.type))return;
 for(const [key,value] of Object.entries(event.data.theme||{})){
  if(/^--[a-zA-Z0-9_-]+$/.test(key)&&typeof value==='string')document.documentElement.style.setProperty(key,value);
 }
 if(event.data.type==='start')measure();
 if(event.data.type!=='start'||started)return;
 started=true;
 (async()=>{try{\n${app.js}\n;send('ready');measure();}catch(error){send('error',{message:String(error?.message||error)});}})();
});
// The host sizes the frame to the content, so the app never scrolls inside the board.
// Content is measured as the lowest edge of what the body holds, not the body
// itself: a body stretched to the frame (height:100%) would otherwise report
// the frame back and never shrink to its content.
const contentHeight=()=>{
 let bottom=0;
 for(const child of document.body.children){const box=child.getBoundingClientRect();if(box.height>0||box.width>0)bottom=Math.max(bottom,box.bottom+(window.scrollY||0));}
 return Math.ceil(bottom+parseFloat(getComputedStyle(document.body).paddingBottom||'0'));
};
// A report sent before the host listens is lost, so the host's start asks again.
// The browser holds back resize callbacks while the frame is off screen, so the
// app's own start is measured too — its first render is otherwise reported only
// once someone scrolls to it.
let measure=()=>{};
if(typeof ResizeObserver==='function'&&document.body){
 let last=0;
 const report=()=>{const height=contentHeight();if(Math.abs(height-last)>1){last=height;send('size',{height});}};
 measure=()=>{last=0;report();};
 const observer=new ResizeObserver(report);
 observer.observe(document.body);
 for(const child of document.body.children)observer.observe(child);
 // Top-level elements an app adds later are measured too.
 if(typeof MutationObserver==='function')new MutationObserver(()=>{for(const child of document.body.children)observer.observe(child);report();}).observe(document.body,{childList:true});
}
send('boot');`;
  // Sandboxed opaque origin, no credentials, external resources or child frames.
  // The host authorizes scoped Object reads; iframe code never receives credentials.
  const variables = Object.entries(theme).map(([key, value]) => `${key}:${value.replace(/[<>;{}]/g, '')}`).join(';');
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; font-src 'none'; media-src 'none'; frame-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"><meta name="viewport" content="width=device-width,initial-scale=1"><style>:root{${variables}}*{box-sizing:border-box}body{margin:0;padding:16px;font:14px system-ui;color:var(--foreground);background:var(--background)}input,button,select,textarea{font:inherit}button{cursor:pointer;color:inherit}input,textarea,select{max-width:100%}:focus-visible{outline:none;background:var(--muted)}${app.css.replace(/</g, '\\3c ')}
/* Host control geometry applies to saved apps as well as new generations. */
::selection{background:var(--selection-background,var(--accent-default));color:var(--selection-foreground,var(--primary-foreground))}
button,[role=tab]{box-sizing:border-box!important;border:1px solid var(--border)!important;border-radius:var(--control-action-radius,9999px)!important;min-height:28px;padding:4px 10px;line-height:1.4;font-size:12px;font-weight:500}
[role=tab]{border-radius:var(--control-tab-radius,6px)!important}
button:hover,[role=tab]:hover{border-color:var(--border-strong,var(--border))!important}
[role=tab][aria-selected=true]{background:var(--muted);border-color:var(--border-strong,var(--border))!important;font-weight:600}
button:disabled{opacity:.5;cursor:default}
button:focus-visible,[role=tab]:focus-visible{background:var(--muted);border-color:var(--border-strong,var(--border))!important}
</style></head><body>${app.html}<script>${bootstrap.replace(/<\/script/gi, '<\\/script')}</script></body></html>`;
}
