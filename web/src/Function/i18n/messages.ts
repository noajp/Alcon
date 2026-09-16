import type { Locale } from './locales';

type TranslationMap = Record<string, string>;

const ja: TranslationMap = {
  'Grouping': 'グループ化', 'Ordering': '並び順', 'Sort by': '並べ替え項目',
  'Direction': '方向', 'Ascending': '昇順', 'Descending': '降順', 'Manual': '手動',
  'Display properties': '表示項目',
  'Account': 'アカウント', 'Activity space': 'アクティビティスペース', 'Administration': '管理',
  'AI agent': 'AI エージェント', 'Already have an account? ': 'すでにアカウントをお持ちですか？ ',
  'App sidebar': 'アプリサイドバー', 'At least 6 characters': '6文字以上', 'Back to sign in': 'サインインに戻る',
  'Calendar': 'カレンダー', 'Cancel': 'キャンセル', 'Check your email': 'メールを確認してください',
  'Close tab': 'タブを閉じる', 'Connected accounts': '連携アカウント', 'Connection Error': '接続エラー',
  'Create': '作成', 'Create account': 'アカウントを作成', 'Create an account': 'アカウントを作成',
  'Create Domain': 'Domain を作成', 'Create new': '新規作成', 'Create Space': 'スペースを作成',
  'Create your Space': 'スペースを作成', 'Creating account...': 'アカウントを作成中...', 'Customize': 'カスタマイズ',
  'Default': '標準', 'Default home view': '既定のホームビュー', 'Discover': '見つける',
  'Display names': '名前の表示', 'Domain': 'Domain', 'Domain overview': 'Domain の概要', 'Domains': 'Domains',
  "Don't have an account? ": 'アカウントをお持ちでないですか？ ', 'Email': 'メールアドレス',
  'Elements': 'Elements', 'Execution': 'Execution', 'First day of the week': '週の開始曜日', 'Font size': 'フォントサイズ',
  'General': '一般', 'Get started with Alcon': 'Alcon を始めましょう', 'Home': 'ホーム', 'Inbox': '受信トレイ',
  'Initiatives': 'Initiatives', 'Interface and theme': 'インターフェースとテーマ', 'Language': '言語',
  'Loading…': '読み込み中…', 'Member': 'メンバー', 'My Elements': '自分の Elements', 'Name': '名前',
  'New tab': '新しいタブ', 'No results.': '結果はありません。', 'Notebook': 'ノートブック',
  'Notifications': '通知', 'Now': '現在', 'Objects': 'Objects', 'Password': 'パスワード', 'Personal': '個人',
  'Phase': 'Phase', 'Preferences': '設定', 'Profile': 'プロフィール', 'Search': '検索', 'Search settings…': '設定を検索…',
  'Security & access': 'セキュリティとアクセス', 'Settings': '設定', 'Sign in': 'サインイン',
  'Sign in to your Activity Space': 'アクティビティスペースにサインイン', 'Signing in...': 'サインイン中...',
  'Sign up': 'アカウント作成', 'Strategy': 'Strategy', 'Sustainment': 'Sustainment', 'System': 'システム',
  'Table': 'テーブル', 'Team': 'チーム', 'Theme': 'テーマ', 'Timeline': 'タイムライン', 'Tools': 'ツール',
  'Type to search.': '入力して検索します。', 'Use pointer cursors': 'ポインターカーソルを使用',
  'Welcome back': 'おかえりなさい', 'Workload': 'ワークロード', 'Your name': 'お名前',
  'Choose the language used across Alcon': 'Alcon 全体で使用する言語を選択',
  'A shared place for your team. Bring in one existing project to get started.': 'チームのための共有スペースです。既存のプロジェクトを一つ追加して始めましょう。',
  'We sent a confirmation link to {email}': '{email} に確認リンクを送信しました',
};

const ko: TranslationMap = {
  'Grouping': '그룹화',
  'Ordering': '정렬 순서',
  'Sort by': '정렬 기준',
  'Direction': '방향',
  'Ascending': '오름차순',
  'Descending': '내림차순',
  'Manual': '수동',
  'Display properties': '표시 속성',
  'Account': '계정', 'Activity space': '활동 공간', 'Administration': '관리', 'AI agent': 'AI 에이전트',
  'Already have an account? ': '이미 계정이 있나요? ', 'App sidebar': '앱 사이드바', 'At least 6 characters': '6자 이상',
  'Back to sign in': '로그인으로 돌아가기', 'Calendar': '캘린더', 'Cancel': '취소', 'Check your email': '이메일을 확인하세요',
  'Close tab': '탭 닫기', 'Connected accounts': '연결된 계정', 'Connection Error': '연결 오류', 'Create': '만들기',
  'Create account': '계정 만들기', 'Create an account': '계정 만들기', 'Create Domain': 'Domain 만들기', 'Create new': '새로 만들기',
  'Create Space': '공간 만들기', 'Create your Space': '공간을 만드세요', 'Creating account...': '계정 만드는 중...',
  'Customize': '사용자 설정', 'Default': '기본', 'Default home view': '기본 홈 뷰', 'Discover': '탐색', 'Display names': '이름 표시',
  'Domain': 'Domain', 'Domain overview': 'Domain 개요', 'Domains': 'Domains', "Don't have an account? ": '계정이 없으신가요? ',
  'Email': '이메일', 'Elements': 'Elements', 'Execution': 'Execution', 'First day of the week': '주 시작일', 'Font size': '글자 크기',
  'General': '일반', 'Get started with Alcon': 'Alcon 시작하기', 'Home': '홈', 'Inbox': '받은편지함', 'Initiatives': 'Initiatives',
  'Interface and theme': '인터페이스 및 테마', 'Language': '언어', 'Loading…': '로딩 중…', 'Member': '멤버',
  'My Elements': '내 Elements', 'Name': '이름', 'New tab': '새 탭', 'No results.': '결과가 없습니다.', 'Notebook': '노트북',
  'Notifications': '알림', 'Now': '지금', 'Objects': 'Objects', 'Password': '비밀번호', 'Personal': '개인', 'Phase': 'Phase',
  'Preferences': '환경설정', 'Profile': '프로필', 'Search': '검색', 'Search settings…': '설정 검색…', 'Security & access': '보안 및 액세스',
  'Settings': '설정', 'Sign in': '로그인', 'Sign in to your Activity Space': '활동 공간에 로그인', 'Signing in...': '로그인 중...',
  'Sign up': '가입하기', 'Strategy': 'Strategy', 'Sustainment': 'Sustainment', 'System': '시스템', 'Table': '테이블', 'Team': '팀',
  'Theme': '테마', 'Timeline': '타임라인', 'Tools': '도구', 'Type to search.': '검색어를 입력하세요.',
  'Use pointer cursors': '포인터 커서 사용', 'Welcome back': '다시 오신 것을 환영합니다', 'Workload': '워크로드', 'Your name': '이름',
  'Choose the language used across Alcon': 'Alcon 전체에서 사용할 언어를 선택하세요',
  'A shared place for your team. Bring in one existing project to get started.': '팀을 위한 공유 공간입니다. 기존 프로젝트 하나를 가져와 시작하세요.',
  'We sent a confirmation link to {email}': '{email}로 확인 링크를 보냈습니다',
};

const fr: TranslationMap = {
  'Grouping': 'Regroupement',
  'Ordering': 'Ordre',
  'Sort by': 'Trier par',
  'Direction': 'Sens',
  'Ascending': 'Croissant',
  'Descending': 'Décroissant',
  'Manual': 'Manuel',
  'Display properties': 'Propriétés affichées',
  'Account': 'Compte', 'Activity space': "Espace d'activité", 'Administration': 'Administration', 'AI agent': 'Agent IA',
  'Already have an account? ': 'Vous avez déjà un compte ? ', 'App sidebar': "Barre latérale de l’app", 'At least 6 characters': 'Au moins 6 caractères',
  'Back to sign in': 'Retour à la connexion', 'Calendar': 'Calendrier', 'Cancel': 'Annuler', 'Check your email': 'Consultez votre messagerie',
  'Close tab': "Fermer l’onglet", 'Connected accounts': 'Comptes connectés', 'Connection Error': 'Erreur de connexion', 'Create': 'Créer',
  'Create account': 'Créer le compte', 'Create an account': 'Créer un compte', 'Create Domain': 'Créer un Domain', 'Create new': 'Créer',
  'Create Space': "Créer l’espace", 'Create your Space': 'Créez votre espace', 'Creating account...': 'Création du compte...', 'Customize': 'Personnaliser',
  'Default': 'Par défaut', 'Default home view': "Vue d’accueil par défaut", 'Discover': 'Découvrir', 'Display names': 'Affichage des noms',
  'Domain': 'Domain', 'Domain overview': 'Aperçu du Domain', 'Domains': 'Domains', "Don't have an account? ": "Vous n’avez pas de compte ? ",
  'Email': 'E-mail', 'Elements': 'Elements', 'Execution': 'Execution', 'First day of the week': 'Premier jour de la semaine', 'Font size': 'Taille du texte',
  'General': 'Général', 'Get started with Alcon': 'Commencez avec Alcon', 'Home': 'Accueil', 'Inbox': 'Boîte de réception', 'Initiatives': 'Initiatives',
  'Interface and theme': 'Interface et thème', 'Language': 'Langue', 'Loading…': 'Chargement…', 'Member': 'Membre', 'My Elements': 'Mes Elements',
  'Name': 'Nom', 'New tab': 'Nouvel onglet', 'No results.': 'Aucun résultat.', 'Notebook': 'Carnet', 'Notifications': 'Notifications', 'Now': 'Maintenant',
  'Objects': 'Objects', 'Password': 'Mot de passe', 'Personal': 'Personnel', 'Phase': 'Phase', 'Preferences': 'Préférences', 'Profile': 'Profil',
  'Search': 'Rechercher', 'Search settings…': 'Rechercher dans les paramètres…', 'Security & access': 'Sécurité et accès', 'Settings': 'Paramètres',
  'Sign in': 'Se connecter', 'Sign in to your Activity Space': "Connectez-vous à votre espace d’activité", 'Signing in...': 'Connexion...',
  'Sign up': "S’inscrire", 'Strategy': 'Strategy', 'Sustainment': 'Sustainment', 'System': 'Système', 'Table': 'Tableau', 'Team': 'Équipe',
  'Theme': 'Thème', 'Timeline': 'Chronologie', 'Tools': 'Outils', 'Type to search.': 'Saisissez votre recherche.', 'Use pointer cursors': 'Utiliser le curseur pointeur',
  'Welcome back': 'Heureux de vous revoir', 'Workload': 'Charge de travail', 'Your name': 'Votre nom',
  'Choose the language used across Alcon': 'Choisissez la langue utilisée dans Alcon',
  'A shared place for your team. Bring in one existing project to get started.': 'Un espace partagé pour votre équipe. Importez un projet existant pour commencer.',
  'We sent a confirmation link to {email}': 'Nous avons envoyé un lien de confirmation à {email}',
};

const es: TranslationMap = {
  'Grouping': 'Agrupación',
  'Ordering': 'Orden',
  'Sort by': 'Ordenar por',
  'Direction': 'Dirección',
  'Ascending': 'Ascendente',
  'Descending': 'Descendente',
  'Manual': 'Manual',
  'Display properties': 'Propiedades visibles',
  'Account': 'Cuenta', 'Activity space': 'Espacio de actividad', 'Administration': 'Administración', 'AI agent': 'Agente de IA',
  'Already have an account? ': '¿Ya tienes una cuenta? ', 'App sidebar': 'Barra lateral', 'At least 6 characters': 'Al menos 6 caracteres',
  'Back to sign in': 'Volver a iniciar sesión', 'Calendar': 'Calendario', 'Cancel': 'Cancelar', 'Check your email': 'Revisa tu correo',
  'Close tab': 'Cerrar pestaña', 'Connected accounts': 'Cuentas conectadas', 'Connection Error': 'Error de conexión', 'Create': 'Crear',
  'Create account': 'Crear cuenta', 'Create an account': 'Crear una cuenta', 'Create Domain': 'Crear Domain', 'Create new': 'Crear',
  'Create Space': 'Crear espacio', 'Create your Space': 'Crea tu espacio', 'Creating account...': 'Creando cuenta...', 'Customize': 'Personalizar',
  'Default': 'Predeterminado', 'Default home view': 'Vista de inicio predeterminada', 'Discover': 'Descubrir', 'Display names': 'Visualización de nombres',
  'Domain': 'Domain', 'Domain overview': 'Resumen del Domain', 'Domains': 'Domains', "Don't have an account? ": '¿No tienes una cuenta? ',
  'Email': 'Correo electrónico', 'Elements': 'Elements', 'Execution': 'Execution', 'First day of the week': 'Primer día de la semana', 'Font size': 'Tamaño del texto',
  'General': 'General', 'Get started with Alcon': 'Empieza a usar Alcon', 'Home': 'Inicio', 'Inbox': 'Bandeja de entrada', 'Initiatives': 'Initiatives',
  'Interface and theme': 'Interfaz y tema', 'Language': 'Idioma', 'Loading…': 'Cargando…', 'Member': 'Miembro', 'My Elements': 'Mis Elements',
  'Name': 'Nombre', 'New tab': 'Nueva pestaña', 'No results.': 'No hay resultados.', 'Notebook': 'Cuaderno', 'Notifications': 'Notificaciones', 'Now': 'Ahora',
  'Objects': 'Objects', 'Password': 'Contraseña', 'Personal': 'Personal', 'Phase': 'Phase', 'Preferences': 'Preferencias', 'Profile': 'Perfil',
  'Search': 'Buscar', 'Search settings…': 'Buscar en ajustes…', 'Security & access': 'Seguridad y acceso', 'Settings': 'Ajustes',
  'Sign in': 'Iniciar sesión', 'Sign in to your Activity Space': 'Inicia sesión en tu espacio de actividad', 'Signing in...': 'Iniciando sesión...',
  'Sign up': 'Registrarse', 'Strategy': 'Strategy', 'Sustainment': 'Sustainment', 'System': 'Sistema', 'Table': 'Tabla', 'Team': 'Equipo',
  'Theme': 'Tema', 'Timeline': 'Cronología', 'Tools': 'Herramientas', 'Type to search.': 'Escribe para buscar.', 'Use pointer cursors': 'Usar cursor de puntero',
  'Welcome back': 'Te damos la bienvenida', 'Workload': 'Carga de trabajo', 'Your name': 'Tu nombre',
  'Choose the language used across Alcon': 'Elige el idioma que se usará en Alcon',
  'A shared place for your team. Bring in one existing project to get started.': 'Un espacio compartido para tu equipo. Importa un proyecto existente para empezar.',
  'We sent a confirmation link to {email}': 'Enviamos un enlace de confirmación a {email}',
};

Object.assign(ja, {
  'A new note': '新しいノート', 'Add Notebook': 'ノートブックを追加', 'Add Table': 'テーブルを追加',
  'Adjust the size of text across the app': 'アプリ全体の文字サイズを調整します',
  'Change the cursor to a pointer over interactive elements': '操作できる要素にポインターカーソルを表示します',
  'Collapse': '折りたたむ', 'Convert text emoticons into emojis': '顔文字を絵文字に変換',
  'Customize sidebar item visibility, ordering, and badge style': 'サイドバー項目の表示、並び順、バッジを調整します',
  'Dark': 'ダーク', 'Discover Domains and Objects': 'Domains と Objects を見つける', 'Drag to resize': 'ドラッグしてサイズ変更',
  'Enter': 'Enter', 'Expand': '展開する', 'Full name': 'フルネーム', 'Hide AI': 'AI を隠す', 'Hide sidebar': 'サイドバーを隠す',
  'How names are shown across the interface': '画面全体での名前の表示方法', 'Labels': 'ラベル', 'Large': '大', 'Larger': 'より大',
  'Light': 'ライト', 'Match the system or pick a colour theme': 'システムに合わせるかカラーテーマを選びます',
  'Monday': '月曜日', 'Navigation': 'ナビゲーション', 'Note': 'ノート', 'Notes': 'ノート', 'Object': 'Object',
  'Remove {label} from the rail': 'レールから {label} を外す', 'Saturday': '土曜日', 'Search elements, objects, notes. Press ⌘K to open.': 'Elements、Objects、ノートを検索します。⌘K で開きます。',
  'Search elements, objects, notes…': 'Elements、Objects、ノートを検索…', 'Searching…': '検索中…',
  'Select which view to open when launching Alcon': 'Alcon の起動時に開くビューを選択します',
  'Send comment on…': 'コメントの送信キー', 'Short name': '短い名前', 'Show AI': 'AI を表示', 'Show sidebar': 'サイドバーを表示',
  'SLAs': 'SLA', 'Small': '小', 'Smaller': 'より小', 'Statuses': 'ステータス', 'Sunday': '日曜日',
  'Templates': 'テンプレート', 'Top-level container': '最上位のコンテナ', 'Try Again': '再試行', 'Updates': '更新',
  'Used for date pickers': '日付選択で使用します', 'Username': 'ユーザー名', 'Which key press submits a comment': 'コメントを送信するキー',
});

Object.assign(ko, {
  'A new note': '새 노트', 'Add Notebook': '노트북 추가', 'Add Table': '테이블 추가',
  'Adjust the size of text across the app': '앱 전체의 글자 크기를 조절합니다', 'Collapse': '접기',
  'Change the cursor to a pointer over interactive elements': '상호작용 요소에 포인터 커서를 표시합니다',
  'Convert text emoticons into emojis': '텍스트 이모티콘을 이모지로 변환', 'Customize sidebar item visibility, ordering, and badge style': '사이드바 표시, 순서, 배지 스타일을 설정합니다',
  'Dark': '다크', 'Discover Domains and Objects': 'Domains과 Objects 탐색', 'Drag to resize': '드래그하여 크기 조절', 'Enter': 'Enter', 'Expand': '펼치기', 'Full name': '전체 이름',
  'Hide AI': 'AI 숨기기', 'Hide sidebar': '사이드바 숨기기', 'Large': '큼', 'Larger': '더 큼',
  'How names are shown across the interface': '인터페이스에서 이름을 표시하는 방식', 'Labels': '라벨', 'Light': '라이트',
  'Match the system or pick a colour theme': '시스템에 맞추거나 색상 테마를 선택합니다',
  'Monday': '월요일', 'Navigation': '탐색', 'Note': '노트', 'Notes': '노트', 'Object': 'Object', 'Remove {label} from the rail': '레일에서 {label} 제거', 'Saturday': '토요일',
  'Search elements, objects, notes. Press ⌘K to open.': 'Elements, Objects, 노트를 검색합니다. ⌘K로 엽니다.',
  'Search elements, objects, notes…': 'Elements, Objects, 노트 검색…', 'Searching…': '검색 중…',
  'Select which view to open when launching Alcon': 'Alcon 시작 시 열 뷰를 선택합니다', 'Send comment on…': '댓글 제출 키', 'Short name': '짧은 이름',
  'Show AI': 'AI 표시', 'Show sidebar': '사이드바 표시', 'SLAs': 'SLA', 'Small': '작음', 'Smaller': '더 작음', 'Statuses': '상태', 'Sunday': '일요일', 'Templates': '템플릿', 'Top-level container': '최상위 컨테이너', 'Try Again': '다시 시도', 'Updates': '업데이트',
  'Used for date pickers': '날짜 선택기에 사용', 'Username': '사용자 이름', 'Which key press submits a comment': '댓글을 제출할 키',
});

Object.assign(fr, {
  'A new note': 'Une nouvelle note', 'Add Notebook': 'Ajouter un carnet', 'Add Table': 'Ajouter un tableau',
  'Adjust the size of text across the app': 'Ajuster la taille du texte dans toute l’application', 'Collapse': 'Réduire',
  'Change the cursor to a pointer over interactive elements': 'Afficher un pointeur sur les éléments interactifs', 'Convert text emoticons into emojis': 'Convertir les émoticônes en emojis',
  'Customize sidebar item visibility, ordering, and badge style': 'Personnaliser la visibilité, l’ordre et les badges de la barre latérale',
  'Dark': 'Sombre', 'Discover Domains and Objects': 'Découvrir les Domains et Objects', 'Drag to resize': 'Faire glisser pour redimensionner', 'Enter': 'Entrée', 'Expand': 'Développer', 'Full name': 'Nom complet',
  'Hide AI': 'Masquer l’IA', 'Hide sidebar': 'Masquer la barre latérale', 'Large': 'Grand', 'Larger': 'Très grand',
  'How names are shown across the interface': 'Mode d’affichage des noms dans l’interface', 'Labels': 'Étiquettes', 'Light': 'Clair',
  'Match the system or pick a colour theme': 'Suivre le système ou choisir un thème de couleur',
  'Monday': 'Lundi', 'Navigation': 'Navigation', 'Note': 'Note', 'Notes': 'Notes', 'Object': 'Object', 'Remove {label} from the rail': 'Retirer {label} de la barre', 'Saturday': 'Samedi',
  'Search elements, objects, notes. Press ⌘K to open.': 'Recherchez des Elements, Objects et notes. Appuyez sur ⌘K pour ouvrir.',
  'Search elements, objects, notes…': 'Rechercher des Elements, Objects et notes…', 'Searching…': 'Recherche…',
  'Select which view to open when launching Alcon': 'Choisir la vue ouverte au lancement d’Alcon', 'Send comment on…': 'Envoyer le commentaire avec…', 'Short name': 'Prénom',
  'Show AI': 'Afficher l’IA', 'Show sidebar': 'Afficher la barre latérale', 'SLAs': 'SLA', 'Small': 'Petit', 'Smaller': 'Très petit', 'Statuses': 'Statuts', 'Sunday': 'Dimanche', 'Templates': 'Modèles', 'Top-level container': 'Conteneur principal', 'Try Again': 'Réessayer', 'Updates': 'Mises à jour',
  'Used for date pickers': 'Utilisé dans les sélecteurs de date', 'Username': "Nom d’utilisateur", 'Which key press submits a comment': 'Touche utilisée pour envoyer un commentaire',
});

Object.assign(es, {
  'A new note': 'Una nota nueva', 'Add Notebook': 'Añadir cuaderno', 'Add Table': 'Añadir tabla',
  'Adjust the size of text across the app': 'Ajusta el tamaño del texto en toda la aplicación', 'Collapse': 'Contraer',
  'Change the cursor to a pointer over interactive elements': 'Mostrar un puntero sobre los elementos interactivos', 'Convert text emoticons into emojis': 'Convertir emoticonos de texto en emojis',
  'Customize sidebar item visibility, ordering, and badge style': 'Personaliza la visibilidad, el orden y las insignias de la barra lateral',
  'Dark': 'Oscuro', 'Discover Domains and Objects': 'Descubrir Domains y Objects', 'Drag to resize': 'Arrastra para cambiar el tamaño', 'Enter': 'Intro', 'Expand': 'Expandir', 'Full name': 'Nombre completo',
  'Hide AI': 'Ocultar IA', 'Hide sidebar': 'Ocultar barra lateral', 'Large': 'Grande', 'Larger': 'Más grande',
  'How names are shown across the interface': 'Cómo se muestran los nombres en la interfaz', 'Labels': 'Etiquetas', 'Light': 'Claro',
  'Match the system or pick a colour theme': 'Usa el tema del sistema o elige un tema de color',
  'Monday': 'Lunes', 'Navigation': 'Navegación', 'Note': 'Nota', 'Notes': 'Notas', 'Object': 'Object', 'Remove {label} from the rail': 'Quitar {label} de la barra', 'Saturday': 'Sábado',
  'Search elements, objects, notes. Press ⌘K to open.': 'Busca Elements, Objects y notas. Pulsa ⌘K para abrir.',
  'Search elements, objects, notes…': 'Buscar Elements, Objects y notas…', 'Searching…': 'Buscando…',
  'Select which view to open when launching Alcon': 'Selecciona la vista que se abrirá al iniciar Alcon', 'Send comment on…': 'Enviar comentario con…', 'Short name': 'Nombre corto',
  'Show AI': 'Mostrar IA', 'Show sidebar': 'Mostrar barra lateral', 'SLAs': 'SLA', 'Small': 'Pequeño', 'Smaller': 'Más pequeño', 'Statuses': 'Estados', 'Sunday': 'Domingo', 'Templates': 'Plantillas', 'Top-level container': 'Contenedor principal', 'Try Again': 'Reintentar', 'Updates': 'Actualizaciones',
  'Used for date pickers': 'Se usa en los selectores de fecha', 'Username': 'Nombre de usuario', 'Which key press submits a comment': 'Tecla que envía un comentario',
});

const commonMessages: Record<Exclude<Locale, 'en'>, TranslationMap> = {
  ja: {
    'Carbon': 'カーボン', "Couldn't save": '保存できませんでした', 'Domain Elements': 'Domain の Elements', 'Graphite': 'グラファイト',
    'Ivory': 'アイボリー', 'Mid-level structural unit': '中間レベルの構造単位', 'Midnight': 'ミッドナイト', 'Mist': 'ミスト',
    'New Element': '新しい Element', 'New Initiative': '新しい Initiative', 'New Object': '新しい Object',
    'No notebooks yet — click + to add one.': 'ノートブックはまだありません。+ で追加できます。',
    'No tables yet — click + to add one.': 'テーブルはまだありません。+ で追加できます。',
    'Open Calendar': 'カレンダーを開く', 'Open Inbox': '受信トレイを開く', 'Open Notebook': 'ノートブックを開く', 'Open Table': 'テーブルを開く', 'Open Team': 'チームを開く', 'Open Workload': 'ワークロードを開く',
    'Go to Now': '現在へ移動', 'Snow': 'スノー', 'Something went wrong': '問題が発生しました', 'Strings like :) will be converted to 🙂': ':) などの文字を 🙂 に変換します', 'Sustainment apps': 'Sustainment アプリ',
  },
  ko: {
    'Carbon': '카본', "Couldn't save": '저장할 수 없습니다', 'Domain Elements': 'Domain Elements', 'Graphite': '그래파이트', 'Ivory': '아이보리',
    'Mid-level structural unit': '중간 수준 구조 단위', 'Midnight': '미드나잇', 'Mist': '미스트', 'New Element': '새 Element', 'New Initiative': '새 Initiative', 'New Object': '새 Object',
    'No notebooks yet — click + to add one.': '노트북이 없습니다. +를 눌러 추가하세요.', 'No tables yet — click + to add one.': '테이블이 없습니다. +를 눌러 추가하세요.',
    'Open Calendar': '캘린더 열기', 'Open Inbox': '받은편지함 열기', 'Open Notebook': '노트북 열기', 'Open Table': '테이블 열기', 'Open Team': '팀 열기', 'Open Workload': '워크로드 열기',
    'Go to Now': '지금으로 이동', 'Snow': '스노우', 'Something went wrong': '문제가 발생했습니다', 'Strings like :) will be converted to 🙂': ':)와 같은 문자열을 🙂로 변환합니다', 'Sustainment apps': 'Sustainment 앱',
  },
  fr: {
    'Carbon': 'Carbone', "Couldn't save": 'Enregistrement impossible', 'Domain Elements': 'Elements du Domain', 'Graphite': 'Graphite', 'Ivory': 'Ivoire',
    'Mid-level structural unit': 'Unité structurelle intermédiaire', 'Midnight': 'Minuit', 'Mist': 'Brume', 'New Element': 'Nouvel Element', 'New Initiative': 'Nouvelle Initiative', 'New Object': 'Nouvel Object',
    'No notebooks yet — click + to add one.': 'Aucun carnet. Cliquez sur + pour en ajouter un.', 'No tables yet — click + to add one.': 'Aucun tableau. Cliquez sur + pour en ajouter un.',
    'Open Calendar': 'Ouvrir le calendrier', 'Open Inbox': 'Ouvrir la boîte de réception', 'Open Notebook': 'Ouvrir le carnet', 'Open Table': 'Ouvrir le tableau', 'Open Team': 'Ouvrir l’équipe', 'Open Workload': 'Ouvrir la charge de travail',
    'Go to Now': 'Aller à Maintenant', 'Snow': 'Neige', 'Something went wrong': 'Un problème est survenu', 'Strings like :) will be converted to 🙂': 'Les chaînes comme :) seront converties en 🙂', 'Sustainment apps': 'Applications Sustainment',
  },
  es: {
    'Carbon': 'Carbono', "Couldn't save": 'No se pudo guardar', 'Domain Elements': 'Elements del Domain', 'Graphite': 'Grafito', 'Ivory': 'Marfil',
    'Mid-level structural unit': 'Unidad estructural intermedia', 'Midnight': 'Medianoche', 'Mist': 'Niebla', 'New Element': 'Nuevo Element', 'New Initiative': 'Nueva Initiative', 'New Object': 'Nuevo Object',
    'No notebooks yet — click + to add one.': 'Todavía no hay cuadernos. Pulsa + para añadir uno.', 'No tables yet — click + to add one.': 'Todavía no hay tablas. Pulsa + para añadir una.',
    'Open Calendar': 'Abrir calendario', 'Open Inbox': 'Abrir bandeja de entrada', 'Open Notebook': 'Abrir cuaderno', 'Open Table': 'Abrir tabla', 'Open Team': 'Abrir equipo', 'Open Workload': 'Abrir carga de trabajo',
    'Go to Now': 'Ir a Ahora', 'Snow': 'Nieve', 'Something went wrong': 'Algo salió mal', 'Strings like :) will be converted to 🙂': 'Las cadenas como :) se convertirán en 🙂', 'Sustainment apps': 'Aplicaciones Sustainment',
  },
};

const MESSAGES_PLACEHOLDER: Record<Exclude<Locale, 'en'>, TranslationMap> = { ja, ko, fr, es };
for (const locale of Object.keys(commonMessages) as Array<Exclude<Locale, 'en'>>) {
  Object.assign(MESSAGES_PLACEHOLDER[locale], commonMessages[locale]);
}
export const MESSAGES = MESSAGES_PLACEHOLDER;

Object.assign(ja, {
  'Today': '今日', 'People': 'メンバー', 'Previous month': '前の月', 'Next month': '次の月', 'Show all': 'すべて表示', 'Edit profile': 'プロフィールを編集', 'New Initiative': '新しい Initiative', 'Add schedule': '予定を追加', 'New section': '新しいセクション', 'New page': '新しいページ', 'Rename': '名前を変更', 'Delete notebook': 'ノートブックを削除', 'Delete section': 'セクションを削除', 'My Notes': 'マイノート', 'No notes yet.': 'ノートはまだありません。', 'No one is scheduled here.': 'この予定表に担当者はいません。',
});

Object.assign(ko, {
  'Today': '오늘', 'People': '사람', 'Previous month': '이전 달', 'Next month': '다음 달', 'Show all': '모두 표시', 'Edit profile': '프로필 편집', 'New Initiative': '새 Initiative', 'Add schedule': '일정 추가', 'New section': '새 섹션', 'New page': '새 페이지', 'Rename': '이름 바꾸기', 'Delete notebook': '노트북 삭제', 'Delete section': '섹션 삭제', 'My Notes': '내 노트', 'No notes yet.': '아직 노트가 없습니다.', 'No one is scheduled here.': '이 캘린더에 배정된 사람이 없습니다.',
});

Object.assign(fr, {
  'Today': "Aujourd'hui", 'People': 'Personnes', 'Previous month': 'Mois précédent', 'Next month': 'Mois suivant', 'Show all': 'Tout afficher', 'Edit profile': 'Modifier le profil', 'New Initiative': 'Nouvelle Initiative', 'Add schedule': 'Ajouter au calendrier', 'New section': 'Nouvelle section', 'New page': 'Nouvelle page', 'Rename': 'Renommer', 'Delete notebook': 'Supprimer le carnet', 'Delete section': 'Supprimer la section', 'My Notes': 'Mes notes', 'No notes yet.': 'Aucune note pour l’instant.', 'No one is scheduled here.': 'Personne n’est planifié ici.',
});

Object.assign(es, {
  'Today': 'Hoy', 'People': 'Personas', 'Previous month': 'Mes anterior', 'Next month': 'Mes siguiente', 'Show all': 'Mostrar todo', 'Edit profile': 'Editar perfil', 'New Initiative': 'Nueva Initiative', 'Add schedule': 'Añadir al calendario', 'New section': 'Nueva sección', 'New page': 'Nueva página', 'Rename': 'Renombrar', 'Delete notebook': 'Eliminar cuaderno', 'Delete section': 'Eliminar sección', 'My Notes': 'Mis notas', 'No notes yet.': 'Aún no hay notas.', 'No one is scheduled here.': 'Nadie está programado aquí.',
});
