'use client';
import {useState} from 'react';
import {ListControls, DEFAULT_DISPLAY, DEFAULT_FILTER, type ListControlsState} from '@/Function/shared/listControls';
import {ListTable} from '@/Function/shared/listTable/ListTable';
import {DomainIcon} from '@/Function/shared/conceptIcons';
import {PriorityPicker} from '@/Function/shared/PriorityPicker';
import {ElementProgressMark} from '@/Function/shared/ElementProgressMark';
import {Button} from '@/ui/button';
import type {ElementWithDetails} from '@/hooks/useSupabase';
const elements=['in_progress','review','done','blocked'].map((status,i)=>({id:`preview-${i}`,title:'Review the delivery plan',display_id:`ELE_DEC-00${i+1}`,status,priority:i?'high':null,labels:['Bug'],progress:50})) as ElementWithDetails[];
export default function Review(){const [controls,setControls]=useState<ListControlsState>({filter:DEFAULT_FILTER,display:DEFAULT_DISPLAY});const[p,setP]=useState<string|null>(null);return <main className="p-6 space-y-5"><div className="flex gap-2"><Button onClick={()=>document.documentElement.className='dark'}>Dark</Button><Button onClick={()=>document.documentElement.className='light'}>Light</Button><PriorityPicker value={p} onChange={setP} trigger={<Button>Priority</Button>}/></div><div className="flex gap-6">{elements.map(e=><span key={e.id} className="flex items-center gap-2"><ElementProgressMark status={e.status} progress={50}/>{e.status}</span>)}</div><div className="flex justify-end"><ListControls state={controls} onChange={setControls} labelOptions={["Bug", "Design"]} typeOptions={["Issue", "Feature"]} sortColumnsStorageKey="icons-review" onReset={()=>setControls({filter:DEFAULT_FILTER,display:DEFAULT_DISPLAY})}/></div><pre className="text-xs">{JSON.stringify(controls)}</pre><ListTable sections={[{id:'domain',name:'Domain',icon:<DomainIcon size={16}/>,objects:[],elements}]} onSelectObject={()=>{}} onSelectElement={()=>{}} onElementUpdate={()=>{}} colStorageKey="icons-review"/></main>}
