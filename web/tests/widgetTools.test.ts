import { describe, expect, it } from 'vitest';
// Edge Functions use Deno URL imports; load at runtime so the web compiler
// does not attempt to resolve the separate server dependency graph.
const { validateTablePatch, validateBoardLayout, runWidgetTool } = await import(new URL('../../supabase/functions/alcon-copilot/widgetTools.ts', import.meta.url).pathname);
const tableId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
describe('Copilot widget and Table boundaries', () => {
  it('rejects ownership and scope reassignment through child patches', () => {
    expect(() => validateTablePatch('table',{name:'Metrics',created_by:tableId},true)).toThrow();
    expect(() => validateTablePatch('row',{table_id:tableId},false)).toThrow();
    expect(() => validateTablePatch('column',{type:'sql'},false)).toThrow();
    expect(() => validateTablePatch('table',{domain_id:'bad'},false)).toThrow();
  });
  it('accepts human table types and nullable cell values', () => {
    expect(validateTablePatch('column',{name:'Value',type:'number'},true)).toEqual({name:'Value',type:'number'});
    expect(validateTablePatch('cell',{value:null},false)).toEqual({value:null});
  });
  it('requires versioned, unique widget instances and real source IDs', () => {
    const instance = {id:'data',type:'data-view',params:{tableId,view:'cards'}};
    const layout = {version:2,zones:{band:[],main:[instance],rail:[]},dismissed:[]};
    expect(validateBoardLayout(layout)).toEqual(layout);
    expect(() => validateBoardLayout({...layout,version:1})).toThrow();
    expect(() => validateBoardLayout({...layout,zones:{...layout.zones,rail:[instance]}})).toThrow();
    expect(() => validateBoardLayout({...layout,zones:{...layout.zones,main:[{...instance,params:{tableId:'example',view:'cards'}}]}})).toThrow();
  });
  it('rejects invalid pagination before querying the database', async () => {
    await expect(runWidgetTool({} as never,'tableData',{action:'list',entity:'table',limit:101})).rejects.toThrow('Invalid integer');
  });
  it('requires the observed revision before board mutation', async () => {
    await expect(runWidgetTool({} as never,'widgetBoard',{action:'delete',boardKey:`campaign:${tableId}`})).rejects.toThrow('Invalid integer');
  });
  it('reports cross-Table cell writes before mutating', async () => {
    let calls = 0;
    const db = {from:()=>{calls++; return {select:()=>({eq:()=>({single:async()=>({data:{table_id:calls===1?'one':'two',type:'text'},error:null})})})};}};
    await expect(runWidgetTool(db as never,'tableData',{action:'update',entity:'cell',rowId:tableId,columnId:tableId,patch:{value:'hello'}})).rejects.toThrow('same Table');
    expect(calls).toBe(2);
  });
  it('returns pagination in the data actually sent to the model', async () => {
    const db = {from:()=>({select:()=>({order:()=>({range:async()=>({data:[{id:tableId}],error:null,count:2})})})})};
    for (const name of ['tableData','widgetBoard']) {
      const response = await runWidgetTool(db as never,name,{action:'list',entity:'table',limit:1});
      expect(response.data).toEqual({items:[{id:tableId}],nextOffset:1,total:2});
    }
  });
  it('allows an unconfigured data view without querying a Table', async () => {
    const layout = {version:2,zones:{band:[],main:[{id:'blank',type:'data-view',params:{tableId:null,view:'table'}}],rail:[]},dismissed:[]};
    const relations: string[] = [];
    const db = {from:(relation: string)=>{relations.push(relation);return {insert:(row: unknown)=>({select:()=>({single:async()=>({data:row,error:null})})})};}};
    const response = await runWidgetTool(db as never,'widgetBoard',{action:'create',boardKey:'home:me',layout});
    expect(response.data).toEqual({board_key:'home:me',layout});
    expect(relations).toEqual(['widget_boards']);
  });
  it('preserves unavailable unchanged source bindings when editing a board', async () => {
    const item = {id:'existing',type:'data-view',params:{tableId,view:'cards',title:'Before'}};
    const previous = {version:2,zones:{band:[],main:[item],rail:[]},dismissed:[]};
    const layout = {...previous,zones:{...previous.zones,main:[{...item,params:{...item.params,title:'After'}}]}};
    const relations: string[] = [];
    const db = {from:(relation: string)=>{
      relations.push(relation);
      const query = {select:()=>query,eq:()=>query,single:async()=>({data:{layout:previous},error:null}),update:()=>query};
      return query;
    }};
    await expect(runWidgetTool(db as never,'widgetBoard',{action:'update',boardKey:'home:me',expectedRevision:1,layout})).resolves.toMatchObject({ok:true});
    expect(relations).toEqual(['widget_boards','widget_boards']);
  });
  it('rejects inherited relation names', async () => {
    await expect(runWidgetTool({} as never,'tableData',{action:'list',entity:'constructor'})).rejects.toThrow('Invalid entity');
  });

});
