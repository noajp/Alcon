import { describe, expect, it } from 'vitest';
import { SURFACE_SUBJECT } from '@/Function/widget/boardModel';
// Edge Functions use Deno URL imports; load at runtime so the web compiler
// does not attempt to resolve the separate server dependency graph.
const { validateTablePatch, validateDataView, parseBoardKey, runWidgetTool } = await import(new URL('../../supabase/functions/alcon-copilot/widgetTools.ts', import.meta.url).pathname);
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
  it('requires real source IDs in a data view', () => {
    const params = {tableId,view:'cards'};
    expect(validateDataView(params)).toEqual(params);
    expect(() => validateDataView({tableId:'example',view:'cards'})).toThrow();
    expect(() => validateDataView({tableId,view:'sql'})).toThrow();
    expect(() => validateDataView({tableId,view:'table',columnIds:['x']})).toThrow();
  });
  it('addresses a shared board by its subject and a personal one by its Space', () => {
    expect(parseBoardKey(`campaign:${tableId}`)).toEqual({surface:'campaign',kind:'initiative',subjectId:tableId,spaceId:null});
    expect(parseBoardKey('home:me')).toEqual({surface:'home',kind:'me',subjectId:null,spaceId:null});
    expect(parseBoardKey(`home:${tableId}`)).toEqual({surface:'home',kind:'me',subjectId:null,spaceId:tableId});
    // The app and Copilot must agree on what each surface's board is about.
    for (const [surface,kind] of Object.entries(SURFACE_SUBJECT)) expect(parseBoardKey(`${surface}:${tableId}`).kind).toBe(kind);
    for (const key of ['campaign:me','constructor:me',`unknown:${tableId}`,`home:${tableId}:x`,'']) expect(() => parseBoardKey(key)).toThrow('Invalid boardKey');
  });
  it('rejects invalid pagination before querying the database', async () => {
    await expect(runWidgetTool({} as never,'tableData',{action:'list',entity:'table',limit:101})).rejects.toThrow('Invalid integer');
  });
  it('requires a widget id before any board mutation', async () => {
    await expect(runWidgetTool({} as never,'widgetBoard',{action:'delete',boardKey:`campaign:${tableId}`})).rejects.toThrow('Expected a UUID');
    await expect(runWidgetTool({} as never,'widgetBoard',{action:'update',widgetId:tableId})).rejects.toThrow('Nothing to update');
  });
  it('reports cross-Table cell writes before mutating', async () => {
    let calls = 0;
    const db = {from:()=>{calls++; return {select:()=>({eq:()=>({single:async()=>({data:{table_id:calls===1?'one':'two',type:'text'},error:null})})})};}};
    await expect(runWidgetTool(db as never,'tableData',{action:'update',entity:'cell',rowId:tableId,columnId:tableId,patch:{value:'hello'}})).rejects.toThrow('same Table');
    expect(calls).toBe(2);
  });
  it('returns pagination in the data actually sent to the model', async () => {
    const db = {from:()=>({select:()=>({order:()=>({range:async()=>({data:[{id:tableId}],error:null,count:2})})})})};
    const boards = {from:()=>({select:()=>({order:()=>({order:()=>({range:async()=>({data:[{id:tableId}],error:null,count:2})})})})})};
    for (const [client,name] of [[db,'tableData'],[boards,'widgetBoard']] as const) {
      const response = await runWidgetTool(client as never,name,{action:'list',entity:'table',limit:1});
      expect(response.data).toEqual({items:[{id:tableId}],nextOffset:1,total:2});
    }
  });
  it('places an unconfigured data view through the board functions without querying a Table', async () => {
    const calls: [string, Record<string,unknown>][] = [];
    const db = {
      from:() => { throw new Error('No table read expected'); },
      rpc:async (fn: string, args: Record<string,unknown>) => { calls.push([fn,args]); return {data:fn === 'ensure_board' ? 'board' : 'widget',error:null}; },
    };
    const response = await runWidgetTool(db as never,'widgetBoard',{action:'create',boardKey:`object-overview:${tableId}`,kind:'data-view',zone:'main',params:{tableId:null,view:'table'}});
    expect(response.data).toEqual({boardId:'board',widgetId:'widget'});
    expect(calls).toEqual([
      ['ensure_board',{p_surface:'object-overview',p_subject_kind:'object',p_subject_id:tableId,p_space_id:null,p_instances:[]}],
      ['add_widget',{p_board_id:'board',p_kind:'data-view',p_zone:'main',p_size:null,p_params:{tableId:null,view:'table'}}],
    ]);
  });
  it('refuses a move on an unknown board before writing params', async () => {
    let wrote = false;
    const query = {select:() => query,eq:() => query,is:() => query,maybeSingle:async () => ({data:null,error:null})};
    const db = {from:() => query,rpc:async () => { wrote = true; return {data:{},error:null}; }};
    await expect(runWidgetTool(db as never,'widgetBoard',{action:'update',boardKey:`campaign:${tableId}`,widgetId:tableId,zone:'main',params:{title:'x'}})).rejects.toThrow('no saved placements');
    expect(wrote).toBe(false);
  });
  it('refuses a move of a widget that is not on the board before writing params', async () => {
    let wrote = false;
    const relations: string[] = [];
    const db = {
      from:(relation: string) => {
        relations.push(relation);
        const query = {select:() => query,eq:() => query,is:() => query,maybeSingle:async () => ({data:relation === 'boards' ? {id:'board'} : null,error:null})};
        return query;
      },
      rpc:async () => { wrote = true; return {data:{},error:null}; },
    };
    await expect(runWidgetTool(db as never,'widgetBoard',{action:'update',boardKey:`campaign:${tableId}`,widgetId:tableId,zone:'main',params:{title:'x'}})).rejects.toThrow('not placed on this board');
    expect(relations).toEqual(['boards','board_placements']);
    expect(wrote).toBe(false);
  });
  it('merges params without re-checking an unchanged, unavailable source binding', async () => {
    const relations: string[] = [];
    const merged: unknown[] = [];
    const db = {
      from:(relation: string) => {
        relations.push(relation);
        const query = {select:() => query,eq:() => query,single:async () => ({data:{kind:'data-view',params:{tableId,view:'cards',title:'Before'}},error:null})};
        return query;
      },
      rpc:async (_fn: string, args: Record<string,unknown>) => { merged.push(args.p_patch); return {data:{tableId,view:'cards',title:'After'},error:null}; },
    };
    await expect(runWidgetTool(db as never,'widgetBoard',{action:'update',widgetId:tableId,params:{title:'After'}})).resolves.toMatchObject({ok:true,data:{params:{title:'After'}}});
    expect(relations).toEqual(['widgets']);
    expect(merged).toEqual([{title:'After'}]);
  });
  it('rejects a changed binding to a Table the caller cannot see', async () => {
    const other = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
    const db = {from:(relation: string) => {
      const query = {select:() => query,eq:() => query,single:async () => relation === 'widgets'
        ? {data:{kind:'data-view',params:{tableId,view:'cards'}},error:null}
        : {data:null,error:{message:'Table unavailable'}}};
      return query;
    }};
    await expect(runWidgetTool(db as never,'widgetBoard',{action:'update',widgetId:tableId,params:{tableId:other}})).rejects.toThrow('Table unavailable');
  });
  it('rejects inherited relation names', async () => {
    await expect(runWidgetTool({} as never,'tableData',{action:'list',entity:'constructor'})).rejects.toThrow('Invalid entity');
  });

});
