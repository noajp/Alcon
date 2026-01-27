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
  useSelectedBlocks,
} from '@blocknote/react';
import '@blocknote/core/fonts/inter.css';
import '@blocknote/mantine/style.css';
import { Component, ReactNode } from 'react';
import { useTheme } from 'next-themes';
import { createPortal } from 'react-dom';
import { useEffect, useState } from 'react';
import {
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  CheckSquare,
  ChevronRight,
  Table,
  Image,
  Video,
  FileAudio,
  File,
  Code,
  Quote,
  Type,
  Palette,
} from 'lucide-react';

interface BlockEditorProps {
  initialContent?: string;
  onChange?: (content: string) => void;
  editable?: boolean;
  toolbarContainerId?: string;
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

// Toolbar component that renders via portal
function ToolbarPortal({ containerId, children }: { containerId: string; children: ReactNode }) {
  const [container, setContainer] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const el = document.getElementById(containerId);
    setContainer(el);
  }, [containerId]);

  if (!container) return null;
  return createPortal(children, container);
}

function BlockEditorInner({ initialContent, onChange, editable = true, toolbarContainerId }: BlockEditorProps) {
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
      <BlockNoteView
        editor={editor}
        editable={editable}
        onChange={() => {
          onChange?.(JSON.stringify(editor.document));
        }}
        theme={resolvedTheme === 'dark' ? 'dark' : 'light'}
        formattingToolbar={false}
        sideMenu={false}
        slashMenu={false}
      >
        {toolbarContainerId ? (
          <ToolbarPortal containerId={toolbarContainerId}>
            <div className="bn-toolbar-wrapper">
              <FullFormattingToolbar />
            </div>
          </ToolbarPortal>
        ) : (
          <FullFormattingToolbar />
        )}
      </BlockNoteView>

      <style jsx global>{`
        /* Editor styling */
        .blocknote-editor .bn-container {
          height: 100%;
        }

        .blocknote-editor .bn-editor {
          padding: 0;
          background: transparent;
        }

        /* Toolbar in portal - BIGGER */
        .bn-toolbar-wrapper .bn-formatting-toolbar {
          border: none;
          box-shadow: none;
          background: var(--card);
          padding: 6px 0;
          margin: 0;
          border-radius: 0;
          width: 100%;
          justify-content: flex-start;
          flex-wrap: wrap;
          gap: 4px;
        }

        /* Bigger toolbar buttons */
        .bn-toolbar-wrapper .bn-formatting-toolbar button,
        .bn-toolbar-wrapper .bn-formatting-toolbar [data-state] {
          min-width: 36px;
          min-height: 36px;
          padding: 6px;
        }

        .bn-toolbar-wrapper .bn-formatting-toolbar button svg {
          width: 18px;
          height: 18px;
        }

        /* Color button with visible indicator */
        .bn-toolbar-wrapper .bn-color-picker-button,
        .bn-toolbar-wrapper [data-color-picker] {
          position: relative;
        }

        /* Make color indicator more visible */
        .bn-toolbar-wrapper .bn-color-picker-button::after,
        .bn-toolbar-wrapper .bn-formatting-toolbar [class*="color"] .bn-button-icon::after {
          content: '';
          position: absolute;
          bottom: 4px;
          left: 50%;
          transform: translateX(-50%);
          width: 16px;
          height: 3px;
          border-radius: 2px;
          background: currentColor;
        }

        /* Inline toolbar fallback */
        .blocknote-editor .bn-formatting-toolbar {
          position: sticky;
          top: 0;
          z-index: 10;
          border-bottom: 1px solid hsl(var(--border));
          background: var(--card);
          padding: 8px;
          margin: 0;
          border-radius: 0;
          box-shadow: none;
          width: 100%;
          justify-content: flex-start;
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
