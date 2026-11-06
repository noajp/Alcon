// Slides の書体は同梱する（Google Fonts に取りに行かない。オフラインでも、取得の失敗でビルドが止まらない）。
// スライドを描く部品からだけ読み込むので、Alcon の他の画面には載らない。
// 日本語の書体は文字の範囲ごとに分かれていて、使う文字の分だけ読み込まれる。
// Inter と Noto は Design と同じ public/design-fonts/ の可変フォントを使う。太さ別に別の束を
// 持つと、日本語だけでデプロイ1件に数十MB が重なって入る
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource/ibm-plex-mono/600.css";

const SHARED = ["inter", "noto-sans-jp", "noto-serif-jp"];

if (typeof document !== "undefined") {
  for (const folder of SHARED) {
    const href = `/design-fonts/${folder}/font.css`;
    if (document.head.querySelector(`link[href="${href}"]`)) continue;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    document.head.appendChild(link);
  }
}
