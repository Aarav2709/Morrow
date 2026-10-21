// names the core layer keeps in english, translated where they are shown
import { VIEW_LABELS } from '../../core/database';
import type { ColorName, FilterOp, PropType, ViewDef, ViewType } from '../../core/model';
import { t } from './index';
import type { TranslationKey } from './types';

const PROP: Record<PropType, TranslationKey> = {
  text: 'database.typeText',
  number: 'database.typeNumber',
  select: 'database.typeSelect',
  multiSelect: 'database.typeMultiSelect',
  date: 'database.typeDate',
  checkbox: 'database.typeCheckbox',
  url: 'database.typeUrl',
  relation: 'database.typeRelation',
  formula: 'database.typeFormula',
};

const VIEW: Record<ViewType, TranslationKey> = {
  table: 'database.viewTable',
  board: 'database.viewBoard',
  calendar: 'database.viewCalendar',
  list: 'database.viewList',
  gallery: 'database.viewGallery',
};

const FILTER: Record<FilterOp, TranslationKey> = {
  contains: 'database.filterContains',
  notContains: 'database.filterNotContains',
  is: 'database.filterIs',
  isNot: 'database.filterIsNot',
  empty: 'database.filterEmpty',
  notEmpty: 'database.filterNotEmpty',
  gt: 'database.filterGt',
  lt: 'database.filterLt',
  checked: 'database.filterChecked',
  unchecked: 'database.filterUnchecked',
};

const COLOR: Record<ColorName, TranslationKey> = {
  gray: 'colors.gray',
  brown: 'colors.brown',
  orange: 'colors.orange',
  yellow: 'colors.yellow',
  green: 'colors.green',
  blue: 'colors.blue',
  purple: 'colors.purple',
  pink: 'colors.pink',
  red: 'colors.red',
};

export const propLabel = (type: PropType): string => t(PROP[type]);
export const viewLabel = (type: ViewType): string => t(VIEW[type]);
export const filterLabel = (op: FilterOp): string => t(FILTER[op]);
export const colorLabel = (color: ColorName): string => t(COLOR[color]);

// a view still called by its english default shows that name translated, a name someone typed stays as typed
export function viewName(view: Pick<ViewDef, 'name' | 'type'>): string {
  return !view.name || view.name === VIEW_LABELS[view.type] ? viewLabel(view.type) : view.name;
}
