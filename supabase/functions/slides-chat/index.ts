import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import Anthropic from 'npm:@anthropic-ai/sdk@0.135.0';
import { betaZodOutputFormat } from 'npm:@anthropic-ai/sdk@0.135.0/helpers/beta/zod';
import { z } from 'npm:zod@4.6.7';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.86.2';

// The Slides editor's AI path (ADR 0042): Claude returns the deck's JSON
// only — pages, their logic and content — and the editor's own parts draw it.
// The editor turns the returned slides into its deck (buildContent /
// normalizeSlide) itself, so this function shares no code with the web app.

const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Content-Type': 'application/json' };
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });

const LAYOUT_IDS = ["cover", "statement", "compare", "premise", "claim3", "issue", "steps", "matrix", "closing", "chart", "summary", "agenda", "grid", "kpi"] as const;

const head = z.object({ head: z.string(), body: z.string() });
const SlideSchema = z.object({
  title: z.string(),
  layout: z.enum(LAYOUT_IDS),
  source: z.string().nullable(),
  cover: z.object({ subtitle: z.string(), meta: z.string() }).nullable(),
  statement: z.object({ lead: z.string(), figure: z.string() }).nullable(),
  compare: z
    .object({
      columns: z.array(z.string()),
      rows: z.array(z.object({ label: z.string(), cells: z.array(z.string()) })),
      highlight: z.number().int(),
      takeaways: z.array(z.string()),
    })
    .nullable(),
  premise: z.object({ premises: z.array(z.string()), conclusion: z.string(), figure: z.string() }).nullable(),
  claim3: z.object({ points: z.array(head) }).nullable(),
  issue: z.object({ pairs: z.array(z.object({ issue: z.string(), action: z.string() })) }).nullable(),
  steps: z.object({ steps: z.array(head) }).nullable(),
  matrix: z
    .object({
      x: z.object({ low: z.string(), high: z.string() }),
      y: z.object({ low: z.string(), high: z.string() }),
      cells: z.array(head),
      highlight: z.number().int(),
    })
    .nullable(),
  closing: z.object({ asks: z.array(z.string()) }).nullable(),
  chart: z
    .object({
      kind: z.enum(["share", "bar", "line", "column", "scatter", "waterfall"]),
      categories: z.array(z.string()),
      series: z.array(z.object({ name: z.string(), values: z.array(z.number()) })),
      unit: z.string(),
      highlight: z.number().int(),
      takeaway: z.string(),
    })
    .nullable(),
  summary: z.object({ points: z.array(z.object({ head: z.string(), body: z.string(), page: z.string() })) }).nullable(),
  agenda: z.object({ items: z.array(z.object({ head: z.string(), page: z.string() })), current: z.number().int() }).nullable(),
  grid: z.object({ cards: z.array(head) }).nullable(),
  kpi: z.object({ stats: z.array(z.object({ value: z.string(), label: z.string(), note: z.string() })) }).nullable(),
});
const ResultSchema = z.object({
  reply: z.string(),
  changed: z.boolean(),
  storyline: z.enum(["scr", "pyramid", "skyrain", "issue", "scqa"]),
  slides: z.array(SlideSchema),
  current: z.number().int(),
});

const SYSTEM = `あなたは Clayware の資料エディタ（Slides）の中で働く、戦略コンサルの資料づくりの名手です。利用者の依頼に応じて、スライドデッキの JSON を返します。描画は別の部品が行うので、あなたは中身と構造だけを決めます。

## デッキの規則
- 1枚に言いたいことは1つ。title はそのページの結論を一文で、言い切りの形で書く（「です・ます」で終わらせない、名詞で止めない、60字以内）。title だけを通して読むと1本の話になること。
- 先頭は cover、最後は「読み手に決めてほしいこと・お願い」を書く closing にする。
- storyline は語る順番の型。scr＝状況→難しさ→解決、pyramid＝結論→根拠、skyrain＝空→雨→傘、issue＝課題→原因→解決、scqa＝状況→難しさ→問い→答え（Situation → Complication → Question → Answer）。依頼に合うものを選ぶ。
- 各ページの layout は、主張の形に合わせて選ぶ。compare＝同じ観点で複数を比べ1つを立たせる（highlight は立たせる列の番号、0 始まり）、premise＝事実（premises）から言えること（conclusion と短い figure）、claim3＝主張を3つの根拠で支える、issue＝課題と打ち手の対、steps＝段階の流れ、statement＝大きな一言（figure、短い数字や語）と一文（lead）、matrix＝2つの軸で位置づける 2×2（cells は左上・右上・左下・右下の順、highlight は立たせる象限）、chart＝データのグラフ（kind は見せたいことで選ぶ：share＝構成比、bar＝項目の順位、line/column＝時間の推移、column＝度数分布にも使う、scatter＝相関（series の 0 番目が横軸・1 番目が縦軸）、waterfall＝増減の内訳。categories と series の values は同じ数、unit は単位、highlight は立たせる項目の番号で無ければ -1、takeaway はグラフから言える so what を一文で）、summary＝エグゼクティブサマリー（title に全体の結論を一文で書き、points に3〜4個の要点を head と body で書き、page にはその要点を詳しく述べるページの番号を「p.3」のように書く）、agenda＝目次（items に章の見出しとページ、current は -1。章の始めに置く中扉では current にその章の番号）、grid＝3〜12個を同じ重さで並べる一覧（原則・地域・打ち手など。cards に head と body）、kpi＝大きな数字を2〜4個（stats に value＝数字、label＝何の数字か、note＝意味や比較）。長い文書（章が3つ以上）は、表紙→エグゼクティブサマリー→目次→章ごとに中扉と本文→結び、の順に組む。
- slide には、その layout と同じ名前の欄だけを埋め、他の欄は null にする。
- source には、元の文章のどこから来たかを短く書く（例「議事録 5. 位置づけ」）。元が無ければ null。
- 元の文章に無い数字や事実を作らない。足りないものは「仮置き」と書くか、欄を空にする。
- 用語は1資料で1つにそろえる。

## 言語
- スライドの文字（title・各欄）と reply は、利用者の依頼の言語で書く。依頼が日本語なら日本語、英語なら英語。依頼から決めにくいとき（貼った資料だけなど）は、その資料や今のデッキの言語に合わせる。
- Write all slide text and the reply in the language of the user's request: Japanese input → Japanese, English input → English. If unclear, follow the language of the pasted material or the current deck.
- 「日本語で」「in English」のように言語を指定されたら、資料が別の言語でもその言語で書く（訳す）。固有名詞・数字・引用は原文に忠実にし、資料に無い評価や意見を足さない。
- If the user names a language ("in Japanese", "英語で"), write in it even when the material is in another language. Translate faithfully: keep names, numbers and quoted terms accurate, and don't add opinions the source doesn't contain.

## 返し方
- reply は利用者への短い返事（依頼と同じ言語で、2〜3文）。何を変えたかを書く。
- 依頼がデッキを変えるものなら changed を true にして、変えた後のデッキ全体を slides に入れる。変えない依頼（質問など）なら changed を false にして、slides には今のデッキをそのまま入れる。
- current は、変えた後に画面に出すページの番号（0 始まり）。`;


interface Skill { terms: { from: string; to: string }[]; banned: string[]; maxTitle?: number | null }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers });
  if (req.method !== 'POST') return reply({ error: 'Method not allowed' }, 405);
  const authorization = req.headers.get('Authorization');
  if (!authorization) return reply({ error: 'Sign in to use AI.' }, 401);
  const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authorization } } });
  const { data: { user }, error: authError } = await client.auth.getUser();
  if (authError || !user) return reply({ error: 'Sign in again.' }, 401);
  if (!Deno.env.get('ANTHROPIC_API_KEY')) return reply({ error: 'AI is not configured.' }, 503);
  const text = await req.text();
  // The deck's source document travels with it but is not sent to the model.
  if (text.length > 4_000_000) return reply({ error: 'Request too large.' }, 413);
  type Body = { deck: { title?: string; slides: unknown[]; sourceDoc?: unknown }; current: number; text: string; skills?: Skill[]; lang?: string };
  let body: Body;
  try { body = JSON.parse(text) as Body; } catch { return reply({ error: 'Invalid input' }, 400); }
  const say = (ja: string, en: string) => (body?.lang === 'en' ? en : ja);
  if (!body || !body.deck || !Array.isArray(body.deck.slides) || typeof body.text !== 'string') return reply({ error: say('入力が正しくありません', 'Invalid input') }, 400);
  const { current } = body;
  const deck = { ...body.deck, sourceDoc: undefined };
  // What reaches the model: a deck and a request, not a whole document.
  if (JSON.stringify(deck).length + body.text.length > 400_000) return reply({ error: say('資料か依頼が長すぎます', 'The deck or the request is too long') }, 413);
  const skills = Array.isArray(body.skills) ? body.skills.filter((k) => k && Array.isArray(k.terms) && Array.isArray(k.banned)) : [];
  const rules = skills
    .flatMap((k) => [
      ...k.terms.filter((t) => t.from && t.to && t.from !== t.to).map((t) => `「${t.from}」ではなく「${t.to}」と書く`),
      ...k.banned.filter(Boolean).map((w) => `「${w}」は使わない`),
      ...(k.maxTitle ? [`タイトルは ${k.maxTitle} 字以内`] : []),
    ])
    .map((r) => `- ${r}`)
    .join('\n');
  const anthropic = new Anthropic();
  try {
    const response = await anthropic.beta.messages.parse({
      model: 'claude-opus-5-5',
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium', format: betaZodOutputFormat(ResultSchema) },
      system: SYSTEM,
      messages: [{
        role: 'user',
        content: `## Current deck (slide on screen: index ${current})\n${JSON.stringify(deck)}\n\n${rules ? `## Writing rules from the user (must follow)\n${rules}\n\n` : ''}## User request\n${body.text}`,
      }],
    });
    if (response.stop_reason === 'refusal') {
      return reply({ reply: say('この依頼には答えられませんでした。言い方を変えてもう一度送ってください。', "I couldn't answer this request. Please rephrase it and send again.") });
    }
    const out = response.parsed_output;
    if (!out) return reply({ error: say('返事を読み取れませんでした', "Couldn't read the reply") }, 502);
    if (!out.changed || !out.slides.length) return reply({ reply: out.reply });
    return reply({ reply: out.reply, storyline: out.storyline, slides: out.slides, current: out.current });
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) return reply({ error: say('混み合っています', 'The service is busy') }, 429);
    if (error instanceof Anthropic.APIError) return reply({ error: `API ${error.status}` }, 502);
    return reply({ error: say('うまく組めませんでした', 'Could not build the deck') }, 500);
  }
});
