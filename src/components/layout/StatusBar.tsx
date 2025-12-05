'use client';

export function StatusBar() {
  return (
    <div className="h-[var(--statusbar-height)] flex items-center justify-between px-2 bg-[var(--accent-primary)] text-white text-[12px]">
      {/* Left Side */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-1">
          <span>&#128274;</span>
          <span>main</span>
        </div>
        <div className="flex items-center gap-1">
          <span>&#10003;</span>
          <span>Synced</span>
        </div>
        <div className="flex items-center gap-1">
          <span>&#129302;</span>
          <span>AI Active</span>
        </div>
      </div>

      {/* Right Side */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-yellow-400" />
          <span>2 pending</span>
        </div>
        <div>v12</div>
        <div className="flex items-center gap-1">
          <span>&#128101;</span>
          <span>3 online</span>
        </div>
      </div>
    </div>
  );
}
