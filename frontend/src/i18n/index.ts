import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import enCommon from './locales/en/common.json';
import enPages from './locales/en/pages.json';
import ruCommon from './locales/ru/common.json';
import ruPages from './locales/ru/pages.json';

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { common: enCommon, pages: enPages },
      ru: { common: ruCommon, pages: ruPages },
    },
    ns: ['common', 'pages'],
    defaultNS: 'pages',
    supportedLngs: ['en', 'ru'],
    fallbackLng: 'en',
    nonExplicitSupportedLngs: true,
    detection: {
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: 'app_locale',
      caches: ['localStorage'],
    },
    interpolation: { escapeValue: false },
  });

export default i18n;
