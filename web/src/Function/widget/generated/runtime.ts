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
const alcon={readContext:requestContext,context:${json(context)},state:${json(state)},save(value){
  return new Promise((resolve,reject)=>{
    const id=++sequence;
    const timer=setTimeout(()=>{pending.delete(id);reject(new Error('Save timed out. Check your connection.'));},20000);
    pending.set(id,{resolve:()=>{alcon.state=value;resolve();},reject,timer});
    send('save',{id,value});
  });
}};
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
 if(event.source!==parent||event.data?.channel!==channel||event.data?.type!=='start'||started)return;
 started=true;
 (async()=>{try{\n${app.js}\n;send('ready');}catch(error){send('error',{message:String(error?.message||error)});}})();
});
send('boot');`;
  // Sandboxed opaque origin, no credentials, external resources or child frames.
  // The host authorizes scoped Object reads; iframe code never receives credentials.
  const variables = Object.entries(theme).map(([key, value]) => `${key}:${value.replace(/[<>;{}]/g, '')}`).join(';');
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; font-src 'none'; media-src 'none'; frame-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"><meta name="viewport" content="width=device-width,initial-scale=1"><style>:root{${variables}}*{box-sizing:border-box}body{margin:0;padding:16px;font:14px system-ui;color:var(--foreground);background:var(--background)}input,button,select,textarea{font:inherit}button{cursor:pointer}input,textarea,select{max-width:100%}:focus-visible{outline:none;background:var(--muted)}${app.css.replace(/</g, '\\3c ')}</style></head><body>${app.html}<script>${bootstrap.replace(/<\/script/gi, '<\\/script')}</script></body></html>`;
}
