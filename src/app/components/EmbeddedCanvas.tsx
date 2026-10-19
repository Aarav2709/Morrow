import { Maximize2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { displayTitle } from '../../core/model';
import type { PageId } from '../../core/model';
import { isEffectivelyTrashed } from '../../core/tree';
import { getPreferences, setPreferences, usePreferences } from '../platform/preferences';
import type { CanvasSize } from '../platform/preferences';
import { openPage } from '../router';
import { useWorkspace } from '../workspace';
import { CanvasView } from './CanvasView';
import { PageIcon } from './Sidebar';

const MIN_WIDTH = 360;
const MIN_HEIGHT = 180;
const MAX_HEIGHT = 1600;
const DEFAULT_HEIGHT = 420;

// a canvas living inside another page, fully usable, sized by dragging its corner
export function EmbeddedCanvas({ pageId, editable }: { pageId: PageId; editable: boolean }) {
  const state = useWorkspace();
  const remembered = usePreferences().canvasSizes[pageId];
  const [resizing, setResizing] = useState<CanvasSize | null>(null);
  const frame = useRef<HTMLDivElement>(null);
  const page = state.pages[pageId];
  if (page?.kind !== 'canvas') return null;
  const size = resizing ?? remembered;

  const onPointerDown = (event: React.PointerEvent<HTMLSpanElement>) => {
    const element = frame.current;
    if (!element || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const start = { x: event.clientX, y: event.clientY };
    const rect = element.getBoundingClientRect();
    // the room the page gives the canvas, not the canvas's own box which may have been made narrower
    const room = element.parentElement?.parentElement?.getBoundingClientRect().width ?? rect.width;
    const grip = event.currentTarget;
    let latest: CanvasSize = { width: rect.width, height: rect.height };
    const move = (moved: PointerEvent) => {
      const width = Math.round(Math.min(room, Math.max(MIN_WIDTH, rect.width + moved.clientX - start.x)));
      const height = Math.round(
        Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, rect.height + moved.clientY - start.y)),
      );
      latest = { width: width >= room - 1 ? null : width, height };
      setResizing(latest);
    };
    const up = () => {
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', up);
      grip.removeEventListener('pointercancel', up);
      setPreferences({ canvasSizes: { ...getPreferences().canvasSizes, [pageId]: latest } });
      setResizing(null);
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up);
    grip.addEventListener('pointercancel', up);
  };

  return (
    <div className="inline-canvas" style={size?.width ? { width: `min(100%, ${size.width}px)` } : undefined}>
      <div className="inline-database-head">
        <button type="button" className="inline-database-title" onClick={() => openPage(page.id)}>
          <PageIcon page={page} />
          <span>{displayTitle(page)}</span>
        </button>
        <button
          type="button"
          className="icon-button"
          title="Open as a full page"
          aria-label="Open as a full page"
          onClick={() => openPage(page.id)}
        >
          <Maximize2 size={14} />
        </button>
      </div>
      <div ref={frame} className="inline-canvas-frame" style={{ height: size?.height ?? DEFAULT_HEIGHT }}>
        <CanvasView
          embedded
          pageId={pageId}
          doc={state.docs[pageId]}
          editable={editable && !isEffectivelyTrashed(state.pages, pageId)}
        />
        <span
          className="inline-canvas-resize"
          role="separator"
          aria-label="Drag to resize"
          title="Drag to resize"
          onPointerDown={onPointerDown}
        />
      </div>
    </div>
  );
}
