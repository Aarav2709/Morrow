import type { LucideIcon } from 'lucide-react';
import { COLORS } from '../../core/model';
import type { ColorName } from '../../core/model';
import { autoTagColor } from '../../core/tags';
import { t } from '../i18n';
import { colorLabel } from '../i18n/labels';
import { setTagColor, useTagColors } from '../tagColors';
import { Menu } from './Menu';

// a square of a colour, shown beside its name in a menu
const swatches = new Map<ColorName, LucideIcon>();
export function colourSwatch(color: ColorName): LucideIcon {
  let icon = swatches.get(color);
  if (!icon) {
    const Swatch = () => <span className={`menu-swatch swatch-${color}`} />;
    icon = Swatch as unknown as LucideIcon;
    swatches.set(color, icon);
  }
  return icon;
}

// the colour of a #tag or a select option, picked from the nine every tag can have
export function TagColorMenu({
  name,
  anchor,
  onClose,
}: {
  name: string;
  anchor: HTMLElement | DOMRect;
  onClose: () => void;
}) {
  const picked = useTagColors()[name.toLowerCase()] ?? null;
  return (
    <Menu
      anchor={anchor}
      label={t('tags.colour', { tag: name })}
      onClose={onClose}
      entries={[
        { heading: t('editor.colour') },
        {
          label: t('tags.automaticColour'),
          icon: colourSwatch(autoTagColor(name)),
          checked: picked === null,
          onSelect: () => void setTagColor(name, null),
        },
        ...COLORS.map((color) => ({
          label: colorLabel(color),
          icon: colourSwatch(color),
          checked: picked === color,
          onSelect: () => void setTagColor(name, color),
        })),
      ]}
    />
  );
}
