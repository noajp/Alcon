import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MEASURE_TOOLS = [{
  name: 'campaignMeasure',
  description: 'Read/write Initiative success conditions used by Measures and OKR widgets in the same intents rows as human editors (kind=measure). actions: campaigns discovers visible Initiative IDs/names; list returns measures (optional strategyId); get/create/update/delete require strategyId, and get/update/delete require measure id. Lists return {items,nextOffset,total}; follow nextOffset. Create attaches to the Initiative root, creating that root if necessary. patch fields: title, subtitle, target_value, actual_value, unit, direction (at_least/at_most), measured_at (ISO timestamp), status (on_track/at_risk/off_track/done), order_index. Create requires nonempty title, finite target_value and direction. Numbers must be finite numbers or null, never numeric strings. Updating only a reading leaves all other fields intact; actual_value automatically stamps measured_at, null clears both. Omitted fields never reset. Cannot change kind, Initiative, parent, or owner. Read identifiers and existing values before writing. Never invent operational measurements.',
  input_schema: {type:'object',properties:{action:{type:'string',enum:['campaigns','list','get','create','update','delete']},strategyId:{type:'string'},id:{type:'string'},patch:{type:'object',additionalProperties:true},offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:100}},required:['action'],additionalProperties:false},
}];
function uuid(value: unknown): string {
  if (typeof value !== 'string' || !uuidPattern.test(value)) throw new Error('Expected a UUID');
  return value;
}
export function validateMeasurePatch(raw: unknown, creating: boolean, now = new Date().toISOString()): Record<string,unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Expected patch object');
  const patch = {...raw} as Record<string,unknown>;
  const allowed = ['title','subtitle','target_value','actual_value','unit','direction','measured_at','status','order_index'];
  if (!Object.keys(patch).length || Object.keys(patch).some(key => !allowed.includes(key))) throw new Error('Empty patch or unsupported measure field');
  if (creating || 'title' in patch) {
    if (typeof patch.title !== 'string' || !patch.title.trim() || patch.title.length > 2000) throw new Error('A nonempty title is required (max 2000 characters)');
    patch.title = patch.title.trim();
  }
  for (const key of ['target_value','actual_value']) if (key in patch && patch[key] !== null && (typeof patch[key] !== 'number' || !Number.isFinite(patch[key]))) throw new Error(`${key} must be a finite number or null`);
  if (creating && (typeof patch.target_value !== 'number' || !Number.isFinite(patch.target_value))) throw new Error('Create requires a finite target_value');
  if ((creating || 'direction' in patch) && !['at_least','at_most'].includes(String(patch.direction))) throw new Error('direction must be at_least or at_most');
  for (const key of ['unit','subtitle']) if (key in patch && patch[key] !== null && typeof patch[key] !== 'string') throw new Error(`${key} must be text or null`);
  if ('status' in patch && !['on_track','at_risk','off_track','done'].includes(String(patch.status))) throw new Error('Invalid measure status');
  if ('order_index' in patch && (typeof patch.order_index !== 'number' || !Number.isFinite(patch.order_index))) throw new Error('order_index must be finite');
  if ('measured_at' in patch && patch.measured_at !== null && (typeof patch.measured_at !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(patch.measured_at) || !Number.isFinite(Date.parse(patch.measured_at)))) throw new Error('measured_at must be an ISO timestamp or null');
  if ('actual_value' in patch) {
    if (patch.actual_value === null) patch.measured_at = null;
    else if (patch.measured_at == null) patch.measured_at = now;
  }
  return patch;
}
async function readRoot(db: SupabaseClient, strategyId: string) {
  const {data,error} = await db.from('intents').select('id,kind').eq('strategy_id',strategyId).is('parent_intent_id',null).maybeSingle();
  if (error) throw new Error(error.message);
  if (data && !['master','decision'].includes(data.kind)) throw new Error('Initiative root kind is invalid');
  return data;
}
export async function runMeasureTool(db: SupabaseClient, input: Record<string,unknown>): Promise<{ok:true;data:unknown}> {
  const action = String(input.action);
  if (!['campaigns','list','get','create','update','delete'].includes(action)) throw new Error('Invalid measure action');
  if (action === 'campaigns' || action === 'list') {
    const offset = input.offset ?? 0, limit = input.limit ?? 100;
    if (!Number.isSafeInteger(offset) || Number(offset) < 0 || !Number.isSafeInteger(limit) || Number(limit) < 1 || Number(limit) > 100) throw new Error('Invalid pagination');
    let query = action === 'campaigns' ? db.from('strategies').select('id,name',{count:'exact'}) : db.from('intents').select('*',{count:'exact'}).eq('kind','measure');
    if (input.strategyId !== undefined) query = query.eq(action === 'campaigns' ? 'id' : 'strategy_id',uuid(input.strategyId));
    const {data,error,count} = await query.order('id').range(Number(offset),Number(offset)+Number(limit)-1);
    if (error) throw new Error(error.message);
    const end = Number(offset)+(data?.length ?? 0);
    return {ok:true,data:{items:data ?? [],total:count,nextOffset:end < (count ?? 0) ? end : null}};
  }
  const strategyId = uuid(input.strategyId);
  if (action === 'create') {
    // Validate before creating the structural root, so malformed input cannot
    // leave an otherwise unused row behind.
    const patch = validateMeasurePatch(input.patch,true);
    const {data: campaign,error: campaignError} = await db.from('strategies').select('id,name').eq('id',strategyId).single();
    if (campaignError) throw new Error(campaignError.message);
    const {data: auth,error: authError} = await db.auth.getUser();
    if (authError || !auth.user) throw new Error('Not signed in');
    let root = await readRoot(db,strategyId);
    if (!root) {
      const inserted = await db.from('intents').insert({strategy_id:strategyId,parent_intent_id:null,kind:'master',title:campaign.name,status:'on_track',order_index:0,created_by:auth.user.id}).select('id,kind').single();
      if (inserted.error) {
        // Concurrent human/AI creation may win the unique root index.
        if (inserted.error.code !== '23505') throw new Error(inserted.error.message);
        root = await readRoot(db,strategyId);
        if (!root) throw new Error(inserted.error.message);
      } else root = inserted.data;
    }
    if (!root) throw new Error('Initiative root could not be resolved');
    const {data,error} = await db.from('intents').insert({...patch,strategy_id:strategyId,parent_intent_id:root.id,kind:'measure',created_by:auth.user.id}).select().single();
    if (error) throw new Error(error.message);
    return {ok:true,data};
  }
  const id = uuid(input.id);
  const query = action === 'get' ? db.from('intents').select('*') : action === 'delete' ? db.from('intents').delete().select() : db.from('intents').update(validateMeasurePatch(input.patch,false)).select();
  const {data,error} = await query.eq('id',id).eq('strategy_id',strategyId).eq('kind','measure').single();
  if (error) throw new Error(error.message);
  return {ok:true,data};
}
