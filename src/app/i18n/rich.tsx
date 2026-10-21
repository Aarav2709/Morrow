import { Fragment } from 'react';
import type { ReactNode } from 'react';
import { t } from './index';
import type { TranslationKey } from './types';

// a translated sentence with elements in it, such as a link or a bit of code, so the whole sentence is
// translated at once: tr('searchView.tips', { tag: <code>#tag</code> })
export function tr(key: TranslationKey, values: Record<string, ReactNode>): ReactNode {
  return t(key)
    .split(/\{(\w+)\}/)
    .map((part, index) =>
      index % 2 === 0 ? (
        part
      ) : (
        <Fragment key={index}>{Object.hasOwn(values, part) ? values[part] : `{${part}}`}</Fragment>
      ),
    );
}
