"use client";
import {useState} from 'react';
import {FieldVisibility} from '@/Function/property/FieldVisibility';
import {Button} from '@/ui/button';
import type {DataColumn} from '@/ActivitySpace/execution/object/useListColumns';
const columns=[{id:'type',label:'Type',toggleable:false,kind:'builtin'},...['Due date','Lead','Progress','Elements'].map(label=>({id:label,label,toggleable:true,kind:'builtin'})),{id:'custom',label:'Budget',toggleable:true,kind:'custom'}] as DataColumn[];
export default function Review(){const[hidden,setHidden]=useState<string[]>([]);return <main className="p-6"><div className="flex gap-2 mb-4"><Button onClick={()=>document.documentElement.className='dark'}>Dark</Button><Button onClick={()=>document.documentElement.className='light'}>Light</Button></div><div className="w-72 rounded-lg bg-popover p-2"><FieldVisibility columns={columns} isVisible={id=>!hidden.includes(id)} onToggle={id=>setHidden(a=>a.includes(id)?a.filter(x=>x!==id):[...a,id])}/></div></main>}
