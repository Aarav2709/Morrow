import type { Editor } from '@tiptap/core';
import { RotateCcw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { t } from '../i18n';
import { fileUrl, storeFiles } from '../platform/attachments';
import { getSession } from '../workspace';
import { toast } from '../ui';

// what part of the picture is kept, as fractions of its width and height so it is the same at any size
interface Area {
  x: number;
  y: number;
  w: number;
  h: number;
}

type Handle = 'move' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
const HANDLES: Handle[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];
const RATIOS = [
  { id: 'free', value: null },
  { id: 'square', value: 1 },
  { id: 'fourThree', value: 4 / 3 },
  { id: 'sixteenNine', value: 16 / 9 },
  { id: 'portrait', value: 3 / 4 },
] as const;
type RatioId = (typeof RATIOS)[number]['id'];
const SMALLEST = 0.04;

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

// an area of the given shape, as large as fits in the picture and centred, for a ratio picked
export function areaForRatio(ratio: number | null, natural: { width: number; height: number }): Area {
  if (!ratio) return { x: 0, y: 0, w: 1, h: 1 };
  const pictureRatio = natural.width / natural.height;
  if (ratio > pictureRatio) {
    const h = pictureRatio / ratio;
    return { x: 0, y: (1 - h) / 2, w: 1, h };
  }
  const w = ratio / pictureRatio;
  return { x: (1 - w) / 2, y: 0, w, h: 1 };
}

// moves one edge or corner, or the whole area, by a distance in fractions, kept inside the picture. with a
// ratio the other side follows so the shape holds
export function dragArea(
  start: Area,
  handle: Handle,
  dx: number,
  dy: number,
  ratio: number | null,
  pictureRatio: number,
): Area {
  if (handle === 'move')
    return { ...start, x: clamp(start.x + dx, 0, 1 - start.w), y: clamp(start.y + dy, 0, 1 - start.h) };
  let left = start.x;
  let top = start.y;
  let right = start.x + start.w;
  let bottom = start.y + start.h;
  if (handle.includes('w')) left = clamp(left + dx, 0, right - SMALLEST);
  if (handle.includes('e')) right = clamp(right + dx, left + SMALLEST, 1);
  if (handle.includes('n')) top = clamp(top + dy, 0, bottom - SMALLEST);
  if (handle.includes('s')) bottom = clamp(bottom + dy, top + SMALLEST, 1);
  if (ratio) {
    // in fractions, a shape of ratio r has h = w * pictureRatio / r
    const factor = pictureRatio / ratio;
    const width = right - left;
    let height = width * factor;
    const fromTop = handle.includes('n');
    if (fromTop) top = bottom - height;
    else bottom = top + height;
    if (top < 0 || bottom > 1) {
      height = fromTop ? bottom : 1 - top;
      const fitted = height / factor;
      if (handle.includes('w')) left = right - fitted;
      else right = left + fitted;
      if (fromTop) top = bottom - height;
      else bottom = top + height;
    }
  }
  return { x: left, y: top, w: right - left, h: bottom - top };
}

// a picture in the page cropped right here: the frame is dragged by its edges and corners or moved whole,
// and a shape can be picked. the cropped picture is saved as a copy, the original stays in the vault and
// undo brings it back
export function CropDialog({ editor, pos, onClose }: { editor: Editor; pos: number; onClose: () => void }) {
  const node = editor.state.doc.nodeAt(pos);
  const fileId = typeof node?.attrs.fileId === 'string' ? node.attrs.fileId : null;
  const [url, setUrl] = useState<string | null>(null);
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null);
  const [area, setArea] = useState<Area>({ x: 0, y: 0, w: 1, h: 1 });
  const [ratio, setRatio] = useState<RatioId>('free');
  const [saving, setSaving] = useState(false);
  const stage = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!fileId) return;
    void fileUrl(fileId).then(setUrl);
  }, [fileId]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const ratioValue = RATIOS.find((item) => item.id === ratio)?.value ?? null;
  const pictureRatio = natural ? natural.width / natural.height : 1;

  const startDrag = (handle: Handle) => (event: React.PointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const box = stage.current?.getBoundingClientRect();
    if (!box) return;
    const from = { x: event.clientX, y: event.clientY };
    const start = area;
    const onMove = (move: PointerEvent) =>
      setArea(
        dragArea(
          start,
          handle,
          (move.clientX - from.x) / box.width,
          (move.clientY - from.y) / box.height,
          ratioValue,
          pictureRatio,
        ),
      );
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const apply = async () => {
    if (!fileId || !natural || !url) return;
    setSaving(true);
    try {
      const stored = await getSession().getFile(fileId);
      if (!stored) throw new Error('missing');
      const bitmap = await createImageBitmap(new Blob([stored.data], { type: stored.meta.type }));
      const sx = Math.round(area.x * bitmap.width);
      const sy = Math.round(area.y * bitmap.height);
      const sw = Math.max(1, Math.round(area.w * bitmap.width));
      const sh = Math.max(1, Math.round(area.h * bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = sw;
      canvas.height = sh;
      canvas.getContext('2d')!.drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh);
      bitmap.close();
      // photos stay photos, anything else becomes a png so clear edges and see-through parts are kept
      const type = /jpe?g/i.test(stored.meta.type)
        ? 'image/jpeg'
        : stored.meta.type === 'image/webp'
          ? 'image/webp'
          : 'image/png';
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.92));
      if (!blob) throw new Error('encode');
      const base = stored.meta.name.replace(/\.[^.]+$/, '') || 'image';
      const ext = type === 'image/jpeg' ? 'jpg' : type.split('/')[1];
      const [meta] = await storeFiles([new File([blob], `${base}-cropped.${ext}`, { type })]);
      if (!meta || editor.isDestroyed) throw new Error('store');
      const live = editor.state.doc.nodeAt(pos);
      if (live?.type.name !== 'image' || live.attrs.fileId !== fileId) throw new Error('moved');
      // a picture given a width keeps showing at the same scale, so the part kept does not grow
      const width =
        typeof live.attrs.width === 'number' ? Math.max(60, Math.round(live.attrs.width * area.w)) : null;
      editor.view.dispatch(
        editor.state.tr.setNodeMarkup(pos, undefined, { ...live.attrs, fileId: meta.id, width }),
      );
      onClose();
    } catch {
      toast(t('editor.crop.failed'), { tone: 'error' });
      setSaving(false);
    }
  };

  const whole = area.x === 0 && area.y === 0 && area.w === 1 && area.h === 1;
  return (
    <div
      className="dialog-backdrop crop-backdrop"
      onPointerDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div className="dialog crop-dialog" role="dialog" aria-modal="true" aria-label={t('editor.crop.title')}>
        <div className="crop-stage-wrap">
          {url && (
            <div className="crop-stage" ref={stage}>
              <img
                src={url}
                alt=""
                draggable={false}
                onLoad={(event) =>
                  setNatural({
                    width: event.currentTarget.naturalWidth,
                    height: event.currentTarget.naturalHeight,
                  })
                }
              />
              {natural && (
                <div
                  className="crop-area"
                  style={{
                    left: `${area.x * 100}%`,
                    top: `${area.y * 100}%`,
                    width: `${area.w * 100}%`,
                    height: `${area.h * 100}%`,
                  }}
                  onPointerDown={startDrag('move')}
                >
                  {HANDLES.map((handle) => (
                    <span
                      key={handle}
                      className={`crop-handle is-${handle}`}
                      onPointerDown={startDrag(handle)}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
        <div className="crop-bar">
          <div className="segmented" role="radiogroup" aria-label={t('editor.crop.shape')}>
            {RATIOS.map((item) => (
              <button
                key={item.id}
                type="button"
                role="radio"
                aria-checked={ratio === item.id}
                className={ratio === item.id ? 'is-active' : ''}
                onClick={() => {
                  setRatio(item.id);
                  if (natural) setArea(areaForRatio(item.value, natural));
                }}
              >
                {t(`editor.crop.ratios.${item.id}`)}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label={t('editor.crop.reset')}
            title={t('editor.crop.reset')}
            disabled={whole}
            onClick={() => {
              setRatio('free');
              setArea({ x: 0, y: 0, w: 1, h: 1 });
            }}
          >
            <RotateCcw size={15} />
          </button>
          <span className="crop-spacer" />
          <button type="button" className="button" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="button primary"
            disabled={whole || saving || !natural}
            onClick={() => void apply()}
          >
            {t('editor.crop.apply')}
          </button>
        </div>
      </div>
    </div>
  );
}
