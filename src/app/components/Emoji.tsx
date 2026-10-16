import { EMOJI_FILES } from 'virtual:morrow-emoji';

// the image for an emoji, trying the spellings the image set uses for variation selectors and keycaps
export function emojiSrc(emoji: string): string | null {
  const points = [...emoji].map((char) => char.codePointAt(0)!.toString(16));
  const plain = points.filter((point) => point !== 'fe0f');
  const candidates = [
    points.join('-'),
    plain.join('-'),
    [...plain, 'fe0f'].join('-'),
    points.map((point) => point.padStart(4, '0')).join('-'),
  ];
  for (const name of candidates) if (EMOJI_FILES.has(name)) return `./emoji/${name}.webp`;
  return null;
}

// page icons and other emoji in the interface, drawn the same on every system
export function Emoji({ emoji, className }: { emoji: string; className?: string }) {
  const src = emojiSrc(emoji);
  if (!src) return <span className={`emoji-text${className ? ` ${className}` : ''}`}>{emoji}</span>;
  return (
    <img
      className={`emoji-img${className ? ` ${className}` : ''}`}
      src={src}
      alt={emoji}
      draggable={false}
      loading="lazy"
      decoding="async"
    />
  );
}

// the same for code that builds dom by hand, such as editor node views
export function emojiElement(emoji: string): HTMLElement {
  const src = emojiSrc(emoji);
  if (!src) {
    const span = document.createElement('span');
    span.className = 'emoji-text';
    span.textContent = emoji;
    return span;
  }
  const img = document.createElement('img');
  img.className = 'emoji-img';
  img.src = src;
  img.alt = emoji;
  img.draggable = false;
  return img;
}
