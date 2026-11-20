import { Bot, GripHorizontal, X } from 'lucide-react';
import { useState } from 'react';
import { desktop } from '../platform/desktop';
import { getPreferences, setPreferences, usePreferences } from '../platform/preferences';
import { openDialog } from '../ui';
import { AgentClientView } from './AgentClientView';
import { useAcpStore } from './acpStore';

export function FloatingAgentChat() {
  const prefs = usePreferences();
  const store = useAcpStore();
  const [open, setOpen] = useState(false);

  if (!prefs.acpFloatingEnabled || !desktop?.acp) return null;

  const waiting = store.sessions.some((s) => s.status === 'waiting-permission');
  const bounds = prefs.acpFloatingBounds ?? {
    x: Math.max(24, (typeof window !== 'undefined' ? window.innerWidth : 1200) - 440),
    y: Math.max(24, (typeof window !== 'undefined' ? window.innerHeight : 800) - 560),
    width: 400,
    height: 520,
  };

  const startDrag = (event: React.PointerEvent) => {
    if ((event.target as HTMLElement).closest('button, select, input')) return;
    event.preventDefault();
    const startX = event.clientX;
    const startY = event.clientY;
    const base = getPreferences().acpFloatingBounds ?? bounds;
    const onMove = (move: PointerEvent) => {
      setPreferences({
        acpFloatingBounds: {
          ...base,
          x: Math.max(8, Math.min(window.innerWidth - base.width - 8, base.x + move.clientX - startX)),
          y: Math.max(8, Math.min(window.innerHeight - base.height - 8, base.y + move.clientY - startY)),
        },
      });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const startResize = (event: React.PointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startY = event.clientY;
    const base = getPreferences().acpFloatingBounds ?? bounds;
    const onMove = (move: PointerEvent) => {
      setPreferences({
        acpFloatingBounds: {
          ...base,
          width: Math.max(320, Math.min(780, base.width + move.clientX - startX)),
          height: Math.max(340, Math.min(820, base.height + move.clientY - startY)),
        },
      });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  return (
    <>
      <button
        type="button"
        className="acp-floating-fab"
        title="Toggle floating agent chat"
        aria-label="Toggle floating agent chat"
        onClick={() => setOpen(!open)}
      >
        {prefs.acpFloatingButtonImage.trim() ? (
          <img src={prefs.acpFloatingButtonImage.trim()} alt="" className="acp-floating-fab-img" />
        ) : (
          <Bot size={20} />
        )}
        {waiting && <span className="acp-badge-dot" />}
      </button>

      {open && (
        <section
          className="acp-floating-window"
          aria-label="Floating agent chat"
          style={{
            left: bounds.x,
            top: bounds.y,
            width: bounds.width,
            height: bounds.height,
          }}
        >
          <div className="acp-floating-drag" onPointerDown={startDrag}>
            <GripHorizontal size={14} />
            <span>Agent Client</span>
            <button
              type="button"
              className="icon-button small"
              aria-label="Close floating chat"
              onClick={() => setOpen(false)}
            >
              <X size={14} />
            </button>
          </div>
          <div className="acp-floating-body">
            <AgentClientView
              origin="floating"
              compact
              onOpenSessionManager={() => openDialog({ kind: 'sessionManager' })}
              onOpenSettings={() => openDialog({ kind: 'settings', section: 'assistant' })}
            />
          </div>
          <div
            className="acp-floating-resize"
            role="separator"
            aria-label="Resize floating chat"
            onPointerDown={startResize}
          />
        </section>
      )}
    </>
  );
}
