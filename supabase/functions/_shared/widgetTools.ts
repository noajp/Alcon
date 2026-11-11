import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const columnTypes = ['text', 'number', 'date', 'select', 'checkbox'];
const actions = ['list', 'get', 'create', 'update', 'delete'];
const objectSchema = { type: 'object', additionalProperties: true };
const zones = ['band', 'main', 'rail'];
const sizes = ['half', 'full'];
/** What each surface's board is about — the same table as web boardModel SURFACE_SUBJECT. */
const surfaces: Record<string,string> = {home:'me',campaign:'initiative','object-overview':'object','object-summary':'object','domain-overview':'domain','element-detail':'element'};
const boardSelect = 'id,surface,subject_kind,subject_id,space_id,dismissed_defaults,revision,board_placements(id,widget_id,zone,position,size,default_id,widget:widgets(id,kind,params,revision))';
export const WIDGET_TOOLS = [
  {
    name: 'tableData',
    description: 'CRUD user-managed Table data and structure under the signed-in user permissions. entity: table/column/row/cell. list is paginated (offset, limit max 100); follow nextOffset until null. get requires id, except cells use rowId+columnId. Columns/rows require tableId for list/create. Cells list requires rowId; create/update sets value, delete clears it. patch uses database snake_case fields: table name/description/domain_id/icon/color/status/order_index; column name/type/options/order_index; row order_index; cell value. Column types text/number/date/select/checkbox. Never fabricate operational data; create only user-requested data. Read existing structure before mutations.',
    input_schema: { type: 'object', properties: { action: {type:'string', enum:actions}, entity:{type:'string',enum:['table','column','row','cell']}, id:{type:'string'}, tableId:{type:'string'}, rowId:{type:'string'}, columnId:{type:'string'}, patch:objectSchema, offset:{type:'integer',minimum:0}, limit:{type:'integer',minimum:1,maximum:100} }, required:['action','entity'], additionalProperties:false },
  },
  {
    name: 'widgetBoard',
    description: 'Read and edit widget boards under the signed-in user permissions. A board belongs to a subject and is the same for everyone who can see that subject; a widget is its own record, placed on a board, visible to whoever can see where it was created. boardKey: home:me or home:<Space UUID> (personal), campaign:<Initiative UUID>, object-overview:<UUID>, object-summary:<UUID>, domain-overview:<UUID>, element-detail:<UUID>. list: boards that have been edited, paginated. get (boardKey): board with placements {id, widget_id, zone, position, size, default_id, widget:{id,kind,params,revision}}; widget null means it was placed from somewhere you cannot see; board null means nobody has edited it and it shows the surface defaults. create (boardKey, kind, zone, optional size and params): a new widget at the end of the zone. update (widgetId): params are merged into the saved ones; zone, size and position move it and need boardKey; a widget you cannot see can be reordered within its zone but not moved to another. delete (boardKey, widgetId): takes it off the board; a widget you cannot see cannot be taken off. Off its last board a widget is deleted, together with anything it holds (a generated app and what people entered into it), for everyone — say so and get a go-ahead from the user before deleting one. Read before writing and change only what was asked.',
    input_schema: { type:'object',properties:{action:{type:'string',enum:actions},boardKey:{type:'string'},widgetId:{type:'string'},kind:{type:'string'},zone:{type:'string',enum:zones},size:{type:'string',enum:sizes},position:{type:'number'},params:objectSchema,offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:100}},required:['action'],additionalProperties:false },
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
export function validateDataView(raw: unknown): Record<string, unknown> {
  const params = record(raw);
  if (params.tableId != null) uuid(params.tableId);
  if (!['table','cards','bar'].includes(String(params.view))) throw new Error('Invalid data view');
  for (const key of ['labelColumnId','valueColumnId','groupColumnId']) if (params[key] != null && params[key] !== '') uuid(params[key]);
  if (params.columnIds !== undefined) { if (!Array.isArray(params.columnIds)) throw new Error('Invalid columnIds'); params.columnIds.forEach(uuid); }
  if (params.title !== undefined && typeof params.title !== 'string') throw new Error('Invalid title');
  return params;
}
export function parseBoardKey(raw: unknown): {surface:string;kind:string;subjectId:string|null;spaceId:string|null} {
  const [surface,id,...extra] = String(raw ?? '').split(':');
  if (extra.length || !Object.hasOwn(surfaces,surface)) throw new Error('Invalid boardKey');
  const kind = surfaces[surface];
  // A personal board is the caller's own; the id names the Space it is kept for.
  if (kind === 'me' && id === 'me') return {surface,kind,subjectId:null,spaceId:null};
  if (!uuidPattern.test(id ?? '')) throw new Error('Invalid boardKey');
  return kind === 'me' ? {surface,kind,subjectId:null,spaceId:id} : {surface,kind,subjectId:id,spaceId:null};
}
async function result(query: PromiseLike<{data: unknown;error: {message:string}|null}>) {
  const {data,error} = await query;
  if (error) throw new Error(error.message);
  return data;
}
function sourceSignature(params: Record<string, unknown>) {
  return JSON.stringify(['tableId','labelColumnId','valueColumnId','groupColumnId','columnIds'].map(key => params[key] ?? null));
}
/** A data view may only be bound to a Table and columns the caller can see. */
async function checkedParams(db: SupabaseClient, kind: string, raw: unknown, previous?: unknown) {
  const params = record(raw);
  if (JSON.stringify(params).length > 50000) throw new Error('Params are too large');
  if (kind !== 'data-view') return params;
  validateDataView(params);
  if (params.tableId == null) return params;
  // An unavailable source remains a valid saved reference. Only new or
  // changed bindings need lookup; editing a title must still work.
  if (previous && typeof previous === 'object' && sourceSignature(record(previous)) === sourceSignature(params)) return params;
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
  return params;
}
async function findBoard(db: SupabaseClient, key: unknown) {
  const target = parseBoardKey(key);
  let query = db.from('boards').select(boardSelect).eq('surface',target.surface).eq('subject_kind',target.kind);
  if (target.subjectId) query = query.eq('subject_id',target.subjectId);
  query = target.spaceId ? query.eq('space_id',target.spaceId) : query.is('space_id',null);
  return {target, board: await result(query.maybeSingle()) as Record<string,unknown>|null};
}
export async function runWidgetTool(db: SupabaseClient, name: string, input: Record<string,unknown>): Promise<{ok:true;data:unknown;meta?:{rows?:number;nextOffset:number|null;total:number|null}}> {
  if (!actions.includes(String(input.action))) throw new Error('Invalid action');
  const action = String(input.action);
  const offset = integer(input.offset ?? 0,0);
  const limit = integer(input.limit ?? 100,1,100);
  if (name === 'widgetBoard') {
    if (action === 'list') {
      const {data,error,count} = await db.from('boards').select('id,surface,subject_kind,subject_id,space_id,revision,updated_at',{count:'exact'}).order('surface').order('id').range(offset,offset+limit-1);
      if(error) throw error;
      return {ok:true,data:{items:data ?? [],nextOffset:offset+(data?.length??0)<(count??0)?offset+(data?.length??0):null,total:count}};
    }
    if (action === 'get') {
      const {board} = await findBoard(db,input.boardKey);
      return {ok:true,data:{boardKey:input.boardKey,board}};
    }
    if (action === 'create') {
      const target = parseBoardKey(input.boardKey);
      const kind = input.kind;
      if (typeof kind !== 'string' || !kind || kind.length > 100) throw new Error('kind is required');
      if (!zones.includes(String(input.zone))) throw new Error('Invalid zone');
      if (input.size !== undefined && !sizes.includes(String(input.size))) throw new Error('Invalid widget size');
      const params = await checkedParams(db,kind,input.params ?? {});
      // The board row is made here if nobody has edited it yet; its defaults stay as the surface shows them.
      const boardId = await result(db.rpc('ensure_board',{p_surface:target.surface,p_subject_kind:target.kind,p_subject_id:target.subjectId,p_space_id:target.spaceId,p_instances:[]}));
      const widgetId = await result(db.rpc('add_widget',{p_board_id:boardId,p_kind:kind,p_zone:input.zone,p_size:input.size ?? null,p_params:params}));
      return {ok:true,data:{boardId,widgetId}};
    }
    const widgetId = uuid(input.widgetId);
    if (action === 'delete') {
      const {board} = await findBoard(db,input.boardKey);
      if (!board) throw new Error('Board has no saved placements; reread before retrying');
      return {ok:true,data:await result(db.from('board_placements').delete().eq('board_id',board.id).eq('widget_id',widgetId).select().single())};
    }
    const placement: Record<string,unknown> = {};
    if (input.zone !== undefined) { if (!zones.includes(String(input.zone))) throw new Error('Invalid zone'); placement.zone = input.zone; }
    if (input.size !== undefined) { if (!sizes.includes(String(input.size))) throw new Error('Invalid widget size'); placement.size = input.size; }
    if (input.position !== undefined) { if (typeof input.position !== 'number' || !Number.isFinite(input.position)) throw new Error('Invalid position'); placement.position = input.position; }
    if (input.params === undefined && !Object.keys(placement).length) throw new Error('Nothing to update');
    // Everything is checked before anything is written, so a refused call changes nothing.
    let boardId: unknown;
    if (Object.keys(placement).length) {
      const {board} = await findBoard(db,input.boardKey);
      if (!board) throw new Error('Board has no saved placements; reread before retrying');
      boardId = board.id;
      if (!await result(db.from('board_placements').select('id').eq('board_id',boardId).eq('widget_id',widgetId).maybeSingle())) throw new Error('Widget is not placed on this board; reread before retrying');
    }
    const data: Record<string,unknown> = {widgetId};
    if (input.params !== undefined) {
      const current = record(await result(db.from('widgets').select('kind,params').eq('id',widgetId).single()));
      const patch = record(input.params);
      await checkedParams(db,String(current.kind),{...record(current.params ?? {}),...patch},current.params);
      data.params = await result(db.rpc('merge_widget_params',{p_widget_id:widgetId,p_patch:patch}));
    }
    if (boardId) data.placement = await result(db.from('board_placements').update(placement).eq('board_id',boardId).eq('widget_id',widgetId).select().single());
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
