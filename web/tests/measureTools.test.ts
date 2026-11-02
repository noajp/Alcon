import { describe, expect, it } from 'vitest';
// Deno dependencies belong to the Edge runtime, not the web compiler graph.
const { validateMeasurePatch, runMeasureTool } = await import(new URL('../../supabase/functions/alcon-copilot/measureTools.ts',import.meta.url).pathname);
const id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
describe('Initiative measure Copilot boundaries', () => {
  it('keeps partial updates partial and timestamps readings', () => {
    expect(validateMeasurePatch({actual_value:0},false,'2026-09-06T00:00:00Z')).toEqual({actual_value:0,measured_at:'2026-09-06T00:00:00Z'});
    expect(validateMeasurePatch({title:'Updated'},false)).toEqual({title:'Updated'});
    expect(validateMeasurePatch({actual_value:null},false)).toEqual({actual_value:null,measured_at:null});
  });
  it('rejects nonfinite numbers, wrong kinds, reassigned parents and Initiatives', () => {
    for (const patch of [{target_value:NaN},{actual_value:Infinity},{actual_value:'12'},{kind:'decision'},{strategy_id:id},{parent_intent_id:id},{created_by:id}]) expect(()=>validateMeasurePatch(patch,false)).toThrow();
    expect(()=>validateMeasurePatch({title:'Goal',target_value:100},true)).toThrow();
    expect(validateMeasurePatch({title:'Goal',target_value:0,direction:'at_most'},true)).toEqual({title:'Goal',target_value:0,direction:'at_most'});
  });
  it('scopes writes by both Initiative and kind without replacing omitted values', async () => {
    const filters: unknown[] = [];
    const headers: unknown[] = [];
    let written: unknown;
    const query = {select:()=>query,setHeader:(name: string,value: string)=>{headers.push([name,value]);return query;},eq:(key: string,value: unknown)=>{filters.push([key,value]);return query;},single:async()=>({data:{id},error:null})};
    const db = {from:(table: string)=>{expect(table).toBe('intents');return {update:(patch: unknown)=>{written=patch;return query;}};}};
    await runMeasureTool(db as never,{action:'update',strategyId:id,id,patch:{unit:'件'}});
    expect(written).toEqual({unit:'件'});
    expect(filters).toEqual([['id',id],['strategy_id',id],['kind','measure']]);
    // The reading-history trigger labels Copilot's writes by this header.
    expect(headers).toEqual([['x-alcon-reading-source','copilot']]);
  });
  it('reports denied or missing mutations as failures', async () => {
    const query = {select:()=>query,eq:()=>query,single:async()=>({data:null,error:{message:'No rows'}})};
    const db = {from:()=>({delete:()=>query})};
    await expect(runMeasureTool(db as never,{action:'delete',strategyId:id,id})).rejects.toThrow('No rows');
  });
  it('returns pagination in model-visible data', async () => {
    const query = {eq:()=>query,order:()=>query,range:async()=>({data:[{id}],error:null,count:2})};
    const db = {from:()=>({select:()=>query})};
    const response = await runMeasureTool(db as never,{action:'list',strategyId:id,limit:1});
    expect(response.data).toEqual({items:[{id}],total:2,nextOffset:1});
  });
  it('validates create before reading or creating the root', async () => {
    await expect(runMeasureTool({} as never,{action:'create',strategyId:id,patch:{title:'Goal',target_value:Infinity,direction:'at_least'}})).rejects.toThrow('finite');
  });
});
