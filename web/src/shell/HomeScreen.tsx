'use client';

// The Home main surface. The pinned items ("Home に表示") live in the Home
// sidebar, grouped by layer section (see HomePinsTree in AppSidebar); this pane
// is the landing canvas.
export function HomeScreen() {
  return (
    <div className="flex-1 flex items-center justify-center bg-card px-6">
      <div className="max-w-sm text-center">
        <h1 className="text-[15px] font-semibold text-foreground">Home</h1>
        <p className="mt-1.5 text-[12px] text-muted-foreground leading-relaxed">
          各機能で「Home に表示」を選んだ項目が、左のサイドバーに Action /
          Materialization / Execution のセクションで集まります。
        </p>
      </div>
    </div>
  );
}
