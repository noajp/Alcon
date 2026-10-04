import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const columnTypes = ['text', 'number', 'date', 'select', 'checkbox'];
const actions = ['list', 'get', 'create', 'update', 'delete'];
const objectSchema = { type: 'object', additionalProperties: true };
export const WIDGET_TOOLS = [
  {
    name: 'tableData',
    description: 'CRUD user-managed Table data and structure under the signed-in user permissions. entity: table/column/row/cell. list is paginated (offset, limit max 100); follow nextOffset until null. get requires id, except cells use rowId+columnId. Columns/rows require tableId for list/create. Cells list requires rowId; create/update sets value, delete clears it. patch uses database snake_case fields: table name/description/domain_id/icon/color/status/order_index; column name/type/options/order_index; row order_index; cell value. Column types text/number/date/select/checkbox. Never fabricate operational data; create only user-requested data. Read existing structure before mutations.',
    input_schema: { type: 'object', properties: { action: {type:'string', enum:actions}, entity:{type:'string',enum:['table','column','row','cell']}, id:{type:'string'}, tableId:{type:'string'}, rowId:{type:'string'}, columnId:{type:'string'}, patch:objectSchema, offset:{type:'integer',minimum:0}, limit:{type:'integer',minimum:1,maximum:100} }, required:['action','entity'], additionalProperties:false },
  },
  {
    name: 'widgetBoard',
    description: 'CRUD the signed-in user widget boards. list is paginated. get/create/update/delete use boardKey: home:<space UUID or me>, crm:<space UUID or me>, campaign:<UUID>, object-overview:<UUID>, object-summary:<UUID>, element-detail:<UUID>. create/update layout: {version:2,zones:{band:[],main:[],rail:[]},dismissed:[]}. Each instance: {id:string,type:string,size:half|full,params:object}. Read current layout first, preserve unrelated widgets and dismissed IDs. update/delete require expectedRevision from get; on conflict reread and reapply intended changes, never overwrite blindly. Data widget type data-view supports params {tableId,view:table|cards|bar,labelColumnId,valueColumnId,groupColumnId,columnIds,title}; use real Table/column IDs from tableData. New table structures and data stay in Tables, never inline in widget params. delete resets saved layout to defaults.',
    input_schema: { type:'object',properties:{action:{type:'string',enum:actions},boardKey:{type:'string'},layout:objectSchema,expectedRevision:{type:'integer',minimum:1},offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:100}},required:['action'],additionalProperties:false },
  },
];
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected an object');
  return value as Record<string, unknown>;
}
function uuid(value: unknown): string {
  if (typeof value !== 'string' || !uuidPattern.test(value)) throw new Error('Expected a UUID');
  return value;
}
function integer(value: unknown, min: number, max = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || Number(value) < min || Number(value) > max) throw new Error('Invalid integer');
  return Number(value);
}
export function validateTablePatch(entity: string, raw: unknown, creating: boolean): Record<string, unknown> {
  const patch = record(raw);
  const fields: Record<string,string[]> = {table:['name','description','domain_id','icon','color','status','order_index'],column:['name','type','options','order_index'],row:['order_index'],cell:['value']};
  if (!Object.hasOwn(fields,entity) || Object.keys(patch).some(k => !fields[entity].includes(k))) throw new Error('Unsupported patch field');
  if (!creating && !Object.keys(patch).length) throw new Error('Empty patch');
  if ((creating && ['table','column'].includes(entity)) || 'name' in patch) {
    if (typeof patch.name !== 'string' || !patch.name.trim() || patch.name.length > 500) throw new Error('Name is required (max 500 characters)');
  }
  if ('domain_id' in patch && patch.domain_id !== null) uuid(patch.domain_id);
  for (const key of ['description','icon','color']) if (key in patch && patch[key] !== null && typeof patch[key] !== 'string') throw new Error(`Invalid ${key}`);
  if ('status' in patch && !['active','archived'].includes(String(patch.status))) throw new Error('Invalid table status');
  if ((creating && entity === 'column') || 'type' in patch) if (!columnTypes.includes(String(patch.type))) throw new Error('Invalid column type');
  if ('order_index' in patch && !(entity === 'table' && patch.order_index === null) && (typeof patch.order_index !== 'number' || !Number.isFinite(patch.order_index))) throw new Error('Invalid order_index');
  return patch;
}
export function validateBoardLayout(raw: unknown): Record<string, unknown> {
  const layout = record(raw);
  if (layout.version !== 2) throw new Error('Layout version must be 2');
  const zones = record(layout.zones);
  if (Object.keys(zones).some(k => !['band','main','rail'].includes(k))) throw new Error('Invalid zone');
  const ids = new Set<string>();
  for (const zone of ['band','main','rail']) {
    if (!Array.isArray(zones[zone])) throw new Error('Each zone must be an array');
    for (const rawItem of zones[zone] as unknown[]) {
      const item = record(rawItem);
      if (typeof item.id !== 'string' || !item.id || ids.has(item.id) || typeof item.type !== 'string' || !item.type) throw new Error('Widget IDs must be unique and types nonempty');
      ids.add(item.id);
      if (item.size !== undefined && !['half','full'].includes(String(item.size))) throw new Error('Invalid widget size');
      if (item.params !== undefined) record(item.params);
      if (item.type === 'data-view') {
        const params = record(item.params);
        if (params.tableId != null) uuid(params.tableId);
        if (!['table','cards','bar'].includes(String(params.view))) throw new Error('Invalid data view');
        for (const key of ['labelColumnId','valueColumnId','groupColumnId']) if (params[key] != null && params[key] !== '') uuid(params[key]);
        if (params.columnIds !== undefined) { if (!Array.isArray(params.columnIds)) throw new Error('Invalid columnIds'); params.columnIds.forEach(uuid); }
        if (params.title !== undefined && typeof params.title !== 'string') throw new Error('Invalid title');
      }
    }
  }
  if (ids.size > 100 || JSON.stringify(layout).length > 100000) throw new Error('Layout is too large');
  if (!Array.isArray(layout.dismissed) || layout.dismissed.some(id => typeof id !== 'string')) throw new Error('dismissed must be a string array');
  return layout;
}
async function result(query: PromiseLike<{data: unknown;error: {message:string}|null}>) {
  const {data,error} = await query;
  if (error) throw new Error(error.message);
  return data;
}
function sourceSignature(params: Record<string, unknown>) {
  return JSON.stringify(['tableId','labelColumnId','valueColumnId','groupColumnId','columnIds'].map(key => params[key] ?? null));
}
async function checkedLayout(db: SupabaseClient, raw: unknown, previous?: unknown) {
  const layout = validateBoardLayout(raw);
  const zones = record(layout.zones);
  const previousInstances = new Map<string, Record<string, unknown>>();
  if (previous && typeof previous === 'object') {
    const previousZones = (previous as Record<string, unknown>).zones;
    if (previousZones && typeof previousZones === 'object') for (const zone of ['band','main','rail']) {
      const items = (previousZones as Record<string, unknown>)[zone];
      if (Array.isArray(items)) for (const value of items) {
        if (value && typeof value === 'object' && typeof value.id === 'string') previousInstances.set(value.id,value);
      }
    }
  }
  for (const zone of ['band','main','rail']) for (const rawItem of zones[zone] as unknown[]) {
    const item = record(rawItem);
    if (item.type !== 'data-view') continue;
    const params = record(item.params);
    if (params.tableId == null) continue;
    const old = previousInstances.get(String(item.id));
    // An unavailable source remains a valid saved reference. Only new or
    // changed bindings need lookup; editing another widget must still work.
    if (old?.type === 'data-view' && old.params && typeof old.params === 'object' && sourceSignature(record(old.params)) === sourceSignature(params)) continue;
    await result(db.from('tables').select('id').eq('id',params.tableId).single());
    const ids = [...new Set([
      params.labelColumnId, params.valueColumnId, params.groupColumnId,
      ...(Array.isArray(params.columnIds) ? params.columnIds : []),
    ].filter((id): id is string => typeof id === 'string' && id.length > 0))];
    if (ids.length > 100) throw new Error('Too many source columns');
    if (ids.length) {
      const columns = await result(db.from('table_columns').select('id').eq('table_id',params.tableId).in('id',ids));
      if (!Array.isArray(columns) || columns.length !== ids.length) throw new Error('Source columns must belong to the visible Table');
    }
  }
  return layout;
}
export async function runWidgetTool(db: SupabaseClient, name: string, input: Record<string,unknown>): Promise<{ok:true;data:unknown;meta?:{rows?:number;nextOffset:number|null;total:number|null}}> {
  if (!actions.includes(String(input.action))) throw new Error('Invalid action');
  const action = String(input.action);
  const offset = integer(input.offset ?? 0,0);
  const limit = integer(input.limit ?? 100,1,100);
  if (name === 'widgetBoard') {
    if (action === 'list') {
      const {data,error,count} = await db.from('widget_boards').select('*',{count:'exact'}).order('board_key').range(offset,offset+limit-1);
      if(error) throw error;
      return {ok:true,data:{items:data ?? [],nextOffset:offset+(data?.length??0)<(count??0)?offset+(data?.length??0):null,total:count}};
    }
    const key = String(input.boardKey ?? '');
    const [surface,id,...extra] = key.split(':');
    if (extra.length || !['home','crm','campaign','object-overview','object-summary','element-detail'].includes(surface) || !(['home','crm'].includes(surface) && id === 'me') && !uuidPattern.test(id ?? '')) throw new Error('Invalid boardKey');
    let query;
    if (action === 'get') query = db.from('widget_boards').select('*').eq('board_key',key).single();
    else if (action === 'create') query = db.from('widget_boards').insert({board_key:key,layout:await checkedLayout(db,input.layout)}).select().single();
    else {
      const revision = integer(input.expectedRevision,1);
      if (action === 'update') {
        const {data: currentData,error: currentError} = await db.from('widget_boards').select('layout').eq('board_key',key).eq('revision',revision).single();
        if (currentError) throw new Error(`Board unavailable or revision conflict; reread before retrying: ${currentError.message}`);
        const current = record(currentData);
        query = db.from('widget_boards').update({layout:await checkedLayout(db,input.layout,current.layout)}).eq('board_key',key).eq('revision',revision).select().single();
      } else query = db.from('widget_boards').delete().eq('board_key',key).eq('revision',revision).select().single();
    }
    const {data,error} = await query;
    if (error) throw new Error(action === 'update' || action === 'delete' ? `Board write failed (missing, denied, or revision conflict); reread before retrying: ${error.message}` : error.message);
    return {ok:true,data};
  }
  const entity = String(input.entity);
  const relations:Record<string,string> = {table:'tables',column:'table_columns',row:'table_rows',cell:'table_cells'};
  if (!Object.hasOwn(relations,entity)) throw new Error('Invalid entity');
  const relation = relations[entity];
  if (action === 'list') {
    let query = db.from(relation).select('*',{count:'exact'});
    if (entity === 'column' || entity === 'row') query = query.eq('table_id',uuid(input.tableId));
    if (entity === 'cell') query = query.eq('row_id',uuid(input.rowId));
    const {data,error,count} = await query.order(entity === 'cell' ? 'column_id' : 'id').range(offset,offset+limit-1);
    if(error) throw error;
    return {ok:true,data:{items:data ?? [],nextOffset:offset+(data?.length??0)<(count??0)?offset+(data?.length??0):null,total:count}};
  }
  if (entity === 'cell') {
    const rowId = uuid(input.rowId), columnId = uuid(input.columnId);
    const row = record(await result(db.from('table_rows').select('table_id').eq('id',rowId).single()));
    const col = record(await result(db.from('table_columns').select('table_id,type').eq('id',columnId).single()));
    if(row.table_id !== col.table_id) throw new Error('Row and column must belong to the same Table');
    if (action === 'get') return {ok:true,data:await result(db.from(relation).select('*').eq('row_id',rowId).eq('column_id',columnId).single())};
    if (action === 'delete') return {ok:true,data:await result(db.from(relation).delete().eq('row_id',rowId).eq('column_id',columnId).select().single())};
    const patch = validateTablePatch(entity,input.patch,false);
    if (!('value' in patch)) throw new Error('value is required');
    const value = patch.value;
    if (value !== null && (col.type === 'number' ? typeof value !== 'number' || !Number.isFinite(value) : col.type === 'checkbox' ? typeof value !== 'boolean' : typeof value !== 'string')) throw new Error(`Value must match column type ${col.type}`);
    return {ok:true,data:await result(db.from(relation).upsert({row_id:rowId,column_id:columnId,value},{onConflict:'row_id,column_id'}).select().single())};
  }
  if (action === 'create') {
    const patch = validateTablePatch(entity,input.patch ?? {},true);
    if (entity !== 'table') patch.table_id = uuid(input.tableId);
    else {
      const {data,error} = await db.auth.getUser();
      if (error || !data.user) throw new Error('Not signed in');
      patch.created_by = data.user.id;
    }
    return {ok:true,data:await result(db.from(relation).insert(patch).select().single())};
  }
  const id = uuid(input.id);
  const query = action === 'get' ? db.from(relation).select('*') : action === 'delete' ? db.from(relation).delete().select() : db.from(relation).update(validateTablePatch(entity,input.patch,false)).select();
  return {ok:true,data:await result(query.eq('id',id).single())};
}
