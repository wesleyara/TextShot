// SPDX-License-Identifier: GPL-2.0-or-later
// Traduções da interface. As strings-fonte são em inglês; cada idioma mapeia
// a string em inglês para a tradução. Usado por extension.js, prefs.js e lib.js.
import GLib from 'gi://GLib';

import {TRANSLATIONS} from './translations.js';

/** [código salvo nas configurações, nome nativo] */
export const UI_LANGUAGES = [
    ['system', null],
    ['en', 'English'],
    ['pt_BR', 'Português (Brasil)'],
    ['es', 'Español'],
    ['de', 'Deutsch'],
    ['it', 'Italiano'],
    ['zh_CN', '中文（简体）'],
];

const PREFIX_MAP = {pt: 'pt_BR', zh: 'zh_CN', es: 'es', de: 'de', it: 'it', en: 'en'};

let current = 'en';

/** Idioma do sistema suportado pela extensão (ou 'en'). */
export function systemLanguage() {
    for (const name of GLib.get_language_names()) {
        const base = name.split('.')[0].split('@')[0];
        if (base === 'en' || TRANSLATIONS[base])
            return base;
        const mapped = PREFIX_MAP[base.split('_')[0]];
        if (mapped)
            return mapped;
    }
    return 'en';
}

export function setLanguage(code) {
    current = !code || code === 'system' ? systemLanguage() : code;
    if (current !== 'en' && !TRANSLATIONS[current])
        current = 'en';
}

export function currentLanguage() {
    return current;
}

/**
 * Traduz `text` e substitui `{nome}` pelos valores de `params`.
 *
 * @param {string} text string em inglês
 * @param {object} [params]
 * @returns {string}
 */
export function _(text, params = null) {
    let out = (current !== 'en' && TRANSLATIONS[current]?.[text]) || text;
    if (params)
        out = out.replace(/\{(\w+)\}/g, (m, k) => (k in params ? String(params[k]) : m));
    return out;
}
