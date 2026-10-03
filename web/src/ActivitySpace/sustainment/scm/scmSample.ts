// A sample supply chain for trying SCM before connecting real data: a café
// chain with two distribution centres. The history is simulated day by day
// with a simple replenishment rule, so the ledger, the purchase orders and the
// stock on hand agree with each other the way real records would. A few
// situations are planted so every part of the planner has something to show:
// a supplier that delivers late, rising demand, a count discrepancy that a
// transfer can cover, slow and dead stock.

import { addDays, dayNumber, type ScmMovementKind, type ScmPoStatus } from './scmEngine';

export interface SampleLocation { key: string; name: string; code: string }
export interface SampleSupplier { key: string; name: string; contact: string; email: string; leadTimeDays: number; currency: string; notes: string }
export interface SampleItem {
  key: string; sku: string; name: string; unit: string; category: string; supplierKey: string;
  unitCost: number; unitPrice: number | null; moq: number; orderMultiple: number;
}
export interface SampleMovement { itemKey: string; locationKey: string; kind: ScmMovementKind; quantity: number; occurredOn: string; poKey: string | null; note: string | null }
export interface SampleOrder {
  key: string; supplierKey: string; locationKey: string; status: ScmPoStatus;
  orderedOn: string; expectedOn: string; receivedOn: string | null;
  lines: { itemKey: string; quantity: number; unitCost: number; receivedQuantity: number }[];
}
export interface ScmSampleData {
  locations: SampleLocation[];
  suppliers: SampleSupplier[];
  items: SampleItem[];
  movements: SampleMovement[];
  orders: SampleOrder[];
}

function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const LOCATIONS: SampleLocation[] = [
  { key: 'tky', name: '東京DC', code: 'TKY' },
  { key: 'osa', name: '大阪DC', code: 'OSA' },
];

/** delay: mean and spread of days late against the promised date. */
const SUPPLIERS: (SampleSupplier & { delay: [number, number] })[] = [
  { key: 'bean', name: 'ブルーマウンテン貿易', contact: '佐藤', email: 'orders@bluemountain.example', leadTimeDays: 21, currency: 'JPY', notes: '生豆・焙煎豆。船便のため長納期。', delay: [-0.5, 1] },
  { key: 'milk', name: '東和乳業', contact: '田中', email: 'eigyo@towa-milk.example', leadTimeDays: 3, currency: 'JPY', notes: '乳製品・植物性ミルク。', delay: [0, 0.4] },
  { key: 'pack', name: '北海産業', contact: '鈴木', email: 'juchu@hokkai.example', leadTimeDays: 10, currency: 'JPY', notes: '紙カップ・リッド・ストロー。', delay: [4, 2.5] },
  { key: 'flavor', name: 'フレーバーワークス', contact: '高橋', email: 'sales@flavorworks.example', leadTimeDays: 7, currency: 'JPY', notes: 'シロップ・パウダー類。', delay: [0, 1] },
  { key: 'bakery', name: '関西ベーカリー', contact: '伊藤', email: 'order@kansai-bakery.example', leadTimeDays: 3, currency: 'JPY', notes: '冷凍ベーカリー。', delay: [0, 0.6] },
];

/** base: daily demand at [Tokyo, Osaka]; ramp: demand multiplier reached by today over the last 35 days. */
const ITEMS: (SampleItem & { base: [number, number]; ramp?: number; opening?: [number, number] })[] = [
  { key: 'eth', sku: 'CB-ETH', name: 'エチオピア イルガチェフェ 1kg', unit: 'kg', category: 'コーヒー豆', supplierKey: 'bean', unitCost: 3200, unitPrice: 5800, moq: 10, orderMultiple: 5, base: [6, 4] },
  { key: 'col', sku: 'CB-COL', name: 'コロンビア スプレモ 1kg', unit: 'kg', category: 'コーヒー豆', supplierKey: 'bean', unitCost: 2600, unitPrice: 4600, moq: 10, orderMultiple: 5, base: [9, 7] },
  { key: 'bra', sku: 'CB-BRA', name: 'ブラジル サントス 1kg', unit: 'kg', category: 'コーヒー豆', supplierKey: 'bean', unitCost: 2200, unitPrice: 3900, moq: 10, orderMultiple: 5, base: [12, 10] },
  { key: 'gua', sku: 'CB-GUA', name: 'グアテマラ アンティグア 1kg', unit: 'kg', category: 'コーヒー豆', supplierKey: 'bean', unitCost: 2900, unitPrice: 5200, moq: 10, orderMultiple: 5, base: [5, 3], ramp: 1.7 },
  { key: 'dec', sku: 'CB-DEC', name: 'デカフェ コロンビア 1kg', unit: 'kg', category: 'コーヒー豆', supplierKey: 'bean', unitCost: 3000, unitPrice: 5400, moq: 10, orderMultiple: 5, base: [0.6, 2], opening: [150, 40] },
  { key: 'oat', sku: 'MK-OAT', name: 'オーツミルク 1L', unit: '本', category: 'ミルク', supplierKey: 'milk', unitCost: 280, unitPrice: 520, moq: 24, orderMultiple: 12, base: [40, 32] },
  { key: 'whl', sku: 'MK-WHL', name: '牛乳 1L', unit: '本', category: 'ミルク', supplierKey: 'milk', unitCost: 210, unitPrice: 380, moq: 24, orderMultiple: 12, base: [60, 50] },
  { key: 'c12', sku: 'CP-12', name: '紙カップ 12oz（1000個）', unit: '箱', category: '包装資材', supplierKey: 'pack', unitCost: 4800, unitPrice: null, moq: 5, orderMultiple: 5, base: [1.3, 1.1] },
  { key: 'c16', sku: 'CP-16', name: '紙カップ 16oz（1000個）', unit: '箱', category: '包装資材', supplierKey: 'pack', unitCost: 5600, unitPrice: null, moq: 5, orderMultiple: 5, base: [0.9, 0.7] },
  { key: 'l12', sku: 'LD-12', name: 'リッド 12oz（1000個）', unit: '箱', category: '包装資材', supplierKey: 'pack', unitCost: 3900, unitPrice: null, moq: 5, orderMultiple: 5, base: [1.3, 1.1] },
  { key: 'stw', sku: 'ST-PAP', name: '紙ストロー（5000本）', unit: '箱', category: '包装資材', supplierKey: 'pack', unitCost: 2800, unitPrice: null, moq: 2, orderMultiple: 1, base: [0.5, 0.4] },
  { key: 'van', sku: 'SY-VAN', name: 'バニラシロップ 750ml', unit: '本', category: 'シロップ', supplierKey: 'flavor', unitCost: 1100, unitPrice: 1900, moq: 6, orderMultiple: 6, base: [3, 2] },
  { key: 'car', sku: 'SY-CAR', name: 'キャラメルシロップ 750ml', unit: '本', category: 'シロップ', supplierKey: 'flavor', unitCost: 1100, unitPrice: 1900, moq: 6, orderMultiple: 6, base: [2.5, 2] },
  { key: 'haz', sku: 'SY-HAZ', name: 'ヘーゼルナッツシロップ 750ml', unit: '本', category: 'シロップ', supplierKey: 'flavor', unitCost: 1200, unitPrice: 1900, moq: 6, orderMultiple: 6, base: [0, 0], opening: [60, 0] },
  { key: 'mat', sku: 'TE-MAT', name: '抹茶パウダー 500g', unit: '袋', category: 'パウダー', supplierKey: 'flavor', unitCost: 4200, unitPrice: 7600, moq: 4, orderMultiple: 2, base: [1.5, 1], ramp: 1.5 },
  { key: 'crs', sku: 'FD-CRS', name: 'クロワッサン 冷凍（40個）', unit: '箱', category: 'ベーカリー', supplierKey: 'bakery', unitCost: 5200, unitPrice: 12000, moq: 2, orderMultiple: 1, base: [2, 1.5] },
  { key: 'muf', sku: 'FD-MUF', name: 'マフィン 冷凍（24個）', unit: '箱', category: 'ベーカリー', supplierKey: 'bakery', unitCost: 3600, unitPrice: 8400, moq: 2, orderMultiple: 1, base: [1.5, 1.2] },
  { key: 'flt', sku: 'EQ-FLT', name: 'エスプレッソ用フィルター', unit: '個', category: '備品', supplierKey: 'flavor', unitCost: 1800, unitPrice: null, moq: 10, orderMultiple: 10, base: [0.12, 0.1], opening: [80, 6] },
];

const HISTORY_DAYS = 120;
/** Mon … Sun relative demand: weekends busier. Index by Date.getUTCDay(). */
const WEEKDAY = [1.25, 0.9, 0.92, 0.95, 0.97, 1.05, 1.3];

export function generateScmSample(today: string, seed = 20261003): ScmSampleData {
  const next = random(seed);
  const normal = () => {
    const u = Math.max(1e-9, next());
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * next());
  };
  const start = dayNumber(today) - HISTORY_DAYS;
  const dayOf = (offset: number) => addDays(today, offset - HISTORY_DAYS);
  const movements: SampleMovement[] = [];
  const orders: SampleOrder[] = [];
  const suppliers = new Map(SUPPLIERS.map(supplier => [supplier.key, supplier]));

  interface Node { item: typeof ITEMS[number]; location: SampleLocation; base: number; stock: number; recent: number[]; incoming: { day: number; quantity: number; order: SampleOrder; line: SampleOrder['lines'][number] }[] }
  const nodes: Node[] = [];
  for (const item of ITEMS) {
    LOCATIONS.forEach((location, index) => {
      const base = item.base[index];
      const lead = suppliers.get(item.supplierKey)!.leadTimeDays;
      const opening = item.opening?.[index] ?? Math.round(base * (lead + 18));
      if (opening <= 0 && base <= 0) return;
      nodes.push({ item, location, base, stock: opening, recent: [], incoming: [] });
      if (opening > 0) movements.push({ itemKey: item.key, locationKey: location.key, kind: 'adjust', quantity: opening, occurredOn: dayOf(0), poKey: null, note: '期首在庫' });
    });
  }

  let orderCount = 0;
  for (let offset = 0; offset < HISTORY_DAYS; offset++) {
    const day = start + offset;
    const date = dayOf(offset);
    const weekdayFactor = WEEKDAY[new Date(day * 86_400_000).getUTCDay()];
    // Receipts land in the morning.
    for (const node of nodes) {
      for (const arrival of node.incoming.filter(entry => entry.day === day)) {
        node.stock += arrival.quantity;
        arrival.line.receivedQuantity += arrival.quantity;
        movements.push({ itemKey: node.item.key, locationKey: node.location.key, kind: 'receipt', quantity: arrival.quantity, occurredOn: date, poKey: arrival.order.key, note: null });
      }
      node.incoming = node.incoming.filter(entry => entry.day !== day);
    }
    // Demand, lost when stock runs out.
    for (const node of nodes) {
      if (node.base <= 0) continue;
      const rampStart = HISTORY_DAYS - 35;
      const ramp = node.item.ramp && offset >= rampStart ? 1 + (node.item.ramp - 1) * ((offset - rampStart) / 35) : 1;
      const mean = node.base * weekdayFactor * ramp;
      const wanted = Math.max(0, Math.round(mean + normal() * Math.sqrt(mean) * 0.9));
      node.recent = [...node.recent.slice(-20), wanted];
      const served = Math.min(wanted, Math.floor(node.stock));
      if (served > 0) {
        node.stock -= served;
        movements.push({ itemKey: node.item.key, locationKey: node.location.key, kind: 'issue', quantity: -served, occurredOn: date, poKey: null, note: null });
      }
    }
    // Weekly ordering on Mondays and Thursdays, grouped by supplier and location.
    const weekday = new Date(day * 86_400_000).getUTCDay();
    if (weekday !== 1 && weekday !== 4) continue;
    const groups = new Map<string, Node[]>();
    for (const node of nodes) {
      if (node.base <= 0) continue;
      const supplier = suppliers.get(node.item.supplierKey)!;
      const lead = supplier.leadTimeDays;
      const position = node.stock + node.incoming.reduce((sum, entry) => sum + entry.quantity, 0);
      // The simulated buyer plans on promised lead times and the last three
      // weeks of demand, which is why late suppliers and fast-rising demand
      // still catch them out.
      const usage = Math.max(node.base, node.recent.length ? node.recent.reduce((sum, value) => sum + value, 0) / node.recent.length : 0);
      const reorderPoint = usage * (lead + 4) + usage * 4;
      if (position > reorderPoint) continue;
      const key = `${supplier.key}:${node.location.key}`;
      groups.set(key, [...(groups.get(key) ?? []), node]);
    }
    for (const [key, members] of groups) {
      const supplier = suppliers.get(key.split(':')[0])!;
      const lead = supplier.leadTimeDays;
      const late = Math.max(-1, Math.round(supplier.delay[0] + normal() * supplier.delay[1]));
      const arrival = day + lead + late;
      orderCount += 1;
      const order: SampleOrder = {
        key: `po${orderCount}`, supplierKey: supplier.key, locationKey: members[0].location.key,
        status: 'received', orderedOn: date, expectedOn: addDays(date, lead), receivedOn: null, lines: [],
      };
      for (const node of members) {
        const position = node.stock + node.incoming.reduce((sum, entry) => sum + entry.quantity, 0);
        const usage = Math.max(node.base, node.recent.length ? node.recent.reduce((sum, value) => sum + value, 0) / node.recent.length : 0);
        const target = usage * (lead + 4 + 14) + usage * 4;
        const step = node.item.orderMultiple;
        const quantity = Math.ceil(Math.max(node.item.moq, target - position) / step) * step;
        const line = { itemKey: node.item.key, quantity, unitCost: node.item.unitCost, receivedQuantity: 0 };
        order.lines.push(line);
        node.incoming.push({ day: arrival, quantity, order, line });
      }
      if (arrival < start + HISTORY_DAYS) order.receivedOn = dayOf(arrival - start);
      else order.status = 'sent';
      orders.push(order);
    }
  }

  // A packaging order that is already late, as the supplier's history predicts.
  orderCount += 1;
  const lateOrdered = addDays(today, -15);
  orders.push({
    key: `po${orderCount}`, supplierKey: 'pack', locationKey: 'osa', status: 'sent', orderedOn: lateOrdered, expectedOn: addDays(lateOrdered, 10), receivedOn: null,
    lines: [{ itemKey: 'c16', quantity: 10, unitCost: 5600, receivedQuantity: 0 }, { itemKey: 'stw', quantity: 4, unitCost: 2800, receivedQuantity: 0 }],
  });
  // Yesterday's count in Osaka found most of the decaf damaged, and no decaf
  // is on its way there: only a transfer from Tokyo can bridge the gap.
  for (const order of orders) {
    if (order.status === 'received' || order.locationKey !== 'osa') continue;
    order.lines = order.lines.filter(line => line.itemKey !== 'dec');
  }
  for (let index = orders.length - 1; index >= 0; index--) if (!orders[index].lines.length) orders.splice(index, 1);
  const decaf = nodes.find(node => node.item.key === 'dec' && node.location.key === 'osa');
  if (decaf && decaf.stock > 3) {
    movements.push({ itemKey: 'dec', locationKey: 'osa', kind: 'adjust', quantity: -(decaf.stock - 3), occurredOn: addDays(today, -1), poKey: null, note: '棚卸差異（破損）' });
  }

  return {
    locations: LOCATIONS,
    suppliers: SUPPLIERS.map(({ key, name, contact, email, leadTimeDays, currency, notes }) => ({ key, name, contact, email, leadTimeDays, currency, notes })),
    items: ITEMS.map(({ key, sku, name, unit, category, supplierKey, unitCost, unitPrice, moq, orderMultiple }) => ({ key, sku, name, unit, category, supplierKey, unitCost, unitPrice, moq, orderMultiple })),
    movements,
    orders,
  };
}
