import { ImageIcon, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { COVER_GRADIENTS } from '../../core/model';
import type { PageMeta } from '../../core/model';
import { fileUrl, storeFiles } from '../platform/attachments';
import { pickFiles } from '../platform/files';
import { run } from '../workspace';
import { Popover } from './Popover';
import { t } from '../i18n';

export function setCover(page: PageMeta, cover: string | null): void {
  run({ type: 'page.setCover', id: page.id, cover, now: Date.now() });
}

// a gradient is a css class, an image cover is a file in the vault
export function useCover(cover: string | null): { className: string; image: string | null } {
  const [image, setImage] = useState<string | null>(null);
  const isGradient = cover?.startsWith('gradient-') ?? false;
  useEffect(() => {
    let live = true;
    if (cover && !isGradient) void fileUrl(cover).then((url) => live && setImage(url));
    return () => {
      live = false;
    };
  }, [cover, isGradient]);
  if (!cover) return { className: '', image: null };
  return isGradient ? { className: `cover-${cover}`, image: null } : { className: 'cover-image', image };
}

export function CoverBanner({ page, editable }: { page: PageMeta; editable: boolean }) {
  const { className, image } = useCover(page.cover);
  const [picker, setPicker] = useState<HTMLElement | null>(null);
  if (!page.cover) return null;
  return (
    <div
      className={`page-cover ${className}`}
      style={image ? { backgroundImage: `url("${image}")` } : undefined}
    >
      {editable && (
        <div className="page-cover-actions">
          <button type="button" className="button small" onClick={(event) => setPicker(event.currentTarget)}>
            {t('page.changeCover')}
          </button>
        </div>
      )}
      {picker && <CoverPicker page={page} anchor={picker} onClose={() => setPicker(null)} />}
    </div>
  );
}

export function CoverPicker({
  page,
  anchor,
  onClose,
}: {
  page: PageMeta;
  anchor: HTMLElement;
  onClose: () => void;
}) {
  const pick = (cover: string | null) => {
    setCover(page, cover);
    onClose();
  };
  return (
    <Popover anchor={anchor} onClose={onClose} label={t('page.cover')} className="cover-picker">
      <div className="cover-grid">
        {Array.from({ length: COVER_GRADIENTS }, (_, index) => `gradient-${index + 1}`).map((cover) => (
          <button
            key={cover}
            type="button"
            className={`cover-choice cover-${cover}${page.cover === cover ? ' is-active' : ''}`}
            aria-label={`Gradient ${cover.slice(9)}`}
            onClick={() => pick(cover)}
          />
        ))}
      </div>
      <div className="popover-actions">
        <button
          type="button"
          className="button small"
          onClick={() =>
            void pickFiles('image/*', false).then(async (files) => {
              const [stored] = await storeFiles(files);
              if (stored) pick(stored.id);
            })
          }
        >
          <ImageIcon size={13} /> {t('page.useAnImage')}
        </button>
        {page.cover && (
          <button type="button" className="button small danger" onClick={() => pick(null)}>
            <Trash2 size={13} /> {t('common.remove')}
          </button>
        )}
      </div>
    </Popover>
  );
}
