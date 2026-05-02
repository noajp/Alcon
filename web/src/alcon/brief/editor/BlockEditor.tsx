'use client';

import { useCreateBlockNote, useBlockNoteEditor } from '@blocknote/react';
import { BlockNoteView } from '@blocknote/mantine';
import {
  FormattingToolbar,
  BasicTextStyleButton,
  TextAlignButton,
  ColorStyleButton,
  NestBlockButton,
  UnnestBlockButton,
  CreateLinkButton,
  useComponentsContext,
} from '@blocknote/react';
import '@blocknote/core/fonts/inter.css';
import '@blocknote/mantine/style.css';
import { Component, ReactNode } from 'react';
import { useTheme } from 'next-themes';
import {
  Heading1, Heading2, Heading3,
  List, ListOrdered, CheckSquare, ChevronRight,
  Table, Image, Video, FileAudio, File, Code, Quote, Type,
} from 'lucide-react';

interface BlockEditorProps {
  initialContent?: string;
  onChange?: (content: string) => void;
  editable?: boolean;
}

// Error Boundary for BlockNote
interface ErrorBoundaryState {
  hasError: boolean;
  error?: Error;
}

class BlockEditorErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="p-4 text-red-400 bg-red-900/20 rounded">
          <p className="font-medium">Editor failed to load</p>
          <p className="text-sm text-red-300 mt-1">{this.state.error?.message}</p>
        </div>
      );
    }
    return this.props.children;
  }
}

// Custom Insert Block Button
function InsertBlockButton({
  blockType,
  icon: Icon,
  label,
  props = {},
}: {
  blockType: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  props?: Record<string, unknown>;
}) {
  const editor = useBlockNoteEditor();
  const Components = useComponentsContext();

  if (!Components) return null;

  const handleClick = () => {
    const currentBlock = editor.getTextCursorPosition().block;
    editor.insertBlocks(
      [{ type: blockType as never, props: props as never }],
      currentBlock,
      'after'
    );
  };

  return (
    <Components.FormattingToolbar.Button
      mainTooltip={label}
      onClick={handleClick}
    >
      <Icon size={18} />
    </Components.FormattingToolbar.Button>
  );
}

// Toolbar Separator
function ToolbarSeparator() {
  return <div className="w-px h-6 bg-border mx-1" />;
}

// Custom Full Toolbar
function FullFormattingToolbar() {
  return (
    <FormattingToolbar>
      {/* Text Styles */}
      <BasicTextStyleButton basicTextStyle="bold" key="bold" />
      <BasicTextStyleButton basicTextStyle="italic" key="italic" />
      <BasicTextStyleButton basicTextStyle="underline" key="underline" />
      <BasicTextStyleButton basicTextStyle="strike" key="strike" />
      <BasicTextStyleButton basicTextStyle="code" key="code" />

      <ToolbarSeparator />

      {/* Text Alignment */}
      <TextAlignButton textAlignment="left" key="alignLeft" />
      <TextAlignButton textAlignment="center" key="alignCenter" />
      <TextAlignButton textAlignment="right" key="alignRight" />

      <ToolbarSeparator />

      {/* Colors */}
      <ColorStyleButton key="colors" />

      <ToolbarSeparator />

      {/* Typography */}
      <InsertBlockButton blockType="paragraph" icon={Type} label="Paragraph" />
      <InsertBlockButton blockType="heading" icon={Heading1} label="Heading 1" props={{ level: 1 }} />
      <InsertBlockButton blockType="heading" icon={Heading2} label="Heading 2" props={{ level: 2 }} />
      <InsertBlockButton blockType="heading" icon={Heading3} label="Heading 3" props={{ level: 3 }} />

      <ToolbarSeparator />

      {/* Lists */}
      <InsertBlockButton blockType="bulletListItem" icon={List} label="Bullet List" />
      <InsertBlockButton blockType="numberedListItem" icon={ListOrdered} label="Numbered List" />
      <InsertBlockButton blockType="checkListItem" icon={CheckSquare} label="Check List" />
      <InsertBlockButton blockType="toggleListItem" icon={ChevronRight} label="Toggle List" />

      <ToolbarSeparator />

      {/* Advanced */}
      <InsertBlockButton blockType="table" icon={Table} label="Table" />
      <InsertBlockButton blockType="codeBlock" icon={Code} label="Code Block" />
      <InsertBlockButton blockType="quote" icon={Quote} label="Quote" />

      <ToolbarSeparator />

      {/* Media */}
      <InsertBlockButton blockType="image" icon={Image} label="Image" />
      <InsertBlockButton blockType="video" icon={Video} label="Video" />
      <InsertBlockButton blockType="audio" icon={FileAudio} label="Audio" />
      <InsertBlockButton blockType="file" icon={File} label="File" />

      <ToolbarSeparator />

      {/* Structure */}
      <NestBlockButton key="nest" />
      <UnnestBlockButton key="unnest" />
      <CreateLinkButton key="link" />
    </FormattingToolbar>
  );
}

function BlockEditorInner({ initialContent, onChange, editable = true }: BlockEditorProps) {
  const { resolvedTheme } = useTheme();

  let parsedContent = undefined;
  if (initialContent) {
    try {
      const parsed = JSON.parse(initialContent);
      if (Array.isArray(parsed) && parsed.length > 0) {
        parsedContent = parsed;
      }
    } catch {
      // Invalid JSON, use undefined
    }
  }

  const editor = useCreateBlockNote({
    initialContent: parsedContent,
    tables: {
      splitCells: true,
      cellBackgroundColor: true,
      cellTextColor: true,
      headers: true,
    },
    placeholders: {
      default: '',
      heading: '',
      bulletListItem: '',
      numberedListItem: '',
      checkListItem: '',
    },
  });

  return (
    <div className="blocknote-editor h-full">
      {/* Notion-style: floating toolbar on selection, / commands. Side drag handles hidden. */}
      <BlockNoteView
        editor={editor}
        editable={editable}
        onChange={() => {
          onChange?.(JSON.stringify(editor.document));
        }}
        theme={resolvedTheme === 'dark' ? 'dark' : 'light'}
        sideMenu={false}
      >
        <FullFormattingToolbar />
      </BlockNoteView>

      <style jsx global>{`
        /* BlockNote → Alcon design tokens */
        .blocknote-editor {
          --bn-colors-editor-background: transparent;
          --bn-colors-editor-text: var(--foreground);
          --bn-colors-menu-background: var(--popover);
          --bn-colors-menu-text: var(--foreground);
          --bn-colors-tooltip-background: var(--popover);
          --bn-colors-tooltip-text: var(--popover-foreground);
          --bn-colors-hovered-background: var(--accent);
          --bn-colors-hovered-text: var(--accent-foreground);
          --bn-colors-selected-background: var(--accent);
          --bn-colors-selected-text: var(--accent-foreground);
          --bn-colors-disabled-background: var(--muted);
          --bn-colors-disabled-text: var(--muted-foreground);
          --bn-colors-border: var(--border);
          --bn-colors-side-menu: var(--muted-foreground);
        }

        .blocknote-editor .bn-container { height: 100%; background: transparent; }
        .blocknote-editor .bn-editor   { padding: 0; background: transparent; }

        /* Floating formatting toolbar (appears on text selection) */
        .blocknote-editor .bn-formatting-toolbar {
          border: 1px solid var(--border);
          border-radius: 8px;
          box-shadow: 0 4px 16px rgba(0,0,0,0.15);
          background: var(--popover);
          padding: 4px;
          gap: 2px;
        }

        /* Divider lines in document — very subtle */
        .blocknote-editor hr {
          border: none;
          border-top: 1px solid color-mix(in srgb, var(--border) 40%, transparent);
          margin: 1.25em 0;
        }
      `}</style>
    </div>
  );
}

export function BlockEditor(props: BlockEditorProps) {
  return (
    <BlockEditorErrorBoundary>
      <BlockEditorInner {...props} />
    </BlockEditorErrorBoundary>
  );
}
