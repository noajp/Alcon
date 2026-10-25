import type { Deck, Folder, KataFile } from "./types";
import type { Lang } from "@/ActivitySpace/sustainment/slides/kata/i18n";
import { SAMPLES, SAMPLES_EN } from "./samples";

export const SAMPLE_DECK: Deck = {
  title: "sukima 構想整理",
  storyline: "scr",
  slides: [
    {
      id: "s_cover",
      title: "あなたの「好き」を、ひとりで終わらせない",
      layout: "cover",
      content: { cover: { subtitle: "隠れた「好き」を持つ会社員のための、招待制の食卓", meta: "sukima 構想整理 ／ 2026.10" } },
    },
    {
      id: "s_sum",
      title: "隠れた「好き」を持つ会社員を6人の卓で引き合わせ、作品と仲間に変える",
      layout: "statement",
      source: "議事録 12. 決まったこと",
      content: { statement: { figure: "1卓6人", lead: "同じ好きではなく、隣り合う好きで組む。最初は手作業で10卓を回し、うまくいった組み方を仕組みにする。" } },
    },
    {
      id: "s_s1",
      title: "社会人は職場と家の往復になり、利害関係のない仲間ができる場が乏しい",
      layout: "premise",
      source: "議事録 3. 課題意識",
      content: {
        premise: {
          premises: ["職場と家の往復で、利害関係のない関係が育たない", "その結果、寂しさや物足りなさを抱えている"],
          conclusion: "仕事でも家でもない「第三の席」が足りていない",
          figure: "第三の席",
        },
      },
    },
    {
      id: "s_s2",
      title: "マッチングアプリやランニングクラブの伸びは、「会う口実」への需要の表れ",
      layout: "claim3",
      source: "議事録 3. 課題意識",
      content: {
        claim3: {
          points: [
            { head: "恋愛", body: "マッチングアプリは「出会い」そのものを口実にする" },
            { head: "走る", body: "ランニングコミュニティは「一緒に走る」を口実にする" },
            { head: "競う", body: "HYROX は「競技」を口実に人を集める" },
          ],
        },
      },
    },
    {
      id: "s_c1",
      title: "既存の場は「高額でステータス重視」と「気軽だが質がまちまち」に割れている",
      layout: "compare",
      source: "議事録 5. 既存サービスとの位置づけ",
      content: {
        compare: {
          columns: ["高額・ステータス型", "sukima", "気軽・混在型"],
          rows: [
            { label: "例", cells: ["アークヒルズクラブ、Soho House", "招待制の食卓", "Timeleft、異業種交流会"] },
            { label: "参加者の質", cells: ["高い", "面談でそろえる", "まちまち"] },
            { label: "肩書き", cells: ["前に出る", "出さない", "出る"] },
            { label: "組み合わせ", cells: ["偶然", "設計する", "偶然"] },
          ],
          highlight: 1,
          takeaways: ["空いているのは、肩書き抜きで本音を話せて、組み合わせまで設計された場", "参加前から「誰が来るか」が伝わる設計が要る"],
        },
      },
    },
    {
      id: "s_c2",
      title: "飛び出しも安定もしていない「間の層」には、受け皿がない",
      layout: "premise",
      source: "議事録 4. ターゲットとペルソナ",
      content: {
        premise: {
          premises: ["大企業で安定して働きながら、バイオリンが得意", "仲間がいないので、結局は家でひとりで弾いている"],
          conclusion: "才能も情熱もあるのに、それが誰にも届いていない",
          figure: "届かない",
        },
      },
    },
    {
      id: "s_r1",
      title: "発掘から記録までの流れで、「好き」を作品と仲間に変える",
      layout: "steps",
      source: "議事録 6. サービスの流れ",
      content: {
        steps: {
          steps: [
            { head: "発掘", body: "面談で「好き」とこだわりの深さを聞く。入会審査を兼ねる" },
            { head: "結合", body: "相性のよい会員どうしを少人数で引き合わせる" },
            { head: "発表", body: "サロンコンサートや一夜限りのレストランで外に出す" },
            { head: "記録", body: "写真と映像に残し、本人の実績と広告を兼ねる" },
          ],
        },
      },
    },
    {
      id: "s_r2",
      title: "「同じ好き」ではなく「隣り合う好き」で組むと、マウントを避けつつ盛り上がる",
      layout: "compare",
      source: "議事録 10. マッチングの考え方",
      content: {
        compare: {
          columns: ["同じ好き", "隣り合う好き", "遠い好き"],
          rows: [
            { label: "会話の入口", cells: ["すぐある", "ある", "探す必要がある"] },
            { label: "起きやすいこと", cells: ["知識比べ、マウント", "教え合い", "新鮮だが続かない"] },
            { label: "盛り上がり", cells: ["中", "高", "低〜中"] },
            { label: "炎上のリスク", cells: ["一番高い", "低い", "低い"] },
          ],
          highlight: 1,
          takeaways: ["同じ分野の熱狂的な人は1卓に1人まで", "全員が2人以上と重なるようにする", "開かれ度の低い人は発表する側に回す"],
        },
      },
    },
    {
      id: "s_r3",
      title: "会員費で質を証明し、企業向けプログラムで稼ぐ二層構造にする",
      layout: "issue",
      source: "議事録 8. 収益モデル",
      content: {
        issue: {
          pairs: [
            { issue: "会員費（入会金3万円・月額1.5万円）だけでは大きく伸びない", action: "会員の場は、質の証明と実績づくりと割り切る" },
            { issue: "新しい人が入ってくる入口がない", action: "発表イベントを外部にも開き、チケット制にする" },
            { issue: "稼ぐ柱が要る", action: "社員の「好き」を引き出す企業向けプログラムを売る（仮置き：1社 年200〜500万円）" },
          ],
        },
      },
    },
    {
      id: "s_close",
      title: "まず知人10人で一夜限りの食卓を開き、痒みが本当にあるか確かめる",
      layout: "closing",
      source: "議事録 14. 次のアクション",
      content: {
        closing: {
          asks: ["「隠れた好き」を持つ知人を5〜10人紹介してほしい", "最初の食卓の場所（ギャラリー・古民家・閉店後のレストラン）を一緒に探してほしい"],
        },
      },
    },
  ],
};

export const SAMPLE_MINUTES_NAME = "sukima_議事録_20261017.md";

/** SAMPLE_DECK の英語版。id・型・組み立ては同じ */
export const SAMPLE_DECK_EN: Deck = {
  title: "sukima concept overview",
  storyline: "scr",
  slides: [
    {
      id: "s_cover",
      title: "Your passion shouldn't end with you alone",
      layout: "cover",
      content: { cover: { subtitle: "An invitation-only table for employees with hidden passions", meta: "sukima concept overview / Oct 2026" } },
    },
    {
      id: "s_sum",
      title: "We bring employees with hidden passions together at tables of six to create work and companions",
      layout: "statement",
      source: "Minutes §12 Decisions",
      content: { statement: { figure: "6 per table", lead: "We match on adjacent passions, not identical ones. We run the first 10 tables by hand, then turn what works into a system." } },
    },
    {
      id: "s_s1",
      title: "Working adults shuttle between office and home, with few places to make friends outside work",
      layout: "premise",
      source: "Minutes §3 Problem",
      content: {
        premise: {
          premises: ["Shuttling between office and home leaves no room for relationships free of work ties", "As a result, many feel lonely or unfulfilled"],
          conclusion: "What's missing is a \"third seat\" that is neither work nor home",
          figure: "Third seat",
        },
      },
    },
    {
      id: "s_s2",
      title: "The growth of dating apps and running clubs shows demand for a pretext to meet",
      layout: "claim3",
      source: "Minutes §3 Problem",
      content: {
        claim3: {
          points: [
            { head: "Romance", body: "Dating apps use meeting someone as the pretext itself" },
            { head: "Running", body: "Running communities use running together as the pretext" },
            { head: "Competing", body: "HYROX gathers people under the pretext of competition" },
          ],
        },
      },
    },
    {
      id: "s_c1",
      title: "Existing options split into expensive status clubs and casual mixers of uneven quality",
      layout: "compare",
      source: "Minutes §5 Positioning against existing services",
      content: {
        compare: {
          columns: ["Expensive, status-driven", "sukima", "Casual, mixed"],
          rows: [
            { label: "Examples", cells: ["Ark Hills Club, Soho House", "Invitation-only dinners", "Timeleft, cross-industry mixers"] },
            { label: "Member quality", cells: ["High", "Curated through interviews", "Uneven"] },
            { label: "Job titles", cells: ["Front and center", "Left at the door", "Visible"] },
            { label: "The mix", cells: ["Left to chance", "Designed", "Left to chance"] },
          ],
          highlight: 1,
          takeaways: ["The gap is a place to talk candidly without titles, with the mix of people designed", "People need to see who will be there before they join"],
        },
      },
    },
    {
      id: "s_c2",
      title: "The in-between segment, neither jumping ship nor settled, has nowhere to go",
      layout: "premise",
      source: "Minutes §4 Target and persona",
      content: {
        premise: {
          premises: ["A stable job at a large company, and a gifted violinist", "With no one to play with, they end up playing alone at home"],
          conclusion: "The talent and passion are there, but they never reach anyone",
          figure: "Unheard",
        },
      },
    },
    {
      id: "s_r1",
      title: "A flow from discovery to recording turns passions into work and companions",
      layout: "steps",
      source: "Minutes §6 Concept and service model",
      content: {
        steps: {
          steps: [
            { head: "Discover", body: "Interview each person on what they love and how deep it runs. This doubles as screening" },
            { head: "Match", body: "Introduce compatible members to each other in small groups" },
            { head: "Showcase", body: "Take it outside through salon concerts and one-night restaurants" },
            { head: "Record", body: "Capture it in photos and video, building members' track records and advertising the service" },
          ],
        },
      },
    },
    {
      id: "s_r2",
      title: "Matching on adjacent passions, not identical ones, avoids one-upmanship and sparks the best conversations",
      layout: "compare",
      source: "Minutes §10 How we match people",
      content: {
        compare: {
          columns: ["Same passion", "Adjacent passion", "Distant passion"],
          rows: [
            { label: "Conversation starter", cells: ["Instant", "Present", "Needs finding"] },
            { label: "What tends to happen", cells: ["Knowledge contests, one-upmanship", "Teaching each other", "Fresh but short-lived"] },
            { label: "Energy", cells: ["Medium", "High", "Low to medium"] },
            { label: "Risk of things souring", cells: ["Highest", "Low", "Low"] },
          ],
          highlight: 1,
          takeaways: ["No more than one die-hard from the same field per table", "Everyone should overlap with at least two others", "Seat less open people on the performer side"],
        },
      },
    },
    {
      id: "s_r3",
      title: "Membership proves quality while corporate programs earn the money, in a two-tier model",
      layout: "issue",
      source: "Minutes §8 Revenue model (provisional)",
      content: {
        issue: {
          pairs: [
            { issue: "Fees alone (¥30,000 to join, ¥15,000 a month) won't scale", action: "Treat membership as proof of quality and track record" },
            { issue: "There is no entry point for new people", action: "Open ticketed showcase events to outsiders" },
            { issue: "We need a pillar that makes money", action: "Sell corporate programs that draw out employees' passions (placeholder: ¥2–5M per company a year)" },
          ],
        },
      },
    },
    {
      id: "s_close",
      title: "First, host a one-night dinner for 10 acquaintances to test whether the itch is real",
      layout: "closing",
      source: "Minutes §14 Next steps",
      content: {
        closing: {
          asks: ["Introduce us to 5–10 people you know with hidden passions", "Help us find a venue for the first dinner (a gallery, an old townhouse or a restaurant after hours)"],
        },
      },
    },
  ],
};

export const SAMPLE_MINUTES_NAME_EN = "sukima_minutes_20261017.md";

export function seedWorkspace(now: number, lang: Lang = "ja"): { folders: Folder[]; files: KataFile[] } {
  const en = lang === "en";
  const folders: Folder[] = [
    { id: "f_sukima", name: "sukima", open: true },
    { id: "f_session", name: "Session", open: false },
    { id: "f_kata", name: "Kata", open: false },
  ];
  const docName = en ? SAMPLE_MINUTES_NAME_EN : SAMPLE_MINUTES_NAME;
  const chat: KataFile["chat"] = en
    ? [
        { id: "m1", from: "me", text: "Turn this into a concept deck for people who might help us", attachment: docName, at: now - 60000 },
        { id: "m2", from: "kata", text: "I framed the core question as \"whose itch, what itch, and how we reach it\", and built 10 slides in Situation → Complication → Resolution order.", at: now - 50000 },
        { id: "m3", from: "kata", text: "Use \"Structure\" at the top right to change the overall flow and how each page is built, and \"Design\" to change the look. Add as many looks as you like; Kata blends them element by element.", at: now - 40000 },
      ]
    : [
        { id: "m1", from: "me", text: "これで、協力してくれそうな人向けの構想資料にして", attachment: docName, at: now - 60000 },
        { id: "m2", from: "kata", text: "論点を「誰の、どんな痒みに、どう届けるか」に置いて、状況→難しさ→解決の順で10枚組みました。", at: now - 50000 },
        { id: "m3", from: "kata", text: "右上の「論理構成」で全体の並びと各ページの組み方を、「デザイン」で世界観を直せます。気になる世界観をいくつ足しても、要素ごとに混ぜて反映します。", at: now - 40000 },
      ];
  const files: KataFile[] = [
    {
      id: "d_sukima",
      name: en ? "Concept overview" : "構想整理",
      folderId: "f_sukima",
      deck: { ...(en ? SAMPLE_DECK_EN : SAMPLE_DECK), sourceDoc: { name: docName, text: (en ? SAMPLES_EN : SAMPLES)[0].text } },
      mix: { selected: ["forest", "noir"], pins: {}, offset: 0 },
      chat,
      updatedAt: now,
    },
  ];
  return { folders, files };
}
