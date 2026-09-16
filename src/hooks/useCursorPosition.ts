import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";

export interface CursorPositionPayload {
  x: number;
  y: number;
  normalized: boolean;
  isClicking: boolean;
  timestamp: number;
}

export interface CursorPositionState {
  cursorX: number;
  cursorY: number;
  isClicking: boolean;
}

export function useCursorPosition(): CursorPositionState {
  const [cursorPos, setCursorPos] = useState<CursorPositionState>({
    cursorX: 0.5,
    cursorY: 0.5,
    isClicking: false,
  });

  useEffect(() => {
    let unlisten: (() => void) | undefined;

    listen<CursorPositionPayload>("cursor-position", (event) => {
      const { x, y, isClicking } = event.payload;
      setCursorPos({
        cursorX: x,
        cursorY: y,
        isClicking,
      });
    }).then((unlistenFn) => {
      unlisten = unlistenFn;
    });

    return () => {
      unlisten?.();
    };
  }, []);

  return cursorPos;
}
