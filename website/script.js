const layers = {
 strategy: { eyebrow:'DIRECTION & ALIGNMENT',title:'Strategy',description:'組織の目標と、一人ひとりの実行をつなぐ。',metric:'Active initiatives',value:'04',table:'Initiatives',rows:[['市場拡大に向けた事業戦略',72],['次世代プロダクトの立ち上げ',48],['組織のオペレーション改革',86]],insight:'戦略から実行まで、つながっています。',detail:'すべての活動が、組織の目的に紐づくワークスペース。'},
 execution: {eyebrow:'ACTION & COLLABORATION',title:'Execution',description:'人とAIが、同じ文脈で仕事を前に進める。',metric:'Active projects',value:'12',table:'Projects',rows:[['顧客インサイトのリサーチ',90],['プロダクト要件と実行計画',64],['新しい業務フローの導入',35]],insight:'人とAIが、ひとつのチームに。',detail:'担当・進捗・依存関係を共有し、次のアクションへ。'},
 sustainment: {eyebrow:'CAPACITY & CONTINUITY',title:'Sustainment',description:'実行を支える余力を整え、成果を持続させる。',metric:'Active resources',value:'08',table:'Resource allocation',rows:[['Product & Engineering',68],['Business development',75],['Operations & AI workers',52]],insight:'組織が動き続けるための基盤。',detail:'人とリソースの配置を見渡し、無理のない実行を支える。'}
};
const tabs=[...document.querySelectorAll('[role="tab"]')];
function selectLayer(key){const layer=layers[key];tabs.forEach(tab=>{const active=tab.dataset.layer===key;tab.setAttribute('aria-selected',String(active));tab.tabIndex=active?0:-1});document.querySelector('#layer-panel').setAttribute('aria-labelledby',`tab-${key}`);for(const [id,value] of Object.entries({'panel-eyebrow':layer.eyebrow,'panel-title':layer.title,'panel-description':layer.description,'metric-label':layer.metric,'table-title':layer.table,'insight-title':layer.insight,'insight-description':layer.detail})){document.getElementById(id).textContent=value}document.getElementById('metric-value').innerHTML=`${layer.value} <small>across 3 domains</small>`;document.getElementById('preview-rows').innerHTML=layer.rows.map(([name,progress],i)=>`<div class="data-row"><i class="dot ${['purple','blue','green'][i]}"></i><span class="row-code">ALC-0${i+1}</span><span class="row-name">${name}</span><span class="avatar">${['AK','YM','✳'][i]}</span><span class="row-progress"><span class="bar"><i style="width:${progress}%"></i></span>${progress}%</span></div>`).join('')}
tabs.forEach((tab,index)=>{tab.addEventListener('click',()=>selectLayer(tab.dataset.layer));tab.addEventListener('keydown',event=>{let next;if(event.key==='ArrowDown'||event.key==='ArrowRight')next=(index+1)%tabs.length;if(event.key==='ArrowUp'||event.key==='ArrowLeft')next=(index+tabs.length-1)%tabs.length;if(event.key==='Home')next=0;if(event.key==='End')next=tabs.length-1;if(next!==undefined){event.preventDefault();selectLayer(tabs[next].dataset.layer);tabs[next].focus()}})});selectLayer('strategy');
const english = {
'プラットフォームを見る ':'Explore the platform ',
'組織の意志を、':'Turn organizational intent',
'実行し続ける力へ。':'into lasting momentum.',
'戦略を描く。実行を動かす。活動を支え続ける。':'Set the direction. Move work forward. Sustain the momentum.',
'組織活動のすべてと、自立するAIを、一つのプラットフォームに。':'Every activity. Autonomous AI. One connected platform.',
'Claywareを体験する ':'Explore Clayware ',
'3つのレイヤーを知る ':'Discover the three layers ',
'目的も、仕事も、それを支える基盤も。':'Your purpose, your work, and the foundation behind it.',
'組織を動かすすべてが、ここでつながる。':'Everything that moves your organization, connected.',
'描く。動かす。':'Set direction. Take action.',
'動き続ける。':'Keep moving.',
'よい戦略だけでは、組織は動かない。':'A great strategy is only the beginning.',
'実行と、それを支える基盤まで。':'Connect execution with the foundation that sustains it.',
'Claywareは組織活動を、三つのレイヤーで捉えます。':'Clayware brings your organization together in three layers.',
'組織の意志を、明確にする。':'Give your ambition a clear direction.',
'目的と方針を定め、Initiativeへ。日々の仕事が何のためにあるのか、組織全体で同じ方向を見渡せます。':'Define your purpose and direction, then shape them into initiatives. Give everyone a shared view of why their work matters.',
'組織の目標と、一人ひとりの実行をつなぐ。':'Connect organizational goals with everyday execution.',
'市場拡大に向けた事業戦略':'Market expansion strategy',
'次世代プロダクトの立ち上げ':'Next-generation product launch',
'組織のオペレーション改革':'Operational transformation',
'戦略から実行まで、つながっています。':'Connected, from strategy to execution.',
'すべての活動が、組織の目的に紐づくワークスペース。':'A workspace where every activity connects to purpose.',
'意志を、確かな前進に変える。':'Turn intent into tangible progress.',
'プロジェクト、タスク、日々の判断を一か所に。人とAIが文脈を共有し、組織の戦略を具体的な成果へ進めます。':'Bring projects, tasks, and everyday decisions into one place. People and AI share context to turn strategy into meaningful results.',
'成果を、一度きりで終わらせない。':'Build the capacity to keep delivering.',
'人、リソース、ワークロードを可視化。実行を支える余力を整え、組織が継続して成果を生む基盤をつくります。':'See your people, resources, and workloads together. Balance capacity and build the foundation for sustained organizational performance.',
'実行から学び、次の戦略へ。':'Learn from execution. Inform the next strategy.',
'リサーチ':'Research',
'実行計画':'Action plan',
'要件整理':'Requirements',
'AIが動く。':'AI takes action.',
'組織として、信頼できる。':'Your organization stays in control.',
'AIを、組織活動の一員へ。':'Make AI part of how your organization works.',
'完全性・自立性・監査性を、':'Integrity, autonomy, and auditability,',
'同じプラットフォームの上で確立する。':'established on one shared platform.',
'完全性 ':'Integrity ',
'自立性 ':'Autonomy ',
'監査性 ':'Auditability ',
'目的、文脈、実行結果をひとつながりに。':'Connect purpose, context, and outcomes.',
'分断された情報に頼らず、仕事の全体を捉える。':'Give AI the full picture of the work at hand.',
'目的を受け取り、自ら実行を進める。':'Give AI an objective and let it move work forward.',
'人が判断すべき地点では、承認へつなぐ。':'Bring people in where human approval matters.',
'誰が、何を、なぜ行ったのか。':'Understand who did what, and why.',
'判断から実行までの経緯を、追跡できる状態に。':'Keep decisions and actions traceable from end to end.',
'今期の戦略に沿って、':'Create a project execution plan',
'プロジェクトの実行計画を整理して。':'aligned with our strategy for this quarter.',
'戦略と関連する活動を確認':'Reviewed strategy and related activities',
'実行計画を作成':'Created an execution plan',
'責任者の承認を待機':'Awaiting owner approval',
' 文脈・判断・変更の履歴を、ひとつに。':' Context, decisions, and changes in one record.',
'すべての活動に、つながりを。':'Every activity, connected.',
'組織の未来に、実行力を。':'Your ambition, put into motion.',
'プラットフォームを体験する ':'Explore the platform ',
'人とAIが、同じ文脈で仕事を前に進める。':'People and AI move work forward with shared context.',
'顧客インサイトのリサーチ':'Customer insight research',
'プロダクト要件と実行計画':'Product requirements and planning',
'新しい業務フローの導入':'New workflow rollout',
'人とAIが、ひとつのチームに。':'People and AI, working as one team.',
'担当・進捗・依存関係を共有し、次のアクションへ。':'Share ownership, progress, and dependencies. Take the next step.',
'実行を支える余力を整え、成果を持続させる。':'Balance capacity to sustain execution and results.',
'組織が動き続けるための基盤。':'The foundation for lasting momentum.',
'人とリソースの配置を見渡し、無理のない実行を支える。':'See people and resource allocation to support sustainable work.'
};
let language='ja';
const originalText=new WeakMap();
function translatePage(){
 const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
 let node;
 while((node=walker.nextNode())){
  if(['SCRIPT','STYLE'].includes(node.parentElement.tagName))continue;
  if(!originalText.has(node))originalText.set(node,node.textContent);
  const original=originalText.get(node);
  node.textContent=language==='en'?(english[original]??original):original;
 }
 document.documentElement.lang=language;
 document.title=language==='en'?'Clayware — Turn organizational intent into lasting momentum.':'Clayware — 組織の意志を、実行し続ける力へ。';
 document.querySelector('meta[name="description"]').content=language==='en'?'Connect Strategy, Execution, and Sustainment. Every organizational activity and autonomous AI on one platform, with integrity and auditability.':'ClaywareはStrategy・Execution・Sustainmentをつなぎ、組織活動とAIの完全性・自立性・監査性を一つのプラットフォームで支える。';
 const toggle=document.querySelector('.language-toggle');toggle.textContent=language==='ja'?'EN':'JP';toggle.setAttribute('aria-label',language==='ja'?'Switch to English':'日本語に切り替える');
 document.querySelector('nav').setAttribute('aria-label',language==='ja'?'メインナビゲーション':'Main navigation');
 document.querySelector('[role="tablist"]').setAttribute('aria-label',language==='ja'?'プラットフォームのレイヤー':'Platform layers');
 document.querySelectorAll('.trust-copy small').forEach(el=>el.hidden=language==='en');
}
// Layer content is generated on selection; translate newly rendered text as well.
const selectOriginal=selectLayer;
selectLayer=function(key){selectOriginal(key);['panel-eyebrow','panel-title','panel-description','metric-label','table-title','insight-title','insight-description'].forEach(id=>{const node=document.getElementById(id).firstChild;if(node)originalText.delete(node)});translatePage()};
document.querySelector('.language-toggle').addEventListener('click',()=>{language=language==='ja'?'en':'ja';translatePage();try{localStorage.setItem('clayware-site-language',language)}catch{}});
try{if(localStorage.getItem('clayware-site-language')==='en')language='en'}catch{}
translatePage();
