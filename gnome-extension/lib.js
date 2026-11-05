// SPDX-License-Identifier: GPL-2.0-or-later
// Utilidades compartilhadas entre extension.js e prefs.js (somente imports gi://).
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {_} from './i18n.js';

// Nomes nativos dos idiomas do tesseract (equ e osd são traduzidos em langLabel)
export const LANG_NAMES = {
    afr: 'Afrikaans',
    amh: 'አማርኛ',
    ara: 'العربية',
    asm: 'অসমীয়া',
    aze: 'Azərbaycan',
    aze_cyrl: 'Азәрбајҹан (кирил)',
    bel: 'Беларуская',
    ben: 'বাংলা',
    bod: 'བོད་ཡིག',
    bos: 'Bosanski',
    bre: 'Brezhoneg',
    bul: 'Български',
    cat: 'Català',
    ceb: 'Cebuano',
    ces: 'Čeština',
    chi_sim: '中文 (简体)',
    chi_sim_vert: '中文 (简体, 竖排)',
    chi_tra: '中文 (繁體)',
    chi_tra_vert: '中文 (繁體, 直排)',
    chr: 'ᏣᎳᎩ',
    cos: 'Corsu',
    cym: 'Cymraeg',
    dan: 'Dansk',
    deu: 'Deutsch',
    deu_latf: 'Deutsch (Fraktur)',
    div: 'ދިވެހި',
    dzo: 'རྫོང་ཁ',
    ell: 'Ελληνικά',
    eng: 'English',
    enm: 'Middle English',
    epo: 'Esperanto',
    est: 'Eesti',
    eus: 'Euskara',
    fao: 'Føroyskt',
    fas: 'فارسی',
    fil: 'Filipino',
    fin: 'Suomi',
    fra: 'Français',
    frk: 'Fraktur',
    frm: 'Moyen français',
    fry: 'Frysk',
    gla: 'Gàidhlig',
    gle: 'Gaeilge',
    glg: 'Galego',
    grc: 'Ἀρχαία ἑλληνική',
    guj: 'ગુજરાતી',
    hat: 'Kreyòl ayisyen',
    heb: 'עברית',
    hin: 'हिन्दी',
    hrv: 'Hrvatski',
    hun: 'Magyar',
    hye: 'Հայերեն',
    iku: 'ᐃᓄᒃᑎᑐᑦ',
    ind: 'Bahasa Indonesia',
    isl: 'Íslenska',
    ita: 'Italiano',
    ita_old: 'Italiano antico',
    jav: 'Basa Jawa',
    jpn: '日本語',
    jpn_vert: '日本語 (縦書き)',
    kan: 'ಕನ್ನಡ',
    kat: 'ქართული',
    kat_old: 'ძველი ქართული',
    kaz: 'Қазақ',
    khm: 'ខ្មែរ',
    kir: 'Кыргызча',
    kmr: 'Kurdî (Kurmancî)',
    kor: '한국어',
    kor_vert: '한국어 (세로쓰기)',
    lao: 'ລາວ',
    lat: 'Latina',
    lav: 'Latviešu',
    lit: 'Lietuvių',
    ltz: 'Lëtzebuergesch',
    mal: 'മലയാളം',
    mar: 'मराठी',
    mkd: 'Македонски',
    mlt: 'Malti',
    mon: 'Монгол',
    mri: 'Māori',
    msa: 'Bahasa Melayu',
    mya: 'မြန်မာ',
    nep: 'नेपाली',
    nld: 'Nederlands',
    nor: 'Norsk',
    oci: 'Occitan',
    ori: 'ଓଡ଼ିଆ',
    pan: 'ਪੰਜਾਬੀ',
    pol: 'Polski',
    por: 'Português',
    pus: 'پښتو',
    que: 'Runa Simi',
    ron: 'Română',
    rus: 'Русский',
    san: 'संस्कृतम्',
    sin: 'සිංහල',
    slk: 'Slovenčina',
    slv: 'Slovenščina',
    snd: 'سنڌي',
    spa: 'Español',
    spa_old: 'Español antiguo',
    sqi: 'Shqip',
    srp: 'Српски',
    srp_latn: 'Srpski (latinica)',
    sun: 'Basa Sunda',
    swa: 'Kiswahili',
    swe: 'Svenska',
    syr: 'ܣܘܪܝܝܐ',
    tam: 'தமிழ்',
    tat: 'Татар',
    tel: 'తెలుగు',
    tgk: 'Тоҷикӣ',
    tha: 'ไทย',
    tir: 'ትግርኛ',
    ton: 'Lea faka-Tonga',
    tur: 'Türkçe',
    uig: 'ئۇيغۇرچە',
    ukr: 'Українська',
    urd: 'اردو',
    uzb: 'Oʻzbek',
    uzb_cyrl: 'Ўзбек (кирилл)',
    vie: 'Tiếng Việt',
    yid: 'ייִדיש',
    yor: 'Yorùbá',
};

const TRANSLATED_NAMES = {
    equ: () => _('Math / equations'),
    osd: () => _('Orientation and script detection'),
};

export function langLabel(code) {
    const name = TRANSLATED_NAMES[code]?.() ?? LANG_NAMES[code];
    return name ? `${name} (${code})` : code;
}

export function parseLangs(str) {
    return (str || '').split('+').map(s => s.trim()).filter(Boolean);
}

export function resolveTesseract(path) {
    const p = (path || 'tesseract').trim();
    if (GLib.path_is_absolute(p))
        return GLib.file_test(p, GLib.FileTest.IS_EXECUTABLE) ? p : null;
    return GLib.find_program_in_path(p);
}

/**
 * Executa um comando e retorna [status, stdout, stderr].
 *
 * @param {string[]} argv
 * @param {object} [env] variáveis de ambiente extras
 * @returns {Promise<[number, string, string]>}
 */
export function run(argv, env = {}, cancellable = null) {
    const launcher = new Gio.SubprocessLauncher({
        flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
    });
    for (const [k, v] of Object.entries(env))
        launcher.setenv(k, v, true);
    const proc = launcher.spawnv(argv);
    return new Promise((resolve, reject) => {
        const cancelId = cancellable?.connect(() => proc.force_exit()) ?? 0;
        proc.communicate_utf8_async(null, cancellable, (p, res) => {
            if (cancelId)
                cancellable.disconnect(cancelId);
            try {
                const [, out, err] = p.communicate_utf8_finish(res);
                resolve([p.get_exit_status(), out ?? '', err ?? '']);
            } catch (e) {
                reject(e);
            }
        });
    });
}

/** Lista os idiomas instalados no tesseract (sem 'osd'). */
export async function listLanguages(tesseractPath) {
    const bin = resolveTesseract(tesseractPath);
    if (!bin)
        return [];
    const [status, out] = await run([bin, '--list-langs']);
    if (status !== 0)
        return [];
    return out.split('\n')
        .slice(1)
        .map(s => s.trim())
        .filter(s => s && s !== 'osd');
}

// ---------------------------------------------------------------------------
// Instalação de dependências via PackageKit (pede a senha pelo polkit).
// Nomes de pacote do Debian/Ubuntu.
// ---------------------------------------------------------------------------

/**
 * Nomes de pacotes por família de distro. `langCode` converte o código do
 * tesseract (ex.: chi_sim) no sufixo do pacote.
 */
const DISTROS = {
    debian: {
        engine: 'tesseract-ocr',
        langPrefix: 'tesseract-ocr-',
        langCode: c => c.replace(/_/g, '-'),
        fromCode: c => c.replace(/-/g, '_'),
        install: 'sudo apt install',
        sizeQuery: ['tesseract-ocr', 'libtesseract*', 'liblept*'],
    },
    fedora: {
        engine: 'tesseract',
        langPrefix: 'tesseract-langpack-',
        langCode: c => c,
        fromCode: c => c,
        install: 'sudo dnf install',
        sizeQuery: ['tesseract', 'tesseract-libs', 'leptonica'],
    },
    arch: {
        engine: 'tesseract',
        langPrefix: 'tesseract-data-',
        langCode: c => c,
        fromCode: c => c,
        install: 'sudo pacman -S',
        sizeQuery: ['tesseract', 'leptonica'],
    },
};

function detectDistro() {
    let ids = [];
    try {
        const [, bytes] = GLib.file_get_contents('/etc/os-release');
        const text = new TextDecoder().decode(bytes);
        const get = key => text.match(new RegExp(`^${key}="?([^"\\n]*)"?`, 'm'))?.[1] ?? '';
        ids = `${get('ID')} ${get('ID_LIKE')}`.toLowerCase().split(/\s+/);
    } catch {}
    if (ids.some(i => ['fedora', 'rhel', 'centos'].includes(i)))
        return 'fedora';
    if (ids.some(i => ['arch', 'manjaro', 'endeavouros'].includes(i)))
        return 'arch';
    return 'debian';
}

let _distro = null;

/** Perfil de pacotes da distro atual (detectado na primeira chamada). */
function distro() {
    _distro ??= DISTROS[detectDistro()];
    return _distro;
}

export function enginePackage() {
    return distro().engine;
}

export function langPackage(code) {
    return distro().langPrefix + distro().langCode(code);
}

/** Motor + português + inglês. */
export function basePackages() {
    return [enginePackage(), langPackage('por'), langPackage('eng')];
}

/** Comando para o usuário instalar manualmente. */
export function installCommand(packages) {
    return `${distro().install} ${packages.join(' ')}`;
}

/** Todos os pacotes do tesseract (motor + idiomas) para remoção completa. */
export function allTesseractPackages(installedLangs) {
    return [enginePackage(), ...installedLangs.map(langPackage), langPackage('osd')];
}

// PkFilterEnum / PkExitEnum / PkTransactionFlagEnum
const FILTER_INSTALLED = 1 << 2;
const FILTER_NOT_INSTALLED = 1 << 3;
const FILTER_NEWEST = 1 << 16;
const FILTER_ARCH = 1 << 18;
const EXIT_SUCCESS = 1;
const TX_NONE = 0;
const TX_ONLY_TRUSTED = 1 << 1;

/** Idiomas que o pacote do tesseract exige (não podem ser removidos sozinhos). */
export const REQUIRED_LANGS = ['eng', 'osd'];

/** Traduz erros comuns do apt/PackageKit em algo acionável. */
export function friendlyError(e) {
    const msg = (e?.message ?? String(e)).replace(/^GDBus\.Error:[^ ]+ /, '').trim();
    if (/dpkg was interrupted/i.test(msg))
        return _('An earlier installation was interrupted. Run in a terminal: {command}', {command: 'sudo dpkg --configure -a'});
    if (/lock|another (package manager|process)/i.test(msg))
        return _('Another program is using the package manager. Wait and try again.');
    if (/authentication|not authorized/i.test(msg))
        return _('Authentication was cancelled or denied.');
    return msg;
}

export function langFromPackage(name) {
    const prefix = distro().langPrefix;
    if (!name.startsWith(prefix))
        return null;
    const code = name.slice(prefix.length);
    if (!code || code === 'all' || code.startsWith('script-') || code === 'osd')
        return null;
    return distro().fromCode(code);
}

function dbusCall(path, iface, method, params, replyType = null) {
    return new Promise((resolve, reject) => {
        Gio.DBus.system.call('org.freedesktop.PackageKit', path, iface, method, params,
            replyType ? new GLib.VariantType(replyType) : null,
            Gio.DBusCallFlags.ALLOW_INTERACTIVE_AUTHORIZATION, -1, null, (conn, res) => {
                try {
                    resolve(conn.call_finish(res));
                } catch (e) {
                    reject(e);
                }
            });
    });
}

/**
 * Cria uma transação PackageKit, executa `method` e coleta os pacotes até o fim.
 *
 * @returns {Promise<Array<{id: string, name: string, summary: string}>>}
 */
async function transaction(method, params) {
    const [tid] = (await dbusCall('/org/freedesktop/PackageKit', 'org.freedesktop.PackageKit',
        'CreateTransaction', null, '(o)')).deepUnpack();
    const iface = 'org.freedesktop.PackageKit.Transaction';
    const conn = Gio.DBus.system;
    const packages = [];
    let error = null;

    const done = new Promise((resolve, reject) => {
        const ids = [];
        const sub = (signal, cb) => ids.push(conn.signal_subscribe('org.freedesktop.PackageKit',
            iface, signal, tid, null, Gio.DBusSignalFlags.NONE,
            (_c, _s, _p, _i, _n, args) => cb(args.deepUnpack())));
        const cleanup = () => ids.forEach(id => conn.signal_unsubscribe(id));

        sub('Package', ([, id, summary]) => packages.push({id, name: id.split(';')[0], summary}));
        sub('ErrorCode', ([, details]) => {
            error = details;
        });
        sub('Finished', ([exit]) => {
            cleanup();
            if (exit === EXIT_SUCCESS)
                resolve(packages);
            else
                reject(new Error(error || _('operation cancelled')));
        });
        // 'interactive=true' faz o PackageKit pedir a senha pelo polkit em vez de falhar
        const locale = GLib.get_language_names()[0] || 'C';
        dbusCall(tid, iface, 'SetHints',
            new GLib.Variant('(as)', [['interactive=true', `locale=${locale}`]]))
            .then(() => dbusCall(tid, iface, method, params))
            .catch(e => {
                cleanup();
                reject(e);
            });
    });
    return done;
}

function busCall(method, params) {
    return new Promise((resolve, reject) => {
        Gio.DBus.system.call('org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus',
            method, params, null, Gio.DBusCallFlags.NONE, 2000, null, (conn, res) => {
                try {
                    resolve(conn.call_finish(res).deepUnpack()[0]);
                } catch (e) {
                    reject(e);
                }
            });
    });
}

/** Versão assíncrona de hasPackageKit(), para uso dentro do GNOME Shell. */
export async function hasPackageKitAsync() {
    try {
        if (await busCall('NameHasOwner', new GLib.Variant('(s)', ['org.freedesktop.PackageKit'])))
            return true;
        return (await busCall('ListActivatableNames', null)).includes('org.freedesktop.PackageKit');
    } catch {
        return false;
    }
}

export function hasPackageKit() {
    try {
        const [has] = Gio.DBus.system.call_sync('org.freedesktop.DBus', '/org/freedesktop/DBus',
            'org.freedesktop.DBus', 'NameHasOwner', new GLib.Variant('(s)', ['org.freedesktop.PackageKit']),
            null, Gio.DBusCallFlags.NONE, 2000, null).deepUnpack();
        if (has)
            return true;
        const [names] = Gio.DBus.system.call_sync('org.freedesktop.DBus', '/org/freedesktop/DBus',
            'org.freedesktop.DBus', 'ListActivatableNames', null,
            null, Gio.DBusCallFlags.NONE, 2000, null).deepUnpack();
        return names.includes('org.freedesktop.PackageKit');
    } catch {
        return false;
    }
}

/** Instala pacotes (só os que ainda não estão instalados). Abre o diálogo de senha do sistema. */
export async function installPackages(names) {
    const filter = FILTER_NOT_INSTALLED | FILTER_NEWEST | FILTER_ARCH;
    const found = await transaction('Resolve', new GLib.Variant('(tas)', [filter, names]));
    const byName = new Map();
    for (const p of found) {
        if (!byName.has(p.name))
            byName.set(p.name, p.id);
    }
    if (byName.size === 0)
        return [];
    await transaction('InstallPackages',
        new GLib.Variant('(tas)', [TX_ONLY_TRUSTED, [...byName.values()]]));
    return [...byName.keys()];
}

/** Remove pacotes instalados. `withDependents` remove também o que depende deles. */
export async function removePackages(names, withDependents = false) {
    const found = await transaction('Resolve',
        new GLib.Variant('(tas)', [FILTER_INSTALLED | FILTER_ARCH, names]));
    const ids = [...new Map(found.map(p => [p.name, p.id])).values()];
    if (ids.length === 0)
        return [];
    await transaction('RemovePackages',
        new GLib.Variant('(tasbb)', [TX_NONE, ids, withDependents, true]));
    return ids.map(id => id.split(';')[0]);
}

/** Idiomas do tesseract disponíveis no repositório e ainda não instalados. */
export async function listInstallableLanguages() {
    const filter = FILTER_NOT_INSTALLED | FILTER_NEWEST | FILTER_ARCH;
    const found = await transaction('SearchNames', new GLib.Variant('(tas)', [filter, [distro().langPrefix]]));
    const langs = new Map();
    for (const p of found) {
        const code = langFromPackage(p.name);
        if (code && !langs.has(code))
            langs.set(code, p.summary);
    }
    return [...langs.keys()].sort((a, b) => langLabel(a).localeCompare(langLabel(b)));
}

// ---------------------------------------------------------------------------
// Armazenamento
// ---------------------------------------------------------------------------

export function formatSize(bytes) {
    return GLib.format_size(Math.max(0, Math.round(bytes)));
}

/** Tamanho de um arquivo ou diretório (recursivo), em bytes. */
export function pathSize(path) {
    const file = Gio.File.new_for_path(path);
    let info;
    try {
        info = file.query_info('standard::type,standard::size', Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
    } catch {
        return 0;
    }
    if (info.get_file_type() !== Gio.FileType.DIRECTORY)
        return info.get_size();
    let total = 0;
    const children = file.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
    for (let child; (child = children.next_file(null));)
        total += pathSize(GLib.build_filenamev([path, child.get_name()]));
    children.close(null);
    return total;
}

/** Diretório tessdata informado pelo tesseract. */
export async function tessdataDir(tesseractPath) {
    const bin = resolveTesseract(tesseractPath);
    if (!bin)
        return null;
    const [, out] = await run([bin, '--list-langs']);
    return out.match(/"([^"]+)"/)?.[1] ?? null;
}

const UNITS = {B: 1, KiB: 1024, MiB: 1024 ** 2, GiB: 1024 ** 3};

/**
 * Tamanho instalado dos pacotes do motor de OCR, em bytes (dpkg, rpm ou pacman).
 *
 * @returns {Promise<Map<string, number>>}
 */
export async function engineSizes() {
    const sizes = new Map();
    const query = distro().sizeQuery;
    try {
        if (GLib.find_program_in_path('dpkg-query')) {
            const [, out] = await run(['dpkg-query', '-W', '-f', '${Package}\t${Installed-Size}\t${db:Status-Status}\n', ...query]);
            for (const line of out.split('\n')) {
                const [name, kib, status] = line.split('\t');
                if (name && status === 'installed')
                    sizes.set(name, Number(kib) * 1024);
            }
        } else if (GLib.find_program_in_path('rpm')) {
            const [, out] = await run(['rpm', '-q', '--qf', '%{NAME}\t%{SIZE}\n', ...query]);
            for (const line of out.split('\n')) {
                const [name, bytes] = line.split('\t');
                if (name && /^\d+$/.test(bytes ?? ''))
                    sizes.set(name, Number(bytes));
            }
        } else if (GLib.find_program_in_path('pacman')) {
            const [, out] = await run(['pacman', '-Qi', ...query], {LC_ALL: 'C'});
            for (const block of out.split(/\n\s*\n/)) {
                const name = block.match(/^Name\s*:\s*(\S+)/m)?.[1];
                const size = block.match(/^Installed Size\s*:\s*([\d.]+)\s*(\w+)/m);
                if (name && size)
                    sizes.set(name, Number(size[1]) * (UNITS[size[2]] ?? 1));
            }
        }
    } catch (e) {
        logError(e);
    }
    return sizes;
}
