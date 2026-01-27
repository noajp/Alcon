'use client';

import { useEffect, useCallback, useRef, useState } from 'react';
import { Excalidraw, MainMenu, WelcomeScreen } from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';
import { useTheme } from 'next-themes';

// Using inline types to avoid deep import path issues
// eslint-disable-next-line @typescript-eslint/no-explicit-any
interface ExcalidrawSnapshot {
  elements?: readonly any[];
  appState?: any;
  files?: any;
}

interface CanvasEditorProps {
  initialSnapshot?: ExcalidrawSnapshot;
  onSave?: (snapshot: object) => void;
  autoSaveDelay?: number;
}

export function CanvasEditor({
  initialSnapshot,
  onSave,
  autoSaveDelay = 2000,
}: CanvasEditorProps) {
  const { resolvedTheme } = useTheme();
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastSnapshotRef = useRef<string>('');
  const [mounted, setMounted] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [excalidrawAPI, setExcalidrawAPI] = useState<any>(null);

  // Handle client-side mounting
  useEffect(() => {
    setMounted(true);
  }, []);

  // Force dark background when API is ready
  useEffect(() => {
    if (excalidrawAPI) {
      excalidrawAPI.updateScene({
        appState: {
          viewBackgroundColor: '#1a1a1a',
        },
      });
    }
  }, [excalidrawAPI]);

  // Handle changes and auto-save
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleChange = useCallback(
    (elements: readonly any[], appState: any, files: any) => {
      if (!onSave) return;

      // Debounce save
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }

      saveTimeoutRef.current = setTimeout(() => {
        const snapshot = {
          elements: elements,
          appState: {
            viewBackgroundColor: appState.viewBackgroundColor,
            currentItemFontFamily: appState.currentItemFontFamily,
            zoom: appState.zoom,
            scrollX: appState.scrollX,
            scrollY: appState.scrollY,
          },
          files: files,
        };
        const snapshotStr = JSON.stringify(snapshot);

        // Only save if changed
        if (snapshotStr !== lastSnapshotRef.current) {
          lastSnapshotRef.current = snapshotStr;
          onSave(snapshot);
        }
      }, autoSaveDelay);
    },
    [onSave, autoSaveDelay]
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);

  // Don't render on server
  if (!mounted) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-background">
        <div className="text-muted-foreground">Loading canvas...</div>
      </div>
    );
  }

  return (
    <div className="w-full h-full">
      <Excalidraw
        excalidrawAPI={(api) => setExcalidrawAPI(api)}
        initialData={{
          elements: (initialSnapshot?.elements || []) as never,
          appState: {
            viewBackgroundColor: '#1a1a1a',
          } as never,
          files: (initialSnapshot?.files || {}) as never,
        }}
        onChange={handleChange}
        theme="dark"
        langCode="en"
        UIOptions={{
          canvasActions: {
            loadScene: false,
            export: { saveFileToDisk: true },
            changeViewBackgroundColor: false,
          },
        }}
      >
        <MainMenu>
          <MainMenu.DefaultItems.ClearCanvas />
          <MainMenu.DefaultItems.SaveAsImage />
          <MainMenu.Separator />
          <MainMenu.DefaultItems.ToggleTheme />
        </MainMenu>
        <WelcomeScreen>
          <WelcomeScreen.Hints.MenuHint />
          <WelcomeScreen.Hints.ToolbarHint />
        </WelcomeScreen>
      </Excalidraw>
    </div>
  );
}
