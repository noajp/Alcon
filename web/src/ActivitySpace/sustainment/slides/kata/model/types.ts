// デッキの形。AI もプランナーもこの JSON だけを出し、描画は部品が担う。

export type LayoutId =
  | "cover"
  | "statement"
  | "compare"
  | "premise"
  | "claim3"
  | "issue"
  | "steps"
  | "matrix"
  | "chart"
  | "summary"
  | "agenda"
  | "grid"
  | "kpi"
  | "closing";

export type StorylineId = "scr" | "pyramid" | "skyrain" | "issue" | "scqa";

export interface CompareContent {
  columns: string[];
  rows: { label: string; cells: string[] }[];
  highlight: number;
  takeaways: string[];
}
export interface PremiseContent {
  premises: string[];
  conclusion: string;
  figure: string;
}
export interface Claim3Content {
  points: { head: string; body: string }[];
}
export interface IssueContent {
  pairs: { issue: string; action: string }[];
}
export interface StepsContent {
  steps: { head: string; body: string }[];
}
export interface MatrixContent {
  /** 横軸：左の端・右の端 */
  x: { low: string; high: string };
  /** 縦軸：下の端・上の端 */
  y: { low: string; high: string };
  /** 左上・右上・左下・右下 */
  cells: { head: string; body: string }[];
  highlight: number;
}
/** グラフの種類。ゼラズニーの5つの比較（構成・項目・時系列・度数分布・相関）と FT Visual Vocabulary の「増減」に対応 */
export type ChartKind = "share" | "bar" | "line" | "column" | "scatter" | "waterfall";
export interface ChartContent {
  kind: ChartKind;
  /** 項目（横軸・行の名前）。相関では各点の名前 */
  categories: string[];
  /** 系列。相関では 0番目が横軸、1番目が縦軸 */
  series: { name: string; values: number[] }[];
  unit: string;
  /** 立たせる項目の番号（-1 なら無し） */
  highlight: number;
  /** so what：このグラフから言えること */
  takeaway: string;
}
/** エグゼクティブサマリー（A4一枚サマリー）：結論と、それを支える要点 */
export interface SummaryContent {
  /** ref：指しているページの id。あれば「p.N」は描くときに今の並びから出す（page は無いときの控え） */
  points: { head: string; body: string; page: string; ref?: string }[];
}
/** 目次（中扉にも使う：current で今の章を立たせる。-1 なら目次） */
export interface AgendaContent {
  /** ref：その章の中扉のページ id（ページ番号は描くときに数える） */
  items: { head: string; page: string; ref?: string }[];
  current: number;
}
/** 4〜9個を同じ重さで並べる一覧（原則・資産・地域など） */
export interface GridContent {
  cards: { head: string; body: string }[];
}
/** 大きな数字を2〜4個並べる */
export interface KpiContent {
  stats: { value: string; label: string; note: string }[];
}
export interface StatementContent {
  lead: string;
  figure: string;
}
export interface CoverContent {
  subtitle: string;
  meta: string;
}
export interface ClosingContent {
  asks: string[];
}

export interface SlideContent {
  cover?: CoverContent;
  statement?: StatementContent;
  compare?: CompareContent;
  premise?: PremiseContent;
  claim3?: Claim3Content;
  issue?: IssueContent;
  steps?: StepsContent;
  matrix?: MatrixContent;
  chart?: ChartContent;
  summary?: SummaryContent;
  agenda?: AgendaContent;
  grid?: GridContent;
  kpi?: KpiContent;
  closing?: ClosingContent;
}

/** 色：世界観の色の名前（世界観を変えると追従する）か、#RRGGBB */
export type ColorRef = "ink" | "sub" | "accent" | "tint" | "block" | "num" | "bg" | "line" | "onAccent" | "none" | `#${string}`;
export type FontRef = "display" | "body" | "sans" | "serif" | "mono";
export type ObjectKind = "text" | "rect" | "ellipse" | "line" | "arrow" | "image";

/** 型の上に自由に置くもの（文字・図形・線・画像）。座標は 1280×720 の原寸。線は (x,y) から (x+w,y+h) へ引く */
export interface SlideObject {
  id: string;
  kind: ObjectKind;
  x: number;
  y: number;
  w: number;
  h: number;
  fill: ColorRef;
  stroke: ColorRef;
  strokeWidth: number;
  dash?: boolean;
  radius?: number;
  /** 型の文字の後ろに置く */
  behind?: boolean;
  text?: string;
  textStyle?: TextStyle;
  /** 画像（data URL） */
  src?: string;
  /** 画像の元の縦横比（幅÷高さ）。書き出しで切り抜くのに使う */
  ratio?: number;
}

/** 文字の見た目の上書き。型の文字（パスごと）にも、自由に置いた文字にも使う */
export interface TextStyle {
  font?: FontRef;
  /** 原寸での文字の大きさ（px） */
  size?: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  color?: ColorRef;
  align?: "left" | "center" | "right";
}

export interface Slide {
  id: string;
  /** 主張（タイトル）。結論で書く */
  title: string;
  layout: LayoutId;
  /** 手で付け替えた役割。無ければ語る順番の型から決まる */
  role?: string;
  /** 根拠の出どころ（議事録のどこから来たか） */
  source?: string;
  content: SlideContent;
  /** 型の上に自由に置いたもの */
  objects?: SlideObject[];
  /** 型の文字の見た目の上書き。キーは文字のパス（"title"、"content.claim3.points.0.head" など） */
  styles?: Record<string, TextStyle>;
}

export interface Deck {
  title: string;
  /** 話す資料（発表）か、読む資料（Slidedocs：配って読ませる）か。赤入れの基準が変わる */
  mode?: "present" | "read";
  storyline: StorylineId;
  slides: Slide[];
  /** このデッキを組んだ元の文章。デッキと一緒に取り消し・やり直しされる */
  sourceDoc?: { name: string; text: string };
}

export interface ChatMessage {
  id: string;
  from: "me" | "kata";
  text: string;
  attachment?: string;
  at: number;
}

export interface KataFile {
  id: string;
  name: string;
  folderId: string;
  deck: Deck;
  mix: MixState;
  chat: ChatMessage[];
  updatedAt: number;
}

export interface Folder {
  id: string;
  name: string;
  open: boolean;
}

/** 世界観の5要素 */
export type MixElement = "ground" | "type" | "accent" | "number" | "shape";

export interface LookTokens {
  ground: { bg: string; ink: string; sub: string; line: string; dark: boolean };
  type: { display: string; weight: number; body: string; tracking: string };
  accent: { accent: string; tint: string; onAccent: string };
  number: { block: string; num: string };
  shape: { radius: number };
}

export interface Look {
  id: string;
  name: string;
  source: "official" | "mine" | "import";
  tags: string[];
  tokens: LookTokens;
}

export interface MixState {
  selected: string[];
  pins: Partial<Record<MixElement, string>>;
  offset: number;
}
