// The Design widget's strings, one row per message: [ja, ko, fr, es].
type Row = [ja: string, ko: string, fr: string, es: string];

const DESIGN_MESSAGES: Record<string, Row> = {
  'Design': ['デザイン', '디자인', 'Design', 'Diseño'],
  'An artboard in HTML and SVG, drawn and revised with AI': ['HTML と SVG で描くアートボード。AI で作って直す', 'HTML과 SVG로 그리는 아트보드. AI로 만들고 고칩니다', 'Un plan de travail en HTML et SVG, dessiné et révisé avec l’IA', 'Un lienzo en HTML y SVG, dibujado y revisado con IA'],
  'Loading the design…': ['デザインを読み込み中…', '디자인 불러오는 중…', 'Chargement du design…', 'Cargando el diseño…'],
  'Could not save the design.': ['デザインを保存できませんでした。', '디자인을 저장하지 못했습니다.', 'Impossible d’enregistrer le design.', 'No se pudo guardar el diseño.'],
  'Revise with AI': ['AI で直す', 'AI로 수정', 'Réviser avec l’IA', 'Revisar con IA'],
  'Design actions': ['デザインの操作', '디자인 작업', 'Actions sur le design', 'Acciones del diseño'],
  'Copy HTML and CSS': ['HTML と CSS をコピー', 'HTML과 CSS 복사', 'Copier le HTML et le CSS', 'Copiar HTML y CSS'],
  'Download as HTML': ['HTML としてダウンロード', 'HTML로 다운로드', 'Télécharger en HTML', 'Descargar como HTML'],
  'Bring back the previous design': ['前のデザインに戻す', '이전 디자인으로 되돌리기', 'Revenir au design précédent', 'Recuperar el diseño anterior'],
  'Preview: {title}': ['プレビュー: {title}', '미리보기: {title}', 'Aperçu : {title}', 'Vista previa: {title}'],
  'Copied.': ['コピーしました。', '복사했습니다.', 'Copié.', 'Copiado.'],
  'Preview · only you see this until you use it. It then replaces the design for everyone.': ['プレビュー · 使うまではあなただけに見えます。使うと全員のデザインが置き換わります。', '미리보기 · 사용하기 전까지는 나만 볼 수 있습니다. 사용하면 모두의 디자인이 바뀝니다.', 'Aperçu · vous seul le voyez tant que vous ne l’utilisez pas. Il remplace alors le design pour tout le monde.', 'Vista previa · solo tú la ves hasta que la uses. Entonces reemplaza el diseño para todos.'],
  'Use this design': ['このデザインを使う', '이 디자인 사용', 'Utiliser ce design', 'Usar este diseño'],
  'Describe a screen, a card, a slide visual or a diagram. AI draws it in HTML and SVG at a fixed size; you can revise it by describing what to change.': ['画面、カード、スライドの図版、図解などを説明してください。AI が HTML と SVG で決まったサイズに描きます。変えたいところを説明すれば直せます。', '화면, 카드, 슬라이드 그림, 다이어그램 등을 설명하세요. AI가 HTML과 SVG로 정해진 크기에 그립니다. 바꿀 점을 설명하면 고칠 수 있습니다.', 'Décrivez un écran, une carte, un visuel de diapositive ou un schéma. L’IA le dessine en HTML et SVG à une taille fixe ; décrivez ce qu’il faut changer pour le réviser.', 'Describe una pantalla, una tarjeta, un visual de diapositiva o un diagrama. La IA lo dibuja en HTML y SVG a un tamaño fijo; descríbele qué cambiar para revisarlo.'],
  'Describe the design': ['デザインを説明', '디자인 설명', 'Décrire le design', 'Describir el diseño'],
  'Example: Make the headline larger, move the price under it, and use the accent colour for the button.': ['例：見出しを大きくし、価格をその下へ。ボタンはアクセントカラーに。', '예: 제목을 더 크게, 가격은 그 아래로, 버튼은 강조 색으로.', 'Exemple : agrandir le titre, placer le prix dessous et mettre le bouton dans la couleur d’accent.', 'Ejemplo: agranda el titular, pon el precio debajo y usa el color de acento en el botón.'],
  'Example: A 1200 × 800 pricing section with three plans, the middle one highlighted.': ['例：1200 × 800 の料金セクション。3 つのプランで、真ん中を強調。', '예: 1200 × 800 가격 섹션. 세 가지 플랜 중 가운데를 강조.', 'Exemple : une section tarifaire de 1200 × 800 avec trois offres, celle du milieu mise en avant.', 'Ejemplo: una sección de precios de 1200 × 800 con tres planes, el del medio destacado.'],
  'Generate design': ['デザインを生成', '디자인 생성', 'Générer le design', 'Generar diseño'],
  'Reload saved design': ['保存したデザインを読み直す', '저장된 디자인 다시 불러오기', 'Recharger le design enregistré', 'Volver a cargar el diseño guardado'],
  'No design yet.': ['デザインはまだありません。', '아직 디자인이 없습니다.', 'Pas encore de design.', 'Aún no hay diseño.'],
  'Load the design before saving.': ['保存する前にデザインを読み込んでください。', '저장하기 전에 디자인을 불러오세요.', 'Chargez le design avant d’enregistrer.', 'Carga el diseño antes de guardar.'],
  'Sign in to save your design.': ['デザインを保存するにはサインインしてください。', '디자인을 저장하려면 로그인하세요.', 'Connectez-vous pour enregistrer votre design.', 'Inicia sesión para guardar tu diseño.'],
  'Generate a design first.': ['先にデザインを生成してください。', '먼저 디자인을 생성하세요.', 'Générez d’abord un design.', 'Genera primero un diseño.'],
  'There is no earlier design.': ['前のデザインはありません。', '이전 디자인이 없습니다.', 'Il n’y a pas de design précédent.', 'No hay un diseño anterior.'],
};

const column = (index: 0 | 1 | 2 | 3) => Object.fromEntries(Object.entries(DESIGN_MESSAGES).map(([key, row]) => [key, row[index]]));

export const DESIGN_TRANSLATIONS = { ja: column(0), ko: column(1), fr: column(2), es: column(3) };
