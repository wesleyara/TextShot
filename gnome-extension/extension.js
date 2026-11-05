// SPDX-License-Identifier: GPL-2.0-or-later
import Clutter from 'gi://Clutter';
import GdkPixbuf from 'gi://GdkPixbuf';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {
    basePackages, enginePackage, friendlyError, hasPackageKitAsync, installCommand, installPackages,
    langFromPackage, langLabel, langPackage,
    listLanguages, parseLangs, resolveTesseract, run,
} from './lib.js';
import {_, setLanguage} from './i18n.js';

const TITLE = 'TextShot';
const MIN_SIZE = 4;

/** Camada em tela cheia onde o usuário arrasta um retângulo. */
class AreaSelector {
    select() {
        return new Promise(resolve => {
            this._resolve = resolve;

            this._actor = new St.Widget({
                style_class: 'textshot-overlay',
                reactive: true,
                can_focus: true,
                x: 0,
                y: 0,
                width: global.stage.width,
                height: global.stage.height,
            });
            this._band = new St.Widget({style_class: 'textshot-band', visible: false});
            this._actor.add_child(this._band);

            const hint = new St.Label({
                style_class: 'textshot-hint',
                text: _('Drag to select text  •  Esc to cancel'),
            });
            this._actor.add_child(hint);
            const monitor = Main.layoutManager.primaryMonitor;
            hint.connect('notify::width', () => {
                hint.set_position(
                    Math.round(monitor.x + (monitor.width - hint.width) / 2),
                    monitor.y + Math.round(monitor.height * 0.06));
            });

            Main.uiGroup.add_child(this._actor);
            try {
                this._actor.set_cursor_type(Clutter.CursorType.CROSSHAIR);
            } catch {}

            this._grab = Main.pushModal(this._actor, {actionMode: Shell.ActionMode.POPUP});
            this._actor.grab_key_focus();

            this._actor.connect('button-press-event', (_a, event) => {
                if (event.get_button() !== Clutter.BUTTON_PRIMARY) {
                    this._finish(null);
                    return Clutter.EVENT_STOP;
                }
                [this._startX, this._startY] = event.get_coords();
                this._dragging = true;
                this._updateBand(this._startX, this._startY);
                this._band.show();
                return Clutter.EVENT_STOP;
            });
            this._actor.connect('motion-event', (_a, event) => {
                if (this._dragging)
                    this._updateBand(...event.get_coords());
                return Clutter.EVENT_STOP;
            });
            this._actor.connect('button-release-event', (_a, event) => {
                if (!this._dragging)
                    return Clutter.EVENT_STOP;
                this._dragging = false;
                const rect = this._rect(...event.get_coords());
                this._finish(rect.width >= MIN_SIZE && rect.height >= MIN_SIZE ? rect : null);
                return Clutter.EVENT_STOP;
            });
            this._actor.connect('key-press-event', (_a, event) => {
                if (event.get_key_symbol() === Clutter.KEY_Escape)
                    this._finish(null);
                return Clutter.EVENT_STOP;
            });
        });
    }

    _rect(x, y) {
        const x1 = Math.round(Math.min(this._startX, x));
        const y1 = Math.round(Math.min(this._startY, y));
        const x2 = Math.round(Math.max(this._startX, x));
        const y2 = Math.round(Math.max(this._startY, y));
        return {x: x1, y: y1, width: x2 - x1, height: y2 - y1};
    }

    _updateBand(x, y) {
        const r = this._rect(x, y);
        this._band.set_position(r.x, r.y);
        this._band.set_size(Math.max(r.width, 1), Math.max(r.height, 1));
    }

    cancel() {
        this._finish(null);
    }

    _finish(result) {
        if (!this._actor)
            return;
        if (this._grab) {
            Main.popModal(this._grab);
            this._grab = null;
        }
        this._actor.destroy();
        this._actor = null;
        const resolve = this._resolve;
        this._resolve = null;
        resolve?.(result);
    }
}

const Indicator = GObject.registerClass(
class TextShotIndicator extends PanelMenu.Button {
    _init(ext) {
        super._init(0.0, TITLE);
        this._ext = ext;

        this.add_child(new St.Icon({
            gicon: Gio.icon_new_for_string(`${ext.path}/icons/textshot-symbolic.svg`),
            style_class: 'system-status-icon',
        }));

        const extractItem = new PopupMenu.PopupMenuItem(_('Extract text from screen'));
        extractItem.connect('activate', () => {
            // espera o menu fechar antes de abrir a seleção
            ext.extractDelayed();
        });
        this.menu.addMenuItem(extractItem);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this._historyMenu = new PopupMenu.PopupSubMenuMenuItem(_('History'));
        this.menu.addMenuItem(this._historyMenu);
        this._langMenu = new PopupMenu.PopupSubMenuMenuItem(_('Languages'));
        this.menu.addMenuItem(this._langMenu);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        const prefsItem = new PopupMenu.PopupMenuItem(_('Settings'));
        prefsItem.connect('activate', () => ext.openPreferences());
        this.menu.addMenuItem(prefsItem);

        this.menu.connect('open-state-changed', (_m, open) => {
            if (open) {
                this._fillHistory();
                this._fillLanguages().catch(logError);
            }
        });
    }

    _fillHistory() {
        const menu = this._historyMenu.menu;
        menu.removeAll();
        const history = this._ext.settings.get_strv('history');
        if (history.length === 0) {
            const empty = new PopupMenu.PopupMenuItem(_('Empty'), {reactive: false});
            menu.addMenuItem(empty);
            return;
        }
        for (const text of history) {
            const oneLine = text.replace(/\s+/g, ' ');
            const label = oneLine.length > 50 ? `${oneLine.slice(0, 47)}…` : oneLine;
            const item = new PopupMenu.PopupMenuItem(label);
            item.connect('activate', () => this._ext.copy(text, true));
            menu.addMenuItem(item);
        }
        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        const clear = new PopupMenu.PopupMenuItem(_('Clear history'));
        clear.connect('activate', () => this._ext.settings.set_strv('history', []));
        menu.addMenuItem(clear);
    }

    async _fillLanguages() {
        const settings = this._ext.settings;
        const installed = await listLanguages(settings.get_string('tesseract-path'));
        const menu = this._langMenu.menu;
        menu.removeAll();
        if (installed.length === 0) {
            menu.addMenuItem(new PopupMenu.PopupMenuItem(_('tesseract not found'), {reactive: false}));
            return;
        }
        const active = parseLangs(settings.get_string('languages'));
        for (const code of installed) {
            const item = new PopupMenu.PopupSwitchMenuItem(langLabel(code), active.includes(code));
            item.connect('toggled', (_i, state) => {
                let langs = parseLangs(settings.get_string('languages'));
                if (state && !langs.includes(code))
                    langs.push(code);
                else if (!state)
                    langs = langs.filter(l => l !== code);
                if (langs.length === 0) {
                    item.setToggleState(true);
                    return;
                }
                settings.set_string('languages', langs.join('+'));
            });
            menu.addMenuItem(item);
        }
        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        const more = new PopupMenu.PopupMenuItem(_('Install more languages…'));
        more.connect('activate', () => this._ext.openPreferences());
        menu.addMenuItem(more);
    }
});

export default class TextShotExtension extends Extension {
    enable() {
        this.settings = this.getSettings();
        this._busy = false;
        this._timeouts = new Set();
        this._cancellable = new Gio.Cancellable();

        Main.wm.addKeybinding('extract-shortcut', this.settings,
            Meta.KeyBindingFlags.IGNORE_AUTOREPEAT,
            Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW,
            () => this.extract().catch(logError));

        setLanguage(this.settings.get_string('ui-language'));
        this._indicatorId = this.settings.connect('changed::show-indicator', () => this._syncIndicator());
        this._uiLangId = this.settings.connect('changed::ui-language', () => {
            setLanguage(this.settings.get_string('ui-language'));
            // recria o menu do painel no novo idioma
            this._indicator?.destroy();
            this._indicator = null;
            this._syncIndicator();
        });
        this._syncIndicator();

        // verifica dependências logo depois de ativar / iniciar a sessão
        this._wait(3000).then(() => this._ensureDeps()).catch(logError);
    }

    disable() {
        Main.wm.removeKeybinding('extract-shortcut');
        this.settings.disconnect(this._indicatorId);
        this.settings.disconnect(this._uiLangId);
        this._installNotification?.destroy();
        this._installNotification = null;
        this._source?.destroy();
        this._source = null;
        this._indicator?.destroy();
        this._indicator = null;
        this._selector?.cancel();
        this._selector = null;
        this._cancellable.cancel();
        this._cancellable = null;
        for (const id of this._timeouts)
            GLib.source_remove(id);
        this._timeouts.clear();
        this.settings = null;
    }

    _syncIndicator() {
        const show = this.settings.get_boolean('show-indicator');
        if (show && !this._indicator) {
            this._indicator = new Indicator(this);
            Main.panel.addToStatusArea(this.uuid, this._indicator);
        } else if (!show && this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }
    }

    _wait(ms) {
        return new Promise(resolve => {
            const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
                this._timeouts.delete(id);
                resolve();
                return GLib.SOURCE_REMOVE;
            });
            this._timeouts.add(id);
        });
    }

    extractDelayed() {
        this._wait(200).then(() => this.extract()).catch(logError);
    }

    async extract() {
        if (this._busy || !this.settings)
            return;
        this._busy = true;
        let file = null;
        try {
            if (!await this._ensureDeps())
                return;
            const bin = resolveTesseract(this.settings.get_string('tesseract-path'));

            this._selector = new AreaSelector();
            const rect = await this._selector.select();
            this._selector = null;
            if (!rect || !this.settings)
                return;

            // deixa a camada de seleção sumir da tela antes de capturar
            await this._wait(80);

            file = await this._capture(rect);
            if (this.settings.get_boolean('upscale'))
                this._upscale(file.get_path());

            let text = await this._ocr(bin, file.get_path());
            if (!this.settings)
                return;
            if (!text) {
                this._notify(_('No text found.'));
                return;
            }
            if (this.settings.get_boolean('join-lines'))
                text = text.replace(/\s*\n\s*/g, ' ');

            this.copy(text);
            this._addHistory(text);
        } catch (e) {
            // extensão desativada no meio do processo: sai em silêncio
            if (!this.settings || e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                return;
            logError(e, TITLE);
            this._notifyError(e.message);
        } finally {
            this._busy = false;
            if (file) {
                try {
                    file.delete(null);
                } catch {}
            }
        }
    }

    /** Pacotes que faltam: o tesseract em si ou os idiomas configurados. */
    async _missingPackages() {
        const path = this.settings.get_string('tesseract-path');
        if (!resolveTesseract(path))
            return basePackages();
        const installed = await listLanguages(path);
        return parseLangs(this.settings.get_string('languages'))
            .filter(code => !installed.includes(code))
            .map(langPackage);
    }

    /** Retorna true se tudo está instalado; senão oferece a instalação. */
    async _ensureDeps() {
        if (!this.settings || this._installing)
            return false;
        const missing = await this._missingPackages();
        if (missing.length === 0)
            return true;
        await this._offerInstall(missing);
        return false;
    }

    async _offerInstall(packages) {
        const needsTesseract = packages.includes(enginePackage());
        const canInstall = await hasPackageKitAsync();
        if (!this.settings)
            return;
        let body = needsTesseract
            ? _('The tesseract OCR engine needs to be installed.')
            : _('These OCR languages need to be installed: {langs}', {
                langs: packages.map(p => langLabel(langFromPackage(p) ?? p)).join(', '),
            });
        if (!canInstall)
            body += `\n${installCommand(packages)}`;

        this._installNotification?.destroy();
        const source = this._getSource();
        const notification = new MessageTray.Notification({
            source,
            title: TITLE,
            body,
            urgency: MessageTray.Urgency.HIGH,
        });
        if (canInstall)
            notification.addAction(_('Install'), () => this._install(packages).catch(logError));
        notification.connect('destroy', () => {
            if (this._installNotification === notification)
                this._installNotification = null;
        });
        this._installNotification = notification;
        source.addNotification(notification);
    }

    async _install(packages) {
        if (this._installing)
            return;
        this._installing = true;
        this._notifyAlways(_('Installing {packages}…', {packages: packages.join(', ')}));
        try {
            await installPackages(packages);
            const [accel] = this.settings?.get_strv('extract-shortcut') ?? [];
            this._notifyAlways(accel
                ? _('Done! Press {shortcut} to extract text.', {
                    shortcut: accel.replace(/[<>]/g, m => (m === '>' ? '+' : '')),
                })
                : _('Done! You can now extract text.'));
        } catch (e) {
            this._notifyError(_('Installation failed: {error}', {error: friendlyError(e)}));
        } finally {
            this._installing = false;
        }
    }

    async _capture({x, y, width, height}) {
        const path = GLib.build_filenamev([GLib.get_tmp_dir(), `textshot-${GLib.uuid_string_random()}.png`]);
        const file = Gio.File.new_for_path(path);
        const stream = file.replace(null, false, Gio.FileCreateFlags.PRIVATE, null);
        const shooter = new Shell.Screenshot();
        try {
            await new Promise((resolve, reject) => {
                shooter.screenshot_area(x, y, width, height, stream, (obj, res) => {
                    try {
                        obj.screenshot_area_finish(res);
                        resolve();
                    } catch (e) {
                        reject(e);
                    }
                });
            });
        } finally {
            stream.close(null);
        }
        return file;
    }

    _upscale(path) {
        try {
            const pb = GdkPixbuf.Pixbuf.new_from_file(path);
            const factor = pb.get_height() < 600 ? 3 : pb.get_height() < 1200 ? 2 : 1;
            if (factor === 1)
                return;
            const scaled = pb.scale_simple(pb.get_width() * factor, pb.get_height() * factor,
                GdkPixbuf.InterpType.BILINEAR);
            scaled.savev(path, 'png', [], []);
        } catch (e) {
            logError(e, `${TITLE}: upscale`);
        }
    }

    async _ocr(bin, path) {
        const langs = this.settings.get_string('languages') || 'eng';
        const psm = String(this.settings.get_int('psm'));
        const [status, out, err] = await run(
            [bin, path, '-', '-l', langs, '--psm', psm],
            {OMP_THREAD_LIMIT: '1'}, this._cancellable);
        if (status !== 0)
            throw new Error(err.trim() || _('tesseract exited with code {code}', {code: status}));
        return out.replace(/\f/g, '')
            .split('\n').map(l => l.trimEnd()).join('\n')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    }

    copy(text, fromHistory = false) {
        St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, text);
        if (!fromHistory) {
            const preview = text.length > 140 ? `${text.slice(0, 137)}…` : text;
            this._notify(preview, _('Text copied'));
        }
    }

    /** Fonte de notificações própria ("TextShot" com o ícone da extensão). */
    _getSource() {
        if (!this._source) {
            this._source = new MessageTray.Source({
                title: TITLE,
                icon: Gio.icon_new_for_string(`${this.path}/icons/textshot-symbolic.svg`),
            });
            this._source.connect('destroy', () => {
                this._source = null;
            });
            Main.messageTray.add(this._source);
        }
        return this._source;
    }

    _notifyAlways(body, title = TITLE) {
        const source = this._getSource();
        source.addNotification(new MessageTray.Notification({source, title, body, isTransient: true}));
    }

    _notifyError(body) {
        console.warn(`${TITLE}: ${body}`);
        this._notifyAlways(body);
    }

    _notify(body, title = TITLE) {
        if (this.settings?.get_boolean('show-notification'))
            this._notifyAlways(body, title);
    }

    _addHistory(text) {
        const size = this.settings.get_int('history-size');
        if (size <= 0)
            return;
        const history = this.settings.get_strv('history').filter(t => t !== text);
        history.unshift(text);
        this.settings.set_strv('history', history.slice(0, size));
    }
}
