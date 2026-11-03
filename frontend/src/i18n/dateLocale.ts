import { enUS, ru } from 'date-fns/locale';
import i18n from './index';

export function getDateFnsLocale() {
  return i18n.language?.startsWith('ru') ? ru : enUS;
}
