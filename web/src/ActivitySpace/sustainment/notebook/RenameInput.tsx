'use client';

// Inline rename field used by Folder, Section and Page rows. Enter commits,
// Esc cancels, blur commits. Guards the IME-confirm Enter (isComposing) so a
// Japanese conversion-commit doesn't submit the rename early.
export function RenameInput({
  initial,
  onCommit,
  onCancel,
  className = '',
}: {
  initial: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
  className?: string;
}) {
  return (
    <input
      autoFocus
      defaultValue={initial}
      onClick={(e) => e.stopPropagation()}
      onFocus={(e) => e.currentTarget.select()}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
          e.preventDefault();
          onCommit(e.currentTarget.value.trim());
        } else if (e.key === 'Escape') {
          e.preventDefault();
          onCancel();
        }
      }}
      onBlur={(e) => onCommit(e.currentTarget.value.trim())}
      className={`no-focus-ring outline-none border-0 p-0 ${className}`}
    />
  );
}
