import type { Locale } from '@/Function/i18n/locales';

// What a brand-new Space starts with: one Domain whose Objects walk through
// setup, and one Vision whose Initiatives point at those Objects — so the
// first thing a person sees is the product's own model, filled in. It is
// ordinary data once written; the owner edits or deletes it like anything else.

export interface StarterElement {
  title: string;
  description: string;
}

export interface StarterObject {
  /** Stable handle an Initiative uses to name the Object it draws on. */
  key: string;
  name: string;
  description: string;
  elements: StarterElement[];
}

export interface StarterInitiative {
  name: string;
  description: string;
  objectKeys: string[];
}

export interface StarterPortfolio {
  name: string;
  description: string;
  initiatives: StarterInitiative[];
}

export interface StarterContent {
  domain: { name: string; identifier: string; description: string };
  objects: StarterObject[];
  vision: { name: string; statement: string };
  portfolios: StarterPortfolio[];
}

const ja: StarterContent = {
  domain: {
    name: '初期設定',
    identifier: 'SETUP',
    description: 'Alcon の設定と使い方を、実際の Object と Element で確かめるための Domain です。終わったら削除してかまいません。',
  },
  objects: [
    {
      key: 'concepts',
      name: 'はじめに — Alcon の考え方',
      description: 'Alcon が組織の活動をどう捉えるかを知る。',
      elements: [
        { title: 'Strategy・Execution・Sustainment の 3 分類を知る', description: 'Strategy は「何を達成し、どう勝つか」、Execution は「実際の行動」、Sustainment は「仕事道具」です。左端のレールで切り替えます。' },
        { title: 'Domain → Object → Element の階層を理解する', description: 'Domain は活動の場、Object は成果物、Element は行動の最小単位です。いま見ているこの行が Element です。' },
        { title: 'この Element を完了にしてみる', description: 'ステータスを変更すると、Object の進捗に反映されます。' },
        { title: '⌘K でコマンドパレットを開く', description: '検索と画面の移動は ⌘K からまとめて行えます。' },
      ],
    },
    {
      key: 'space',
      name: 'Space を整える',
      description: 'チームで使い始めるための設定。',
      elements: [
        { title: '表示テーマと言語を選ぶ', description: '設定から、テーマ（Midnight など）と表示言語を変更できます。' },
        { title: 'メンバーを招待する', description: 'Space にメンバーを招待すると、Workspace 公開の Domain を一緒に見られるようになります。' },
        { title: 'AI エージェントを Worker として追加する', description: 'Worker には人と AI エージェントの 2 種類があります。AI エージェントにも Element を割り当てられます。' },
        { title: '通知の受け取り方を決める', description: '設定から、どの出来事を通知で受け取るかを選べます。' },
      ],
    },
    {
      key: 'execution',
      name: 'Execution を試す',
      description: '日々の行動を Element にする。',
      elements: [
        { title: '自分たちの Domain を作る', description: '会社、部署、プロジェクト群など、活動の場ごとに Domain を作ります。' },
        { title: 'Object を作り、Element を追加する', description: 'Object は Domain の直下に置きます。入れ子にはできませんが、複数の Domain で共有できます。' },
        { title: 'Element に担当・期限・優先度を設定する', description: '担当・期限・進捗・依存は Execution 側で扱います。' },
        { title: 'Property を定義する', description: 'Object ごとに独自の項目（Property）を定義し、Element に値を持たせられます。' },
        { title: '表示を切り替える', description: '同じ Element を、リスト以外の表示でも見られます。' },
      ],
    },
    {
      key: 'strategy',
      name: 'Strategy と結びつける',
      description: '意図と行動を行き来できるようにする。',
      elements: [
        { title: 'Vision を書く', description: 'Vision は Space が目指す姿です。Strategy の Vision から追加します。' },
        { title: 'Initiative を作り、Object を結びつける', description: 'Initiative は目的・前提・意思決定・成功条件を持ちます。担当や進捗は持たず、結びつけた Object の実行状況を参照します。' },
        { title: '成功条件を数値で置く', description: 'Initiative に測定できる成功条件を置くと、目標と実績の差を追えます。' },
        { title: 'Initiative と Object を行き来する', description: 'Initiative からは配下の Object を、Object からは貢献先の Initiative を開けます。' },
      ],
    },
    {
      key: 'sustainment',
      name: '仕事道具を使う',
      description: 'Sustainment の道具を一通り触る。',
      elements: [
        { title: 'Notebook にノートを書く', description: '文章は Note に残します。' },
        { title: 'Table を作る', description: '任意の分類でデータを整理・分析するには Table を使います。' },
        { title: 'Calendar で予定を確認する', description: '期限のある Element と予定を日付で見渡せます。' },
        { title: 'Workload で負荷を見る', description: '誰にどれだけ仕事が乗っているかを確認できます。' },
      ],
    },
  ],
  vision: {
    name: 'アプリの使い方をマスターする',
    statement: 'チームの全員が、意図（Strategy）と行動（Execution）を Alcon の上で行き来できる。',
  },
  portfolios: [
    {
      name: '基本を身につける',
      description: '考え方を理解し、Space を使える状態にする。',
      initiatives: [
        { name: 'Alcon の考え方を理解する', description: '3 つの分類と Domain → Object → Element の階層を、自分の言葉で説明できるようになる。', objectKeys: ['concepts'] },
        { name: 'Space を使える状態にする', description: 'メンバー・AI エージェント・通知・表示を整え、チームで使い始められるようにする。', objectKeys: ['space'] },
      ],
    },
    {
      name: '実務で使いこなす',
      description: '実際の仕事を Alcon に乗せ、意図と結びつける。',
      initiatives: [
        { name: '日々の実行を Element にする', description: '自分たちの Domain・Object・Element を作り、担当と期限を持たせる。', objectKeys: ['execution'] },
        { name: '意図と実行を結びつける', description: 'Vision と Initiative を書き、Object を結びつけて、目的と実行状況を行き来できるようにする。', objectKeys: ['strategy'] },
        { name: '仕事道具を活用する', description: 'Notebook・Table・Calendar・Workload を日常の仕事に組み込む。', objectKeys: ['sustainment'] },
      ],
    },
  ],
};

const en: StarterContent = {
  domain: {
    name: 'Getting started',
    identifier: 'SETUP',
    description: 'A Domain for trying out Alcon\'s setup and concepts with real Objects and Elements. Delete it once you are done.',
  },
  objects: [
    {
      key: 'concepts',
      name: 'Start here — how Alcon thinks',
      description: 'How Alcon models an organisation\'s activity.',
      elements: [
        { title: 'Learn the three areas: Strategy, Execution, Sustainment', description: 'Strategy is what to achieve and how to win, Execution is the actual work, and Sustainment is the tools for the job. Switch between them on the left rail.' },
        { title: 'Understand Domain → Object → Element', description: 'A Domain is where work happens, an Object is a deliverable, and an Element is the smallest unit of action. This row is an Element.' },
        { title: 'Mark this Element as done', description: 'Changing the status updates the Object\'s progress.' },
        { title: 'Open the command palette with ⌘K', description: 'Search and navigation both live behind ⌘K.' },
      ],
    },
    {
      key: 'space',
      name: 'Set up your Space',
      description: 'Settings for starting as a team.',
      elements: [
        { title: 'Choose a theme and language', description: 'Settings let you change the theme (Midnight and others) and the display language.' },
        { title: 'Invite members', description: 'Members you invite to the Space can see its Workspace-visible Domains with you.' },
        { title: 'Add an AI agent as a Worker', description: 'A Worker is either a person or an AI agent. Elements can be assigned to AI agents too.' },
        { title: 'Decide how you get notified', description: 'Settings let you choose which events reach you as notifications.' },
      ],
    },
    {
      key: 'execution',
      name: 'Try Execution',
      description: 'Put day-to-day work on the board.',
      elements: [
        { title: 'Create your own Domain', description: 'Create a Domain for each place work happens — a company, a department, a project portfolio.' },
        { title: 'Create an Object and add Elements', description: 'Objects sit directly under a Domain. They do not nest, but they can be shared across Domains.' },
        { title: 'Set an assignee, due date and priority on an Element', description: 'Assignees, due dates, progress and dependencies belong to Execution.' },
        { title: 'Define a Property', description: 'Each Object can define its own fields (Properties), and Elements hold the values.' },
        { title: 'Switch the view', description: 'The same Elements can be shown in views other than the list.' },
      ],
    },
    {
      key: 'strategy',
      name: 'Connect to Strategy',
      description: 'Move between intent and action.',
      elements: [
        { title: 'Write a Vision', description: 'A Vision is what the Space aims for. Add one under Strategy.' },
        { title: 'Create an Initiative and link Objects', description: 'An Initiative holds purpose, assumptions, decisions and success conditions. It has no assignee or progress of its own — it reads those from its linked Objects.' },
        { title: 'Set a measurable success condition', description: 'A measurable condition on an Initiative lets you track the gap between target and actual.' },
        { title: 'Move between an Initiative and its Objects', description: 'An Initiative opens its Objects, and an Object opens the Initiatives it contributes to.' },
      ],
    },
    {
      key: 'sustainment',
      name: 'Use the tools',
      description: 'Try each Sustainment tool once.',
      elements: [
        { title: 'Write a note in Notebook', description: 'Prose belongs in a Note.' },
        { title: 'Create a Table', description: 'Use a Table to organise and analyse data by any classification.' },
        { title: 'Check Calendar', description: 'See dated Elements and schedules by day.' },
        { title: 'Look at Workload', description: 'See how much work sits on each Worker.' },
      ],
    },
  ],
  vision: {
    name: 'Master the app',
    statement: 'Everyone on the team moves between intent (Strategy) and action (Execution) in Alcon.',
  },
  portfolios: [
    {
      name: 'Learn the basics',
      description: 'Understand the model and get the Space ready.',
      initiatives: [
        { name: 'Understand how Alcon thinks', description: 'Be able to explain the three areas and Domain → Object → Element in your own words.', objectKeys: ['concepts'] },
        { name: 'Get the Space ready', description: 'Set up members, AI agents, notifications and appearance so the team can start.', objectKeys: ['space'] },
      ],
    },
    {
      name: 'Use it for real work',
      description: 'Put actual work into Alcon and tie it to intent.',
      initiatives: [
        { name: 'Put daily execution on the board', description: 'Create your own Domains, Objects and Elements with assignees and due dates.', objectKeys: ['execution'] },
        { name: 'Connect intent and execution', description: 'Write a Vision and Initiatives and link Objects, so purpose and progress are one click apart.', objectKeys: ['strategy'] },
        { name: 'Put the tools to work', description: 'Bring Notebook, Table, Calendar and Workload into everyday work.', objectKeys: ['sustainment'] },
      ],
    },
  ],
};

const ko: StarterContent = {
  "domain": {
    "name": "시작하기",
    "identifier": "SETUP",
    "description": "Alcon의 설정과 사용법을 실제 Object와 Element로 확인하는 Domain입니다. 끝나면 삭제해도 됩니다."
  },
  "objects": [
    {
      "key": "concepts",
      "name": "먼저 읽기 — Alcon의 사고방식",
      "description": "Alcon이 조직의 활동을 어떻게 다루는지 알아봅니다.",
      "elements": [
        {
          "title": "Strategy·Execution·Sustainment 세 영역 알기",
          "description": "Strategy는 무엇을 달성하고 어떻게 이길지, Execution은 실제 행동, Sustainment는 업무 도구입니다. 왼쪽 레일에서 전환합니다."
        },
        {
          "title": "Domain → Object → Element 계층 이해하기",
          "description": "Domain은 활동의 장, Object는 결과물, Element는 행동의 최소 단위입니다. 지금 보고 있는 이 행이 Element입니다."
        },
        {
          "title": "이 Element를 완료로 바꿔 보기",
          "description": "상태를 바꾸면 Object의 진행률에 반영됩니다."
        },
        {
          "title": "⌘K로 명령 팔레트 열기",
          "description": "검색과 화면 이동은 ⌘K에서 한 번에 할 수 있습니다."
        }
      ]
    },
    {
      "key": "space",
      "name": "Space 정비하기",
      "description": "팀이 함께 쓰기 위한 설정.",
      "elements": [
        {
          "title": "테마와 언어 고르기",
          "description": "설정에서 테마(Midnight 등)와 표시 언어를 바꿀 수 있습니다."
        },
        {
          "title": "멤버 초대하기",
          "description": "Space에 초대한 멤버는 Workspace 공개 Domain을 함께 볼 수 있습니다."
        },
        {
          "title": "AI 에이전트를 Worker로 추가하기",
          "description": "Worker는 사람과 AI 에이전트 두 종류입니다. AI 에이전트에게도 Element를 배정할 수 있습니다."
        },
        {
          "title": "알림 받는 방식 정하기",
          "description": "설정에서 어떤 일을 알림으로 받을지 고를 수 있습니다."
        }
      ]
    },
    {
      "key": "execution",
      "name": "Execution 써 보기",
      "description": "일상의 행동을 보드에 올립니다.",
      "elements": [
        {
          "title": "우리 Domain 만들기",
          "description": "회사, 부서, 프로젝트 묶음 등 활동의 장마다 Domain을 만듭니다."
        },
        {
          "title": "Object를 만들고 Element 추가하기",
          "description": "Object는 Domain 바로 아래에 둡니다. 중첩할 수는 없지만 여러 Domain에서 공유할 수 있습니다."
        },
        {
          "title": "Element에 담당자·기한·우선순위 설정하기",
          "description": "담당자, 기한, 진행, 의존 관계는 Execution에서 다룹니다."
        },
        {
          "title": "Property 정의하기",
          "description": "Object마다 고유한 항목(Property)을 정의하고 Element에 값을 담을 수 있습니다."
        },
        {
          "title": "보기 전환하기",
          "description": "같은 Element를 목록 외의 보기로도 볼 수 있습니다."
        }
      ]
    },
    {
      "key": "strategy",
      "name": "Strategy와 연결하기",
      "description": "의도와 행동을 오갈 수 있게 합니다.",
      "elements": [
        {
          "title": "Vision 쓰기",
          "description": "Vision은 Space가 지향하는 모습입니다. Strategy에서 추가합니다."
        },
        {
          "title": "Initiative를 만들고 Object 연결하기",
          "description": "Initiative는 목적, 전제, 의사결정, 성공 조건을 가집니다. 담당자나 진행률은 갖지 않고, 연결된 Object의 실행 상황을 참조합니다."
        },
        {
          "title": "측정 가능한 성공 조건 두기",
          "description": "Initiative에 측정 가능한 조건을 두면 목표와 실적의 차이를 추적할 수 있습니다."
        },
        {
          "title": "Initiative와 Object 오가기",
          "description": "Initiative에서는 연결된 Object를, Object에서는 기여하는 Initiative를 열 수 있습니다."
        }
      ]
    },
    {
      "key": "sustainment",
      "name": "업무 도구 쓰기",
      "description": "Sustainment 도구를 한 번씩 써 봅니다.",
      "elements": [
        {
          "title": "Notebook에 노트 쓰기",
          "description": "글은 Note에 남깁니다."
        },
        {
          "title": "Table 만들기",
          "description": "원하는 분류로 데이터를 정리하고 분석하려면 Table을 씁니다."
        },
        {
          "title": "Calendar에서 일정 확인하기",
          "description": "기한이 있는 Element와 일정을 날짜별로 봅니다."
        },
        {
          "title": "Workload에서 부하 보기",
          "description": "각 Worker에게 일이 얼마나 실려 있는지 확인합니다."
        }
      ]
    }
  ],
  "vision": {
    "name": "앱 사용법 마스터하기",
    "statement": "팀 전원이 Alcon에서 의도(Strategy)와 행동(Execution)을 오갈 수 있다."
  },
  "portfolios": [
    {
      "name": "기본 익히기",
      "description": "사고방식을 이해하고 Space를 쓸 수 있는 상태로 만듭니다.",
      "initiatives": [
        {
          "name": "Alcon의 사고방식 이해하기",
          "description": "세 영역과 Domain → Object → Element 계층을 자신의 말로 설명할 수 있게 됩니다.",
          "objectKeys": [
            "concepts"
          ]
        },
        {
          "name": "Space를 쓸 수 있는 상태로 만들기",
          "description": "멤버, AI 에이전트, 알림, 표시를 정비해 팀이 시작할 수 있게 합니다.",
          "objectKeys": [
            "space"
          ]
        }
      ]
    },
    {
      "name": "실무에서 활용하기",
      "description": "실제 업무를 Alcon에 올리고 의도와 연결합니다.",
      "initiatives": [
        {
          "name": "일상의 실행을 보드에 올리기",
          "description": "우리 Domain·Object·Element를 만들고 담당자와 기한을 둡니다.",
          "objectKeys": [
            "execution"
          ]
        },
        {
          "name": "의도와 실행 연결하기",
          "description": "Vision과 Initiative를 쓰고 Object를 연결해 목적과 실행 상황을 오갈 수 있게 합니다.",
          "objectKeys": [
            "strategy"
          ]
        },
        {
          "name": "업무 도구 활용하기",
          "description": "Notebook, Table, Calendar, Workload를 일상 업무에 녹입니다.",
          "objectKeys": [
            "sustainment"
          ]
        }
      ]
    }
  ]
};

const fr: StarterContent = {
  "domain": {
    "name": "Prise en main",
    "identifier": "SETUP",
    "description": "Un Domain pour découvrir la configuration et les concepts d’Alcon avec de vrais Objects et Elements. Supprimez-le une fois terminé."
  },
  "objects": [
    {
      "key": "concepts",
      "name": "Commencer ici — la logique d’Alcon",
      "description": "Comment Alcon modélise l’activité d’une organisation.",
      "elements": [
        {
          "title": "Découvrir les trois domaines : Strategy, Execution, Sustainment",
          "description": "Strategy : quoi atteindre et comment gagner. Execution : le travail réel. Sustainment : les outils de travail. Passez de l’un à l’autre dans la barre de gauche."
        },
        {
          "title": "Comprendre Domain → Object → Element",
          "description": "Un Domain est le lieu de l’activité, un Object un livrable, un Element la plus petite unité d’action. Cette ligne est un Element."
        },
        {
          "title": "Marquer cet Element comme terminé",
          "description": "Changer le statut met à jour la progression de l’Object."
        },
        {
          "title": "Ouvrir la palette de commandes avec ⌘K",
          "description": "La recherche et la navigation passent toutes deux par ⌘K."
        }
      ]
    },
    {
      "key": "space",
      "name": "Configurer votre Space",
      "description": "Les réglages pour démarrer en équipe.",
      "elements": [
        {
          "title": "Choisir un thème et une langue",
          "description": "Les réglages permettent de changer le thème (Midnight, entre autres) et la langue d’affichage."
        },
        {
          "title": "Inviter des membres",
          "description": "Les membres invités dans le Space voient avec vous ses Domains visibles par le Workspace."
        },
        {
          "title": "Ajouter un agent IA comme Worker",
          "description": "Un Worker est soit une personne, soit un agent IA. Des Elements peuvent aussi être assignés aux agents IA."
        },
        {
          "title": "Décider comment être notifié",
          "description": "Les réglages permettent de choisir quels événements vous parviennent en notification."
        }
      ]
    },
    {
      "key": "execution",
      "name": "Essayer Execution",
      "description": "Mettre le travail quotidien sur le tableau.",
      "elements": [
        {
          "title": "Créer votre propre Domain",
          "description": "Créez un Domain pour chaque lieu d’activité : entreprise, service, portefeuille de projets."
        },
        {
          "title": "Créer un Object et ajouter des Elements",
          "description": "Les Objects se placent directement sous un Domain. Ils ne s’imbriquent pas, mais peuvent être partagés entre Domains."
        },
        {
          "title": "Définir responsable, échéance et priorité d’un Element",
          "description": "Responsables, échéances, progression et dépendances relèvent d’Execution."
        },
        {
          "title": "Définir une Property",
          "description": "Chaque Object peut définir ses propres champs (Properties), dont les Elements portent les valeurs."
        },
        {
          "title": "Changer de vue",
          "description": "Les mêmes Elements peuvent s’afficher autrement qu’en liste."
        }
      ]
    },
    {
      "key": "strategy",
      "name": "Relier à Strategy",
      "description": "Passer de l’intention à l’action, et inversement.",
      "elements": [
        {
          "title": "Rédiger une Vision",
          "description": "Une Vision est ce que vise le Space. Ajoutez-en une dans Strategy."
        },
        {
          "title": "Créer une Initiative et y relier des Objects",
          "description": "Une Initiative porte l’objectif, les hypothèses, les décisions et les conditions de réussite. Elle n’a ni responsable ni progression propres : elle les lit dans les Objects reliés."
        },
        {
          "title": "Fixer une condition de réussite mesurable",
          "description": "Une condition mesurable sur une Initiative permet de suivre l’écart entre cible et réel."
        },
        {
          "title": "Naviguer entre une Initiative et ses Objects",
          "description": "Une Initiative ouvre ses Objects, et un Object ouvre les Initiatives auxquelles il contribue."
        }
      ]
    },
    {
      "key": "sustainment",
      "name": "Utiliser les outils",
      "description": "Essayer une fois chaque outil de Sustainment.",
      "elements": [
        {
          "title": "Écrire une note dans Notebook",
          "description": "Le texte se conserve dans une Note."
        },
        {
          "title": "Créer une Table",
          "description": "Utilisez une Table pour organiser et analyser des données selon n’importe quel classement."
        },
        {
          "title": "Consulter Calendar",
          "description": "Voyez par jour les Elements datés et les plannings."
        },
        {
          "title": "Regarder Workload",
          "description": "Voyez la charge de travail de chaque Worker."
        }
      ]
    }
  ],
  "vision": {
    "name": "Maîtriser l’application",
    "statement": "Toute l’équipe passe de l’intention (Strategy) à l’action (Execution) dans Alcon."
  },
  "portfolios": [
    {
      "name": "Apprendre les bases",
      "description": "Comprendre le modèle et préparer le Space.",
      "initiatives": [
        {
          "name": "Comprendre la logique d’Alcon",
          "description": "Savoir expliquer avec ses propres mots les trois domaines et Domain → Object → Element.",
          "objectKeys": [
            "concepts"
          ]
        },
        {
          "name": "Préparer le Space",
          "description": "Configurer membres, agents IA, notifications et apparence pour que l’équipe puisse démarrer.",
          "objectKeys": [
            "space"
          ]
        }
      ]
    },
    {
      "name": "L’utiliser pour le vrai travail",
      "description": "Mettre le travail réel dans Alcon et le relier à l’intention.",
      "initiatives": [
        {
          "name": "Mettre l’exécution quotidienne sur le tableau",
          "description": "Créer vos propres Domains, Objects et Elements, avec responsables et échéances.",
          "objectKeys": [
            "execution"
          ]
        },
        {
          "name": "Relier intention et exécution",
          "description": "Rédiger une Vision et des Initiatives et y relier des Objects, pour passer de l’objectif à l’avancement en un clic.",
          "objectKeys": [
            "strategy"
          ]
        },
        {
          "name": "Tirer parti des outils",
          "description": "Intégrer Notebook, Table, Calendar et Workload au travail de tous les jours.",
          "objectKeys": [
            "sustainment"
          ]
        }
      ]
    }
  ]
};

const es: StarterContent = {
  "domain": {
    "name": "Primeros pasos",
    "identifier": "SETUP",
    "description": "Un Domain para probar la configuración y los conceptos de Alcon con Objects y Elements reales. Elimínalo cuando termines."
  },
  "objects": [
    {
      "key": "concepts",
      "name": "Empieza aquí — cómo piensa Alcon",
      "description": "Cómo modela Alcon la actividad de una organización.",
      "elements": [
        {
          "title": "Conocer las tres áreas: Strategy, Execution, Sustainment",
          "description": "Strategy es qué lograr y cómo ganar, Execution es el trabajo real y Sustainment son las herramientas de trabajo. Cambia entre ellas en la barra izquierda."
        },
        {
          "title": "Entender Domain → Object → Element",
          "description": "Un Domain es donde ocurre el trabajo, un Object es un entregable y un Element es la unidad mínima de acción. Esta fila es un Element."
        },
        {
          "title": "Marcar este Element como hecho",
          "description": "Cambiar el estado actualiza el progreso del Object."
        },
        {
          "title": "Abrir la paleta de comandos con ⌘K",
          "description": "La búsqueda y la navegación están en ⌘K."
        }
      ]
    },
    {
      "key": "space",
      "name": "Configura tu Space",
      "description": "Ajustes para empezar en equipo.",
      "elements": [
        {
          "title": "Elegir tema e idioma",
          "description": "En los ajustes puedes cambiar el tema (Midnight y otros) y el idioma."
        },
        {
          "title": "Invitar miembros",
          "description": "Los miembros que invites al Space ven contigo sus Domains visibles para el Workspace."
        },
        {
          "title": "Añadir un agente de IA como Worker",
          "description": "Un Worker es una persona o un agente de IA. También se pueden asignar Elements a agentes de IA."
        },
        {
          "title": "Decidir cómo recibir notificaciones",
          "description": "En los ajustes puedes elegir qué eventos te llegan como notificación."
        }
      ]
    },
    {
      "key": "execution",
      "name": "Prueba Execution",
      "description": "Lleva el trabajo diario al tablero.",
      "elements": [
        {
          "title": "Crear tu propio Domain",
          "description": "Crea un Domain por cada lugar donde ocurre el trabajo: empresa, departamento, cartera de proyectos."
        },
        {
          "title": "Crear un Object y añadir Elements",
          "description": "Los Objects se sitúan directamente bajo un Domain. No se anidan, pero pueden compartirse entre Domains."
        },
        {
          "title": "Definir responsable, fecha límite y prioridad en un Element",
          "description": "Responsables, fechas límite, progreso y dependencias pertenecen a Execution."
        },
        {
          "title": "Definir una Property",
          "description": "Cada Object puede definir sus propios campos (Properties), y los Elements guardan los valores."
        },
        {
          "title": "Cambiar la vista",
          "description": "Los mismos Elements pueden mostrarse en vistas distintas de la lista."
        }
      ]
    },
    {
      "key": "strategy",
      "name": "Conecta con Strategy",
      "description": "Moverse entre la intención y la acción.",
      "elements": [
        {
          "title": "Escribir una Vision",
          "description": "Una Vision es a lo que aspira el Space. Añade una en Strategy."
        },
        {
          "title": "Crear una Initiative y vincular Objects",
          "description": "Una Initiative contiene propósito, supuestos, decisiones y condiciones de éxito. No tiene responsable ni progreso propios: los lee de sus Objects vinculados."
        },
        {
          "title": "Fijar una condición de éxito medible",
          "description": "Una condición medible en una Initiative permite seguir la diferencia entre objetivo y real."
        },
        {
          "title": "Moverse entre una Initiative y sus Objects",
          "description": "Una Initiative abre sus Objects, y un Object abre las Initiatives a las que contribuye."
        }
      ]
    },
    {
      "key": "sustainment",
      "name": "Usa las herramientas",
      "description": "Prueba una vez cada herramienta de Sustainment.",
      "elements": [
        {
          "title": "Escribir una nota en Notebook",
          "description": "El texto se guarda en una Note."
        },
        {
          "title": "Crear una Table",
          "description": "Usa una Table para organizar y analizar datos con cualquier clasificación."
        },
        {
          "title": "Consultar Calendar",
          "description": "Consulta por día los Elements con fecha y las agendas."
        },
        {
          "title": "Mirar Workload",
          "description": "Consulta cuánto trabajo tiene cada Worker."
        }
      ]
    }
  ],
  "vision": {
    "name": "Dominar la aplicación",
    "statement": "Todo el equipo se mueve entre la intención (Strategy) y la acción (Execution) en Alcon."
  },
  "portfolios": [
    {
      "name": "Aprender lo básico",
      "description": "Entender el modelo y dejar listo el Space.",
      "initiatives": [
        {
          "name": "Entender cómo piensa Alcon",
          "description": "Poder explicar con tus palabras las tres áreas y Domain → Object → Element.",
          "objectKeys": [
            "concepts"
          ]
        },
        {
          "name": "Dejar listo el Space",
          "description": "Configurar miembros, agentes de IA, notificaciones y apariencia para que el equipo pueda empezar.",
          "objectKeys": [
            "space"
          ]
        }
      ]
    },
    {
      "name": "Usarla en el trabajo real",
      "description": "Llevar el trabajo real a Alcon y unirlo a la intención.",
      "initiatives": [
        {
          "name": "Llevar la ejecución diaria al tablero",
          "description": "Crear vuestros propios Domains, Objects y Elements con responsables y fechas límite.",
          "objectKeys": [
            "execution"
          ]
        },
        {
          "name": "Conectar intención y ejecución",
          "description": "Escribir una Vision e Initiatives y vincular Objects, para pasar del propósito al avance con un clic.",
          "objectKeys": [
            "strategy"
          ]
        },
        {
          "name": "Aprovechar las herramientas",
          "description": "Incorporar Notebook, Table, Calendar y Workload al trabajo diario.",
          "objectKeys": [
            "sustainment"
          ]
        }
      ]
    }
  ]
};

const CONTENT: Record<Locale, StarterContent> = { en, ja, ko, fr, es };

/** Starter content in the viewer's language. */
export function starterContent(locale: Locale): StarterContent {
  return CONTENT[locale];
}
