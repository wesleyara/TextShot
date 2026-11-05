// SPDX-License-Identifier: GPL-2.0-or-later
import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {
    REQUIRED_LANGS, basePackages, allTesseractPackages, engineSizes, formatSize, friendlyError,
    hasPackageKit, installCommand, installPackages,
    langLabel, langPackage, listInstallableLanguages, listLanguages, parseLangs,
    pathSize, removePackages, resolveTesseract, run, tessdataDir,
} from './lib.js';
import {UI_LANGUAGES, _, setLanguage, systemLanguage} from './i18n.js';

const PSM_OPTIONS = [
    [3, () => _('Automatic')],
    [4, () => _('Text columns')],
    [6, () => _('Text block (recommended)')],
    [7, () => _('Single line')],
    [11, () => _('Sparse text')],
];

const NO_MOD_KEYS = new Set([
    Gdk.KEY_Print,
    ...Array.from({length: 12}, (_, i) => Gdk.KEY_F1 + i),
]);

/** Linha que mostra e captura um atalho de teclado salvo numa chave 'as'. */
const ShortcutRow = GObject.registerClass(
class TextShotShortcutRow extends Adw.ActionRow {
    _init(settings, key, params) {
        super._init(params);
        this._settings = settings;
        this._key = key;

        this._label = new Gtk.ShortcutLabel({
            disabled_text: _('Disabled'),
            valign: Gtk.Align.CENTER,
        });
        this.add_suffix(this._label);

        const reset = new Gtk.Button({
            icon_name: 'edit-undo-symbolic',
            tooltip_text: _('Restore default'),
            valign: Gtk.Align.CENTER,
            css_classes: ['flat'],
        });
        reset.connect('clicked', () => settings.reset(key));
        this.add_suffix(reset);

        this.activatable = true;
        this.connect('activated', () => this._capture());

        settings.connect(`changed::${key}`, () => this._sync());
        this._sync();
    }

    _sync() {
        const [accel] = this._settings.get_strv(this._key);
        this._label.accelerator = accel ?? '';
    }

    _capture() {
        const dialog = new Adw.AlertDialog({
            heading: _('New shortcut'),
            body: _('Press the key combination you want.\nEsc cancels • Backspace disables'),
        });
        dialog.add_response('cancel', _('Cancel'));

        const controller = new Gtk.EventControllerKey({
            propagation_phase: Gtk.PropagationPhase.CAPTURE,
        });
        controller.connect('key-pressed', (_c, keyval, keycode, state) => {
            const mods = state & Gtk.accelerator_get_default_mod_mask();
            const key = Gdk.keyval_to_lower(keyval);

            if (mods === 0 && key === Gdk.KEY_Escape) {
                dialog.close();
                return Gdk.EVENT_STOP;
            }
            if (mods === 0 && key === Gdk.KEY_BackSpace) {
                this._settings.set_strv(this._key, []);
                dialog.close();
                return Gdk.EVENT_STOP;
            }
            if (mods === 0 && !NO_MOD_KEYS.has(key))
                return Gdk.EVENT_STOP;
            if (!Gtk.accelerator_valid(key, mods))
                return Gdk.EVENT_STOP;

            const accel = Gtk.accelerator_name_with_keycode(null, key, keycode, mods);
            this._settings.set_strv(this._key, [accel]);
            dialog.close();
            return Gdk.EVENT_STOP;
        });
        dialog.add_controller(controller);
        dialog.present(this.get_root());
    }
});

function iconButton(icon, tooltip, onClick, classes = ['flat']) {
    const button = new Gtk.Button({
        icon_name: icon,
        tooltip_text: tooltip,
        valign: Gtk.Align.CENTER,
        css_classes: classes,
    });
    button.connect('clicked', onClick);
    return button;
}

/**
 * Gerencia a página OCR: motor, idiomas ativos (ordenados) e instalação/remoção de pacotes.
 */
class OcrPage {
    constructor(settings, window) {
        this._settings = settings;
        this._window = window;
        this._packageKit = hasPackageKit();
        this._installed = [];
        this._busy = new Set();
        this._dialogRefreshers = new Set();

        this.page = new Adw.PreferencesPage({
            name: 'ocr',
            title: _('OCR'),
            icon_name: 'font-x-generic-symbolic',
        });

        this._engineGroup = new Adw.PreferencesGroup({title: _('OCR engine')});
        this.page.add(this._engineGroup);
        this._buildEngine();

        this._activeGroup = new Adw.PreferencesGroup({
            title: _('Active languages'),
            description: _('The order sets the priority. The extension builds the tesseract combination automatically.'),
        });
        const manage = new Gtk.Button({
            valign: Gtk.Align.CENTER,
            css_classes: ['flat'],
            child: new Adw.ButtonContent({icon_name: 'list-add-symbolic', label: _('Download languages')}),
            tooltip_text: _('Install or uninstall languages'),
        });
        manage.connect('clicked', () => this._openManager());
        this._activeGroup.set_header_suffix(manage);
        this.page.add(this._activeGroup);

        this._otherGroup = new Adw.PreferencesGroup({
            title: _('Other installed languages'),
            description: _('Enable them to include them in recognition.'),
        });
        this.page.add(this._otherGroup);

        this.page.add(this._buildRecognition());

        this._rows = {active: [], other: []};
        settings.connect('changed::languages', () => this._renderLanguages());
        settings.connect('changed::tesseract-path', () => this.refresh());
        this.refresh();
    }

    // ---------------------------------------------------------------- estado

    get _active() {
        return parseLangs(this._settings.get_string('languages'));
    }

    _setActive(langs) {
        const unique = [...new Set(langs)];
        this._settings.set_string('languages', (unique.length ? unique : ['eng']).join('+'));
    }

    async refresh() {
        try {
            const path = this._settings.get_string('tesseract-path');
            this._bin = resolveTesseract(path);
            this._installed = await listLanguages(path);
            this._version = '';
            if (this._bin) {
                const [, out, err] = await run([this._bin, '--version']);
                this._version = (out || err).split('\n')[0].replace(/^tesseract\s*/i, '').trim();
            }
        } catch (e) {
            logError(e);
        }
        this._renderEngine();
        this._renderLanguages();
        for (const fn of this._dialogRefreshers)
            fn();
        this._window._storage?.refresh();
    }

    _toast(title) {
        this._window.add_toast(new Adw.Toast({title, timeout: 4}));
    }

    _error(heading, e) {
        logError(e);
        const dialog = new Adw.AlertDialog({heading, body: friendlyError(e)});
        dialog.body_use_markup = false;
        dialog.add_response('ok', _('OK'));
        dialog.present(this._window);
    }

    /** Executa uma operação de pacotes mostrando estado no botão. */
    async _runPackageOp(button, busyLabel, key, op) {
        if (this._busy.has(key))
            return false;
        this._busy.add(key);
        const oldLabel = button.label;
        button.sensitive = false;
        button.label = busyLabel;
        try {
            await op();
            return true;
        } catch (e) {
            this._error(_("Couldn't complete the operation"), e);
            return false;
        } finally {
            this._busy.delete(key);
            button.label = oldLabel;
            button.sensitive = true;
            await this.refresh();
        }
    }

    // ---------------------------------------------------------------- motor

    _buildEngine() {
        this._engineRow = new Adw.ActionRow({title: 'Tesseract'});
        this._engineButton = new Gtk.Button({valign: Gtk.Align.CENTER});
        this._engineButton.connect('clicked', () => this._onEngineButton());
        this._engineRow.add_suffix(this._engineButton);
        this._engineGroup.add(this._engineRow);

        const pathRow = new Adw.EntryRow({
            title: _('tesseract executable'),
            show_apply_button: true,
            text: this._settings.get_string('tesseract-path'),
        });
        pathRow.connect('apply', () => {
            this._settings.set_string('tesseract-path', pathRow.text.trim() || 'tesseract');
        });
        this._engineGroup.add(pathRow);
    }

    _renderEngine() {
        const button = this._engineButton;
        if (this._busy.has('engine'))
            return;
        if (this._bin) {
            this._engineRow.subtitle = this._version
                ? _('Installed • version {version}', {version: this._version})
                : _('Installed');
            button.label = _('Uninstall');
            button.css_classes = ['destructive-action'];
            button.visible = this._packageKit;
        } else {
            this._engineRow.subtitle = this._packageKit
                ? _('Not installed — required for OCR')
                : _('Not installed. Run: {command}', {command: installCommand(basePackages())});
            button.label = _('Install');
            button.css_classes = ['suggested-action'];
            button.visible = this._packageKit;
        }
    }

    _onEngineButton() {
        const button = this._engineButton;
        if (!this._bin) {
            this._runPackageOp(button, _('Installing…'), 'engine', async () => {
                await installPackages(basePackages());
                this._toast(_('Tesseract installed'));
            });
            return;
        }

        const confirm = new Adw.AlertDialog({
            heading: _('Uninstall tesseract?'),
            body: _('The OCR engine and all installed languages will be removed. The extension will stop working until you reinstall it.'),
        });
        confirm.add_response('cancel', _('Cancel'));
        confirm.add_response('remove', _('Uninstall'));
        confirm.set_response_appearance('remove', Adw.ResponseAppearance.DESTRUCTIVE);
        confirm.connect('response', (_d, response) => {
            if (response !== 'remove')
                return;
            const packages = allTesseractPackages(this._installed);
            this._runPackageOp(button, _('Removing…'), 'engine', async () => {
                await removePackages(packages, true);
                this._toast(_('Tesseract uninstalled'));
            });
        });
        confirm.present(this._window);
    }

    // ---------------------------------------------------------------- idiomas

    _clear(group, key) {
        for (const row of this._rows[key])
            group.remove(row);
        this._rows[key] = [];
    }

    _renderLanguages() {
        this._clear(this._activeGroup, 'active');
        this._clear(this._otherGroup, 'other');

        const active = this._active;
        active.forEach((code, i) => {
            const installed = this._installed.includes(code);
            const row = new Adw.ActionRow({
                title: langLabel(code),
                subtitle: !installed && this._bin
                    ? _('Not installed')
                    : i === 0 ? _('Primary') : _('Priority {n}', {n: i + 1}),
            });
            row.add_prefix(new Gtk.Label({
                label: `${i + 1}`,
                width_chars: 2,
                css_classes: ['dim-label', 'numeric'],
            }));

            if (!installed && this._bin && this._packageKit) {
                const install = new Gtk.Button({
                    label: _('Install'),
                    valign: Gtk.Align.CENTER,
                    css_classes: ['suggested-action'],
                });
                install.connect('clicked', () => this._runPackageOp(install, _('Installing…'), code,
                    () => installPackages([langPackage(code)])));
                row.add_suffix(install);
            }

            const up = iconButton('go-up-symbolic', _('Raise priority'), () => {
                const langs = this._active;
                [langs[i - 1], langs[i]] = [langs[i], langs[i - 1]];
                this._setActive(langs);
            });
            up.sensitive = i > 0;
            const down = iconButton('go-down-symbolic', _('Lower priority'), () => {
                const langs = this._active;
                [langs[i + 1], langs[i]] = [langs[i], langs[i + 1]];
                this._setActive(langs);
            });
            down.sensitive = i < active.length - 1;
            const remove = iconButton('list-remove-symbolic', _('Disable'), () => {
                this._setActive(this._active.filter(l => l !== code));
            });
            remove.sensitive = active.length > 1;

            row.add_suffix(up);
            row.add_suffix(down);
            row.add_suffix(remove);
            this._activeGroup.add(row);
            this._rows.active.push(row);
        });

        const summary = new Adw.ActionRow({
            title: _('Combination sent to tesseract'),
            subtitle: active.join('+'),
            subtitle_selectable: true,
            css_classes: ['property'],
        });
        this._activeGroup.add(summary);
        this._rows.active.push(summary);

        const others = this._installed.filter(c => !active.includes(c));
        this._otherGroup.visible = others.length > 0;
        for (const code of others) {
            const row = new Adw.ActionRow({title: langLabel(code)});
            const activate = new Gtk.Button({label: _('Enable'), valign: Gtk.Align.CENTER});
            activate.connect('clicked', () => this._setActive([...this._active, code]));
            row.add_suffix(activate);
            row.activatable_widget = activate;
            this._otherGroup.add(row);
            this._rows.other.push(row);
        }
    }

    // ---------------------------------------------------------------- diálogo

    async _openManager() {
        if (!this._packageKit) {
            this._error(_('Automatic installation unavailable'),
                new Error(_('PackageKit not found. Install manually: {command}', {command: installCommand([langPackage('<code>')])})));
            return;
        }

        const dialog = new Adw.Dialog({
            title: _('Download languages'),
            content_width: 460,
            content_height: 620,
        });
        const view = new Adw.ToolbarView();
        view.add_top_bar(new Adw.HeaderBar());

        const search = new Gtk.SearchEntry({
            placeholder_text: _('Search language or code'),
            margin_start: 12,
            margin_end: 12,
            margin_bottom: 6,
        });
        view.add_top_bar(search);

        const list = new Gtk.ListBox({
            selection_mode: Gtk.SelectionMode.NONE,
            css_classes: ['boxed-list'],
            margin_start: 12,
            margin_end: 12,
            margin_top: 6,
            margin_bottom: 12,
            valign: Gtk.Align.START,
        });
        const spinner = new Adw.Spinner({width_request: 32, height_request: 32, margin_top: 48});
        const stack = new Gtk.Stack();
        stack.add_named(spinner, 'loading');
        stack.add_named(new Gtk.ScrolledWindow({
            child: list,
            vexpand: true,
            hscrollbar_policy: Gtk.PolicyType.NEVER,
        }), 'list');
        view.content = stack;
        dialog.child = view;

        list.set_filter_func(row => {
            const q = search.text.trim().toLowerCase();
            return !q || row._search.includes(q);
        });
        search.connect('search-changed', () => list.invalidate_filter());

        const refreshers = [];
        const refreshAll = () => refreshers.forEach(fn => fn());
        this._dialogRefreshers.add(refreshAll);
        dialog.connect('closed', () => this._dialogRefreshers.delete(refreshAll));

        dialog.present(this._window);

        let available = [];
        try {
            available = await listInstallableLanguages();
        } catch (e) {
            dialog.close();
            this._error(_("Couldn't list the languages"), e);
            return;
        }
        const all = [...new Set([...this._installed, ...available])]
            .sort((a, b) => {
                const ia = this._installed.includes(a), ib = this._installed.includes(b);
                if (ia !== ib)
                    return ia ? -1 : 1;
                return langLabel(a).localeCompare(langLabel(b));
            });

        for (const code of all) {
            const row = new Adw.ActionRow({title: langLabel(code)});
            row._search = `${langLabel(code)} ${code}`.toLowerCase();
            const button = new Gtk.Button({valign: Gtk.Align.CENTER});
            row.add_suffix(button);

            const sync = () => {
                if (this._busy.has(code))
                    return;
                const installed = this._installed.includes(code);
                const required = REQUIRED_LANGS.includes(code);
                row.subtitle = installed
                    ? (this._active.includes(code) ? _('Installed • active') : _('Installed'))
                    : '';
                button.label = installed ? (required ? _('Required') : _('Uninstall')) : _('Install');
                button.css_classes = installed ? ['destructive-action'] : ['suggested-action'];
                button.sensitive = !(installed && required) && !!this._bin;
                button.tooltip_text = required && installed
                    ? _('This language is required by tesseract')
                    : !this._bin ? _('Install tesseract first') : '';
            };
            refreshers.push(sync);
            sync();

            button.connect('clicked', () => {
                if (this._installed.includes(code)) {
                    this._runPackageOp(button, _('Removing…'), code, async () => {
                        await removePackages([langPackage(code)]);
                        this._setActive(this._active.filter(l => l !== code));
                        this._toast(_('{lang} uninstalled', {lang: langLabel(code)}));
                    });
                } else {
                    this._runPackageOp(button, _('Installing…'), code, async () => {
                        await installPackages([langPackage(code)]);
                        this._setActive([...this._active, code]);
                        this._toast(_('{lang} installed and enabled', {lang: langLabel(code)}));
                    });
                }
            });
            list.append(row);
        }
        stack.visible_child_name = 'list';
        search.grab_focus();
    }

    // ---------------------------------------------------------------- reconhecimento

    _buildRecognition() {
        const settings = this._settings;
        const group = new Adw.PreferencesGroup({title: _('Recognition')});

        const model = Gtk.StringList.new(PSM_OPTIONS.map(([, label]) => label()));
        const psmRow = new Adw.ComboRow({
            title: _('Text layout'),
            subtitle: _('Tesseract page segmentation mode'),
            model,
        });
        const current = PSM_OPTIONS.findIndex(([v]) => v === settings.get_int('psm'));
        psmRow.selected = current >= 0 ? current : 2;
        psmRow.connect('notify::selected', () => {
            settings.set_int('psm', PSM_OPTIONS[psmRow.selected][0]);
        });
        group.add(psmRow);

        const upscale = new Adw.SwitchRow({
            title: _('Upscale small selections'),
            subtitle: _('Improves recognition of UI text'),
        });
        settings.bind('upscale', upscale, 'active', Gio.SettingsBindFlags.DEFAULT);
        group.add(upscale);
        return group;
    }
}


const STORAGE_CSS = `
.te-bar { border-radius: 6px; background-color: alpha(currentColor, 0.1); min-height: 12px; }
.te-dot { border-radius: 999px; min-width: 12px; min-height: 12px; }
.te-ext { background-color: var(--accent-bg-color); }
.te-engine { background-color: var(--success-bg-color); }
.te-langs { background-color: var(--warning-bg-color); }
.te-data { background-color: var(--error-bg-color); }
`;

function dot(kind) {
    return new Gtk.Box({css_classes: ['te-dot', `te-${kind}`], valign: Gtk.Align.CENTER});
}

/** Página que mede quanto espaço a extensão e suas dependências ocupam. */
class StoragePage {
    constructor(settings, extensionPath) {
        this._settings = settings;
        this._path = extensionPath;

        const css = new Gtk.CssProvider();
        css.load_from_string(STORAGE_CSS);
        Gtk.StyleContext.add_provider_for_display(Gdk.Display.get_default(), css,
            Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
        this._gen = 0;

        this.page = new Adw.PreferencesPage({
            name: 'storage',
            title: _('Storage'),
            icon_name: 'drive-harddisk-symbolic',
        });

        // --- total ---
        const totalGroup = new Adw.PreferencesGroup();
        this._totalRow = new Adw.ActionRow({
            title: _('Total space used'),
            subtitle: _('Extension, OCR engine, languages and data'),
        });
        this._totalLabel = this._sizeLabel(['title-2']);
        this._totalRow.add_suffix(this._totalLabel);
        this._bar = new Gtk.Box({
            css_classes: ['te-bar'],
            overflow: Gtk.Overflow.HIDDEN,
            margin_top: 12,
            hexpand: true,
        });
        totalGroup.add(this._totalRow);
        totalGroup.add(this._bar);
        this.page.add(totalGroup);

        // --- detalhes ---
        this._group = new Adw.PreferencesGroup({
            title: _('Details'),
            description: _('Disk size of each part.'),
        });
        const refresh = new Gtk.Button({
            icon_name: 'view-refresh-symbolic',
            tooltip_text: _('Measure again'),
            valign: Gtk.Align.CENTER,
            css_classes: ['flat'],
        });
        refresh.connect('clicked', () => this.refresh());
        this._group.set_header_suffix(refresh);
        this.page.add(this._group);

        this._extRow = this._row(_('Extension'), _('Extension files'), 'ext');
        this._engineRow = this._row(_('OCR engine'), _('tesseract and libraries'), 'engine');
        this._langRow = new Adw.ExpanderRow({title: _('Languages'), subtitle: _('Recognition models')});
        this._langRow.add_prefix(dot('langs'));
        this._langLabel = this._sizeLabel();
        this._langRow.add_suffix(this._langLabel);
        this._group.add(this._langRow);
        this._langChildren = [];

        this._dataRow = this._row(_('History and settings'), '', 'data');
        const clear = new Gtk.Button({
            label: _('Clear'),
            valign: Gtk.Align.CENTER,
            css_classes: ['flat'],
            tooltip_text: _('Delete the history of extracted text'),
        });
        clear.connect('clicked', () => {
            settings.set_strv('history', []);
            this.refresh();
        });
        this._dataRow.add_suffix(clear);

        settings.connect('changed::history', () => this._renderData());
        this.refresh();
    }

    _sizeLabel(classes = []) {
        return new Gtk.Label({
            label: '…',
            valign: Gtk.Align.CENTER,
            css_classes: ['numeric', ...classes],
        });
    }

    _row(title, subtitle, kind) {
        const row = new Adw.ActionRow({title, subtitle});
        row.add_prefix(dot(kind));
        row._size = this._sizeLabel();
        row.add_suffix(row._size);
        this._group.add(row);
        return row;
    }

    _historyBytes() {
        const enc = new TextEncoder();
        return this._settings.get_strv('history').reduce((n, t) => n + enc.encode(t).length, 0);
    }

    _renderData() {
        const count = this._settings.get_strv('history').length;
        this._sizes.data = this._historyBytes();
        this._dataRow.subtitle = count === 1 ? _('1 text in history') : _('{n} texts in history', {n: count});
        this._dataRow._size.label = formatSize(this._sizes.data);
        this._renderTotal();
    }

    _renderTotal() {
        const parts = [
            ['ext', _('Extension')],
            ['engine', _('OCR engine')],
            ['langs', _('Languages')],
            ['data', _('Data')],
        ];
        const total = parts.reduce((n, [k]) => n + (this._sizes[k] || 0), 0);
        this._totalLabel.label = formatSize(total);

        for (let c = this._bar.get_first_child(); c;) {
            const next = c.get_next_sibling();
            this._bar.remove(c);
            c = next;
        }
        if (total <= 0)
            return;
        for (const [k, label] of parts) {
            const size = this._sizes[k] || 0;
            if (size <= 0)
                continue;
            const frac = size / total;
            this._bar.append(new Gtk.Box({
                width_request: Math.max(3, Math.round(frac * 560)),
                tooltip_text: `${label}: ${formatSize(size)} (${(frac * 100).toFixed(1)}%)`,
                css_classes: [`te-${k}`],
            }));
        }
    }

    async refresh() {
        const gen = ++this._gen;
        this._sizes = {};
        const tesseractPath = this._settings.get_string('tesseract-path');

        this._sizes.ext = pathSize(this._path);
        this._extRow._size.label = formatSize(this._sizes.ext);
        this._extRow.subtitle = this._path.replace(GLib.get_home_dir(), '~');

        const pkgs = await engineSizes();
        if (gen !== this._gen)
            return;
        this._sizes.engine = [...pkgs.values()].reduce((a, b) => a + b, 0);
        if (pkgs.size > 0) {
            this._engineRow.subtitle = [...pkgs.keys()].join(', ');
            this._engineRow._size.label = formatSize(this._sizes.engine);
        } else {
            const bin = resolveTesseract(tesseractPath);
            this._engineRow.subtitle = bin ? _('{path} (package size unavailable)', {path: bin}) : _('Not installed');
            this._sizes.engine = bin ? pathSize(bin) : 0;
            this._engineRow._size.label = bin ? formatSize(this._sizes.engine) : '—';
        }

        const dir = await tessdataDir(tesseractPath);
        if (gen !== this._gen)
            return;
        for (const r of this._langChildren)
            this._langRow.remove(r);
        this._langChildren = [];
        this._sizes.langs = 0;
        const files = [];
        if (dir) {
            try {
                const en = Gio.File.new_for_path(dir).enumerate_children('standard::name,standard::size',
                    Gio.FileQueryInfoFlags.NONE, null);
                for (let info; (info = en.next_file(null));) {
                    const name = info.get_name();
                    if (name.endsWith('.traineddata'))
                        files.push([name.replace(/\.traineddata$/, ''), info.get_size()]);
                }
                en.close(null);
            } catch (e) {
                logError(e);
            }
        }
        files.sort((a, b) => b[1] - a[1]);
        for (const [code, size] of files) {
            this._sizes.langs += size;
            const row = new Adw.ActionRow({title: langLabel(code)});
            row.add_suffix(new Gtk.Label({label: formatSize(size), css_classes: ['numeric', 'dim-label']}));
            this._langRow.add_row(row);
            this._langChildren.push(row);
        }
        this._langRow.subtitle = files.length
            ? _('{n} models in {dir}', {n: files.length, dir: dir.replace(GLib.get_home_dir(), '~')})
            : _('No languages installed');
        this._langRow.enable_expansion = files.length > 0;
        this._langLabel.label = files.length ? formatSize(this._sizes.langs) : '—';

        this._renderData();
    }
}

export default class TextShotPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        window.set_default_size(660, 760);
        const uiSettings = this.getSettings();
        window._uiSettings = uiSettings;
        window._pages = [];

        const build = () => {
            const visible = window.visible_page_name;
            for (const page of window._pages)
                window.remove(page);
            for (const [obj, id] of window._handlers ?? [])
                obj.disconnect(id);
            window._handlers = [];

            setLanguage(uiSettings.get_string('ui-language'));
            const settings = this._trackedSettings(window);

            window._storage = new StoragePage(settings, this.path);
            window._ocr = new OcrPage(settings, window);
            window._pages = [this._generalPage(settings), window._ocr.page, window._storage.page];
            for (const page of window._pages)
                window.add(page);
            if (visible)
                window.visible_page_name = visible;
        };

        // reconstrói fora do sinal do combo que disparou a mudança
        uiSettings.connect('changed::ui-language', () => GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            build();
            return GLib.SOURCE_REMOVE;
        }));
        build();
    }

    /** Gio.Settings cujos sinais são desconectados quando a janela é reconstruída. */
    _trackedSettings(window) {
        const settings = this.getSettings();
        const connect = settings.connect.bind(settings);
        settings.connect = (signal, cb) => {
            const id = connect(signal, cb);
            window._handlers.push([settings, id]);
            return id;
        };
        return settings;
    }

    _languageGroup(settings) {
        const group = new Adw.PreferencesGroup({
            title: _('Interface language'),
            description: _('Language used by the extension menus, notifications and settings.'),
        });
        const sys = UI_LANGUAGES.find(([c]) => c === systemLanguage())?.[1] ?? 'English';
        const labels = UI_LANGUAGES.map(([code, name]) =>
            code === 'system' ? _('System language ({lang})', {lang: sys}) : name);
        const row = new Adw.ComboRow({
            title: _('Language'),
            model: Gtk.StringList.new(labels),
        });
        const idx = UI_LANGUAGES.findIndex(([c]) => c === settings.get_string('ui-language'));
        row.selected = idx >= 0 ? idx : 1;
        row.connect('notify::selected', () => {
            const code = UI_LANGUAGES[row.selected][0];
            if (code !== settings.get_string('ui-language'))
                settings.set_string('ui-language', code);
        });
        group.add(row);
        return group;
    }

    _generalPage(settings) {
        const page = new Adw.PreferencesPage({
            name: 'general',
            title: _('General'),
            icon_name: 'preferences-system-symbolic',
        });

        page.add(this._languageGroup(settings));

        const keys = new Adw.PreferencesGroup({
            title: _('Shortcut'),
            description: _('Click the row to record a new shortcut.'),
        });
        keys.add(new ShortcutRow(settings, 'extract-shortcut', {title: _('Extract text from screen')}));
        page.add(keys);

        const behavior = new Adw.PreferencesGroup({title: _('Behavior')});
        behavior.add(this._switch(settings, 'show-indicator', _('Top bar icon'),
            _('Menu with history, languages and settings')));
        behavior.add(this._switch(settings, 'show-notification', _('Notification on copy')));
        behavior.add(this._switch(settings, 'join-lines', _('Join lines'),
            _('Copies the text as a single line')));

        const historySize = Adw.SpinRow.new_with_range(0, 50, 1);
        historySize.title = _('History items');
        historySize.subtitle = _('0 disables history');
        historySize.value = settings.get_int('history-size');
        historySize.connect('notify::value', () => {
            const size = Math.round(historySize.value);
            settings.set_int('history-size', size);
            settings.set_strv('history', settings.get_strv('history').slice(0, size));
        });
        behavior.add(historySize);
        page.add(behavior);

        const about = new Adw.PreferencesGroup();
        const version = new Adw.ActionRow({
            title: _('Version'),
            subtitle: this.metadata?.['version-name'] ?? '',
            subtitle_selectable: true,
        });
        if (this.metadata?.url) {
            version.add_suffix(new Gtk.LinkButton({
                label: 'GitHub',
                uri: this.metadata.url,
                valign: Gtk.Align.CENTER,
            }));
        }
        about.add(version);
        page.add(about);

        return page;
    }

    _switch(settings, key, title, subtitle = '') {
        const row = new Adw.SwitchRow({title, subtitle});
        settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
        return row;
    }
}
