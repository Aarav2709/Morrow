import { ImageIcon, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { COVER_GRADIENTS } from '../../core/model';
import type { FileMeta, PageMeta } from '../../core/model';
import { fileUrl, storeFiles } from '../platform/attachments';
import { pickFiles } from '../platform/files';
import { getSession, run } from '../workspace';
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

// the newest pictures, enough to find a recent one without loading every picture in a large vault
const MAX_PICTURES = 48;

function CoverPicture({ file, active, onPick }: { file: FileMeta; active: boolean; onPick: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void fileUrl(file.id).then((next) => live && setUrl(next));
    return () => {
      live = false;
    };
  }, [file.id]);
  return (
    <button
      type="button"
      className={`cover-choice cover-picture${active ? ' is-active' : ''}`}
      aria-label={file.name}
      title={file.name}
      onClick={onPick}
    >
      {url && <img src={url} alt="" loading="lazy" draggable={false} />}
    </button>
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
  // pictures already in the vault can be a cover too, rather than adding the same one again
  const [pictures, setPictures] = useState<FileMeta[]>([]);
  useEffect(() => {
    let live = true;
    void getSession()
      .listFiles()
      .catch(() => [])
      .then((files) => {
        if (!live) return;
        setPictures(
          files
            .filter((file) => file.type.startsWith('image/'))
            .sort((a, b) => b.createdAt - a.createdAt)
            .slice(0, MAX_PICTURES),
        );
      });
    return () => {
      live = false;
    };
  }, []);
  return (
    <Popover anchor={anchor} onClose={onClose} label={t('page.cover')} className="cover-picker">
      <div className="cover-grid">
        {Array.from({ length: COVER_GRADIENTS }, (_, index) => `gradient-${index + 1}`).map((cover) => (
          <button
            key={cover}
            type="button"
            className={`cover-choice cover-${cover}${page.cover === cover ? ' is-active' : ''}`}
            aria-label={t('page.gradient', { number: cover.slice(9) })}
            onClick={() => pick(cover)}
          />
        ))}
      </div>
      {pictures.length > 0 && (
        <>
          <p className="cover-picker-heading muted">{t('page.picturesInVault')}</p>
          <div className="cover-grid cover-pictures">
            {pictures.map((file) => (
              <CoverPicture
                key={file.id}
                file={file}
                active={page.cover === file.id}
                onPick={() => pick(file.id)}
              />
            ))}
          </div>
        </>
      )}
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
