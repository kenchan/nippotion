import i18next from 'i18next';
import { ja } from './locales/ja.js';
import { en } from './locales/en.js';

// Some strings are needed before the config file is loaded (CLI help, config validation
// errors), so initialize synchronously at module load using NIPPOTION_LANG (en if unset).
// When the config specifies a language, main() switches via changeLanguage after loading
void i18next.init({
  lng: process.env.NIPPOTION_LANG ?? 'en',
  fallbackLng: 'en',
  initAsync: false,
  resources: {
    ja: { translation: ja },
    en: { translation: en },
  },
  interpolation: {
    // Not embedded in HTML, so HTML-escaping of & and quotes is unnecessary
    escapeValue: false,
  },
});

export const t = i18next.t.bind(i18next);
export default i18next;
