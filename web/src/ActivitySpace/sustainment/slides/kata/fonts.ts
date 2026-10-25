// Slides の書体は同梱する（Google Fonts に取りに行かない。オフラインでも、取得の失敗でビルドが止まらない）。
// スライドを描く部品からだけ読み込むので、Alcon の他の画面には載らない。
// 日本語の書体は文字の範囲ごとに分かれていて、使う文字の分だけ読み込まれる
import "@fontsource-variable/inter/index.css";
import "@fontsource/noto-sans-jp/400.css";
import "@fontsource/noto-sans-jp/500.css";
import "@fontsource/noto-sans-jp/700.css";
import "@fontsource/noto-serif-jp/500.css";
import "@fontsource/noto-serif-jp/700.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource/ibm-plex-mono/600.css";
