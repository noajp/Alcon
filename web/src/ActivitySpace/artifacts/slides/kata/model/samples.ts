// 初めての人が、すぐに試せる見本の文章
import type { Lang } from "@/ActivitySpace/artifacts/slides/kata/i18n";
export interface SampleText {
  id: string;
  name: string;
  desc: string;
  text: string;
}

export const SAMPLES: SampleText[] = [
  { id: "minutes", name: "議事録", desc: "招待制コミュニティの構想会議", text: "# 議事録：「好き」でつながる招待制コミュニティ構想\n\n- 日時：2026年10月17日（土）20:00〜21:35 ごろ\n- 参加：TAKANORI（ヒナとの事前の議論を持ち込み）、Claude（壁打ち役）\n- 目的：TAKANORI とヒナの2人で、社会にどんな価値を提供できるかを見極める\n- 仮称：sukima（仕事と家のあいだにある、大人の余白）\n\n---\n\n## 1. 前提：2人のプロフィール\n\n| 観点 | ヒナ | TAKANORI |\n|---|---|---|\n| 経歴 | アメリカン大学でマーケティングを専攻、看護学も学んだ | システムエンジニア |\n| 現在の仕事 | 人材紹介の法人営業（リクルーティングアドバイザー）、人事コンサル的な業務 | システム開発 |\n| 志向 | 人と人をつなぎ、人の「ワクワク」を引き出す場をつくりたい | クリエイティブが好きで、テクノロジーの素養もある |\n\n- 役割分担の見立て：ヒナが「人を見て、つなぐ」、TAKANORI が「仕組みと見せ方をつくる」\n\n## 2. 固まっている外枠\n\n- 不特定多数ではなく、プライベート性が担保された空間を提供する（参考：NOT A HOTEL）\n- 人がワクワクする体験を届ける\n- テクノロジーは主役ではなく補助として使う\n- ブランドとクリエイティブをしっかり確立する\n- イベント運営会社や広告代理店のような受託ではなく、自分たちで生み出して届ける\n- 表面的なものではなく、まだ満たされていない「痒いところ」に届く本質的な価値を目指す\n\n## 3. 課題意識\n\n- 社会人は職場と家の往復になりやすく、利害関係のないコミュニティが乏しい。その結果、寂しさや物足りなさを抱えている\n- マッチングアプリ、ランニングコミュニティ、HYROX が伸びているのは、この需要の表れ\n- これらはどれも「出会うための口実」（恋愛、走る、競技）を提供している\n- フリーランスやインフルエンサーの増加は、モヤモヤを行動に移した人が増えた結果と見ている。一方で「何もしない安定」を選ぶ人もいて、二極化が進んでいる\n\n## 4. ターゲットとペルソナ\n\n- 狙うのは、飛び出しもせず、安定にも振り切れていない「間で揺れている層」\n  - 数が多いのに、受け皿になる場がほとんどない\n- その中でも、本気の「好き」・こだわり・センスを持っている人\n- ペルソナ例：大企業で安定して働く会社員。バイオリンが得意で音楽活動もしたいが、仲間がいない。結局、家でひとりで弾いていて、アウトプットにつながっていない\n- 痒み：才能や情熱があるのに、それが誰にも届いていない\n\n## 5. 既存サービスとの位置づけ\n\n- 会員制・ハイクラス向けという枠だけなら、市場はかなり埋まっている\n- 既存サービスは2つに分かれている\n  - 高額でステータス重視の型：アークヒルズクラブ、Soho House、紹介制レストランなど\n  - 気軽だが参加者の質がまちまちな型：Timeleft、異業種交流会、ランニングクラブなど\n- 空いているのは、30代前後の上質な社会人が肩書き抜きで本音を話せて、人の組み合わせまで設計されている場\n- 調べればすぐ中身が分かる時代なので、参加前から価値が伝わる設計が必要\n  - 誰が来るか、なぜその組み合わせか、何が持ち帰れるか、誰が主宰しているか\n\n## 6. コンセプトとサービスの形\n\n- コンセプト：会社員の隠れた「好き」を、作品と仲間に変える場所\n- 事前に伝える約束（案）：「あなたの『好き』を、ひとりで終わらせない」\n- サービスの流れ\n  1. 発掘：ヒナが面談で「好き」とこだわりの深さを聞く。これが入会審査を兼ねる\n  2. 結合：相性のよいメンバー同士を少人数で引き合わせる\n  3. 発表：サロンコンサート、小さな展示、一夜限りのレストランなど、外に出す場をつくる\n  4. 記録と発信：TAKANORI のクリエイティブで写真・映像に残す。本人の実績と、サービスの広告を兼ねる\n- ジャンルの掛け合わせ例\n  - 料理 × ワイン × 写真 → 一夜限りのレストラン\n  - 音楽 × 建築 × 映像 → 古民家のサロンコンサート\n  - 文章 × イラスト → ZINE（小冊子）と朗読会\n  - アート × 空間 → 閉店後のギャラリーでの一晩だけの展示\n\n## 7. 縁が循環する仕組みと「場所」\n\n- 出会う → 体験する → 仲間になる → 次を企画する → 新しい人が来る、の循環をつくる\n- メンバー自身が企画する側に回るほど、2人の手間が減り、コミュニティが自然に広がる\n- 体験できる場所があると、ブランドが目に見え、縁が途切れにくく、収益源も増える\n- ただし固定費が重いので、場所は段階的に持つ\n  - 最初：ギャラリー、古民家、閉店後のレストランなどを毎回借りる\n  - 次：相性のよかった場所と提携する\n  - 軌道に乗ったら：自分たちの拠点を持つ\n- 「場所は前日まで秘密」という演出もありえる\n\n## 8. 収益モデル（仮置き）\n\n- 会員費（土台）：入会金3万円、月額1.5万円\n- 発表イベント：外部も参加できるチケット制（5,000〜1万円）。新規会員の入口になる\n- 企業向けプログラム（一番の伸びしろ）：社員の「好き」や才能を引き出すプログラムを、人的資本経営や社内活性化として販売する（1社あたり年200〜500万円を想定）\n- 作品・スキルの仲介（将来）：メンバーの作品・演奏・撮影を企業やイベントにつなぎ、手数料を受け取る\n- 会員費だけで大きく伸ばすのは難しい。会員コミュニティは質の証明と実績づくりと割り切り、企業向けで稼ぐ二層構造にする\n- 数字はすべて仮置きで、検証が必要\n\n## 9. ブランドの方向性\n\n- 最初のデモは Timeleft のようなポップな方向で作った\n- その後、方向を修正した\n  - 尖りすぎず、出会い目的の層に刺さるほどマス向けにもしない\n  - 少し格式があり、洗練された感覚にする\n  - 参考：Arc'teryx や On のコミュニティのクリエイティブ、theuglyhouse.studios\n- 修正後のトーン：ほぼ黒と生成りの2色、アクセントにライムを1色。見出しは明朝体、ラベルは等幅の英字\n- 「出会い」は前に出さず、「好きを深く持つ大人の食卓」として打ち出す\n- ハウスルールを明記する（招待制、1卓6人、場所は前日に連絡、名刺は出さない、営業と勧誘はお断り）\n\n## 10. マッチングの考え方\n\n- 「同じ好き」ではなく「隣り合う好き」で組む\n  - 同じ：知識比べやマウント合戦になりやすく、炎上のリスクが一番高い\n  - 隣り合う：共通の入口がありつつ教え合える。一番盛り上がる\n  - 遠い：新鮮だが、話が続かないことがある\n- MBTI は話題の入口として使い、マッチングの中心には置かない。見るのは会話のスタイル\n  - 話し手か聞き手か、深掘りする人か広げる人か、場を回す人か乗る人か\n- 炎上を防ぐ一番の指標は「開かれ度」（自分と違う楽しみ方を面白がれるか）。面談で見極める\n  - 開かれ度が高い人：どんなにニッチでも通常の卓へ\n  - こだわりが強く閉じ気味の人：発表する側（奏者、シェフなど）に回ってもらう\n  - 明らかに合わない人：入会をお断りする\n- 1卓6人の組み方\n  1. ゆるい共通テーマを1つ置く\n  2. 全員が少なくとも2人と何かしら重なるようにする\n  3. 同じ分野の熱狂的な人は1卓に1人まで\n  4. つくる側と味わう側を混ぜる\n  5. 場を回す人を1〜2人、聞き手を2人ほど入れる\n  6. 前に同じ卓だった人とは組まない\n- 会の後に「また会いたい」を互いに選び、両方が選んだときだけつながる。このデータが、そのままアルゴリズムの精度と他社が真似できない資産になる\n\n## 11. 作ったもの\n\n- LP とアプリ導入画面のデモ（Claude のデザインキャンバス上）\n  - LP：コンセプト、参加のステップ、対象の人、体験の例、縁の循環、ハウスルール、料金\n  - 導入画面：求めるもの → 好き（最大3つ）→ その好きとの距離 → 業界 → 年代 → 連絡先 → 受付完了（面談へ）\n\n## 12. 決まったこと\n\n- 事業の核は「隠れた『好き』を持つ会社員どうしを、隣り合う好きで引き合わせ、体験と作品にする招待制の場」\n- ターゲットは「飛び出しも安定もしていない、本気の好きを持つ層」\n- ブランドは、ポップではなく、静かで格式のある方向で進める\n- 最初は手作業で回し、仕組み化は後からにする\n\n## 13. 未決事項\n\n- ブランド名（sukima は仮称）\n- 最初に絞るジャンル（「食 × ◯◯」から始める案が有力）\n- 価格（入会金と月額は仮置き）\n- 企業向けプログラムの中身と、最初の売り先\n- 場所の確保の仕方（借りる先の候補）\n\n## 14. 次のアクション\n\n| 担当 | 内容 |\n|---|---|\n| ヒナ | 仕事でよく聞く「本当の悩み」を書き出す |\n| 2人 | 周りで「隠れた好き」を持つ人を5〜10人書き出し、1人ずつ話を聞いて、痒みが本当にあるか確かめる |\n| 2人 | 知人10人規模で、一夜限りの食卓を1回開き、参加者の反応を見る |\n| ヒナ | 最初の10卓は、スプレッドシートを見ながら手で組む |\n| TAKANORI | 手で組んでうまくいったパターンを、マッチングのルールとシステムに落とす |\n| TAKANORI | 実際の食卓や空間の写真を撮りため、LP の画像の差し替えに使う |\n" },
  { id: "pitch", name: "ピッチのメモ", desc: "町工場向け SaaS の資金調達", text: "# 町工場の受発注を、写真1枚で\n\n## 課題\n- 中小の町工場は、見積もり依頼の8割をFAXと電話で受けている\n- 図面の読み違いで、やり直しが月に平均4件出ている\n- 若手が入らず、見積もりできる人が社長1人しかいない\n\n## 解決策\n1. 図面を写真で撮る\n2. AIが寸法と材質を読み取り、見積もりの下書きを作る\n3. 社長が確認して、そのまま発注者に返す\n\n## 市場\n| 指標 | 数字 | 出典 |\n|---|---|---|\n| 国内の町工場 | 約3.8万社 | 経産省 |\n| 1社あたりの見積もり件数 | 月120件 | 自社調査 |\n| 狙える市場 | 年460億円 | 試算 |\n\n## 競合との違い\n- 大手の受発注SaaS：月額が高く、図面を読む機能が無い\n- 見積もり代行：速いが、1件ごとに費用がかかる\n- 私たち：写真1枚で、月額3万円から\n\n## トラクション\n- 試験導入した12社で、見積もり時間が平均62%短くなった\n- 有料化した5社は、半年で1社も解約していない\n\n## お願い\n- シードで1億円を調達したい\n- 金属加工の業界団体を紹介してほしい\n" },
  { id: "memo", name: "見出しの無いメモ", desc: "来期の中途採用計画", text: "来期の中途採用、エンジニアを12人採りたい。今期は8人目標で5人しか採れていない。\nエージェント経由の内定承諾率が40%と低い。競合のSaaS企業に年収で負けている。面接から内定まで平均3週間かかっていて、その間に他社に決まる。\n打ち手は3つ考えている。1つ目は面接を2回に減らして、内定まで1週間にする。2つ目はリファラル採用に紹介料30万円を出す。3つ目は技術広報としてブログと勉強会を月1で出す。\n予算は今期の1.3倍、1,800万円を見込む。役員会で決めてほしいのは、年収レンジを上げるかどうかと、リファラルの紹介料の承認。\n" },
];

const MINUTES_EN = `# Minutes: An invitation-only community built around what people love

- Date: Sat, Oct 17, 2026, approx. 20:00–21:35
- Attendees: TAKANORI (bringing in an earlier discussion with Hina), Claude (sounding board)
- Purpose: Work out what value TAKANORI and Hina, as a pair, can offer society
- Working name: sukima (the grown-up space between work and home)

---

## 1. Background: who the two of us are

| Dimension | Hina | TAKANORI |
|---|---|---|
| Background | Majored in marketing at American University; also studied nursing | Systems engineer |
| Current role | Corporate sales at a recruitment agency (recruiting advisor), plus HR-consulting work | Software development |
| Drive | Wants to connect people and create spaces that bring out their excitement | Loves creative work and has a technology background |

- Proposed split: Hina reads people and connects them; TAKANORI builds the system and how it looks

## 2. What is already settled

- Offer a curated private space rather than something open to everyone (reference: NOT A HOTEL)
- Deliver experiences that genuinely excite people
- Use technology as a support, not the star
- Build a strong brand and creative identity
- Create and deliver our own offering, rather than taking client work like an events firm or ad agency
- Aim for substantive value that reaches an unmet "itch", not something superficial

## 3. Problem

- Working adults shuttle between office and home, with few communities free of work ties. As a result, many feel lonely or unfulfilled
- The growth of dating apps, running communities and HYROX is a sign of this demand
- All of them offer a "pretext to meet" (romance, running, competition)
- We read the rise of freelancers and influencers as more people acting on their restlessness. Others choose "stability without doing anything", so people are polarizing

## 4. Target and persona

- We target the "in-between" segment: people who have neither jumped ship nor fully settled into stability
  - The segment is large, yet almost no place caters to it
- Within it, people with a genuine passion, real commitment and taste
- Example persona: an employee at a large company who plays the violin well and wants to perform, but has no one to play with. They end up playing alone at home, with no outlet
- The itch: talent and passion that never reach anyone

## 5. Positioning against existing services

- As a members-only, high-end concept alone, the market is already crowded
- Existing services fall into two camps
  - Expensive and status-driven: Ark Hills Club, Soho House, referral-only restaurants
  - Casual but uneven in quality: Timeleft, cross-industry mixers, running clubs
- The gap is a place where quality professionals around their 30s can talk candidly without titles, and where the mix of people is deliberately designed
- In an age where anything can be looked up, the value must be clear before people join
  - Who will be there, why this mix, what they take away, who is hosting

## 6. Concept and service model

- Concept: a place that turns employees' hidden passions into work and companions
- Promise to communicate up front (draft): "Your passion shouldn't end with you alone"
- Service flow
  1. Discover: Hina interviews each person on what they love and how deep it runs. This doubles as membership screening
  2. Match: introduce compatible members to each other in small groups
  3. Showcase: create outlets such as salon concerts, small exhibitions and one-night restaurants
  4. Record and share: capture it in photos and video through TAKANORI's creative work. This builds members' track records and advertises the service
- Examples of genre combinations
  - Cooking × wine × photography → a one-night restaurant
  - Music × architecture × film → a salon concert in an old townhouse
  - Writing × illustration → a zine and a reading night
  - Art × space → a one-night exhibition in a gallery after hours

## 7. A self-sustaining cycle of connections, and a place

- Build a cycle: meet → experience → become companions → plan the next one → new people join
- The more members plan events themselves, the less work it is for the two of us, and the community grows naturally
- A physical venue makes the brand visible, keeps connections alive and adds revenue streams
- But fixed costs are heavy, so we will acquire space in stages
  - First: rent a gallery, old townhouse or after-hours restaurant each time
  - Next: partner with venues that worked well
  - Once on track: open our own base
- Revealing the venue only the day before could be part of the experience

## 8. Revenue model (provisional)

- Membership (the base): ¥30,000 joining fee, ¥15,000 per month
- Showcase events: ticketed and open to outsiders (¥5,000–10,000). An entry point for new members
- Corporate programs (the biggest upside): sell programs that draw out employees' passions and talents, positioned as human-capital management or internal engagement (assume ¥2–5M per company per year)
- Brokering work and skills (future): connect members' work, performances and photography with companies and events, and take a fee
- Membership fees alone are hard to scale. Treat the member community as proof of quality and a track record, and earn from corporate programs in a two-tier model
- All figures are placeholders and need validation

## 9. Brand direction

- The first demo took a pop direction, like Timeleft
- We then changed course
  - Not too edgy, but not so mass-market that it attracts people looking for dates
  - A touch of formality, with a refined feel
  - References: community creative from Arc'teryx and On, theuglyhouse.studios
- Revised tone: two colors, near-black and off-white, with a single lime accent. Serif headings, monospaced English labels
- Don't lead with "meeting people"; position it as "a table for grown-ups who love things deeply"
- State the house rules (invitation only, six per table, venue shared the day before, no business cards, no selling or recruiting)

## 10. How we match people

- We match people on "adjacent passions", not "the same passion"
  - Same: drifts into knowledge contests and one-upmanship; the highest risk of things turning sour
  - Adjacent: a shared entry point, and people can teach each other. The liveliest
  - Distant: fresh, but conversations can stall
- Use MBTI as a conversation starter, not the core of matching. What we look at is conversational style
  - Talker or listener, digger or broadener, host or guest
- The best single indicator for preventing blow-ups is "openness" (whether someone enjoys ways of loving a thing that differ from their own). Assess it in the interview
  - High openness: seat them at a regular table, however niche the passion
  - Strong views, somewhat closed: invite them to be the performer (musician, chef and so on)
  - Clearly a poor fit: decline membership
- How to build a table of six
  1. Set one loose shared theme
  2. Make sure everyone overlaps with at least two others in some way
  3. No more than one die-hard from the same field per table
  4. Mix makers and appreciators
  5. Include one or two people who run the room and about two listeners
  6. Don't seat people together who have shared a table before
- After each dinner, people pick who they'd like to see again, and are connected only when both choose each other. This data directly sharpens the algorithm and becomes an asset competitors can't copy

## 11. What we built

- Demos of the landing page and app onboarding (on Claude's design canvas)
  - Landing page: concept, how to join, who it's for, sample experiences, the cycle of connections, house rules, pricing
  - Onboarding: what you're looking for → passions (up to 3) → how close you are to each → industry → age group → contact details → done (on to the interview)

## 12. Decisions

- The core of the business is "an invitation-only place that brings together employees with hidden passions through adjacent interests, and turns that into experiences and work"
- The target is people with genuine passions who have neither jumped ship nor settled into stability
- The brand will go quiet and refined, not pop
- Run everything by hand at first, and systematize later

## 13. Open questions

- Brand name (sukima is a working name)
- Which genre to focus on first ("food × something" is the leading idea)
- Pricing (joining and monthly fees are placeholders)
- What the corporate program contains, and who the first customers are
- How to secure venues (candidate rentals)

## 14. Next steps

| Owner | Action |
|---|---|
| Hina | Write down the "real problems" she often hears about at work |
| Both | List 5–10 people around us with hidden passions, talk to each one, and check whether the itch is real |
| Both | Host one one-night dinner for about 10 acquaintances and see how people react |
| Hina | Arrange the first 10 tables by hand, working from a spreadsheet |
| TAKANORI | Turn the patterns that worked by hand into matching rules and a system |
| TAKANORI | Build up photos of real tables and spaces to replace the landing-page images |
`;

const PITCH_EN = `# Quotes for small factories, from a single photo

## Problem
- Small machine shops still receive 80% of quote requests by fax and phone
- Misread drawings cause an average of 4 reworks a month
- No young people are joining, and only the owner can prepare quotes

## Solution
1. Take a photo of the drawing
2. AI reads the dimensions and materials and drafts the quote
3. The owner checks it and sends it straight back to the customer

## Market
| Metric | Figure | Source |
|---|---|---|
| Small factories in Japan | approx. 38,000 firms | METI |
| Quotes per company | 120/month | Internal survey |
| Addressable market | ¥46B/year | Estimate |

## How we differ
- Large procurement SaaS: expensive monthly fees, and no drawing-reading feature
- Quoting agencies: fast, but charge for every quote
- Us: a single photo, from ¥30,000 a month

## Traction
- Across 12 pilot companies, quoting time fell by 62% on average
- None of the 5 paying customers has churned in six months

## Asks
- We want to raise ¥100M in a seed round
- Please introduce us to the metalworking industry association
`;

const MEMO_EN = `We want to hire 12 engineers next fiscal year. This year we targeted 8 and have hired only 5.
Offer acceptance through agencies is low at 40%. We are losing to competing SaaS companies on salary. It takes 3 weeks on average from interview to offer, and candidates accept other offers in the meantime.
We are considering three measures. First, cut interviews to two rounds and get to an offer within one week. Second, pay a ¥300,000 bonus for referral hires. Third, publish a tech blog and host a meetup once a month for engineering outreach.
We expect a budget of 1.3x this year's, or ¥18M. What we need the board to decide is whether to raise the salary bands and whether to approve the referral bonus.
`;

export const SAMPLES_EN: SampleText[] = [
  { id: "minutes", name: "Meeting minutes", desc: "Concept meeting for an invitation-only community", text: MINUTES_EN },
  { id: "pitch", name: "Pitch notes", desc: "Fundraising for a SaaS for small factories", text: PITCH_EN },
  { id: "memo", name: "Memo without headings", desc: "Next year's engineering hiring plan", text: MEMO_EN },
];

/** 表示言語に合わせた見本の文章 */
export function samplesFor(lang: Lang): SampleText[] {
  return lang === "en" ? SAMPLES_EN : SAMPLES;
}
