// Extensão auxiliar usada SOMENTE dentro do GNOME Shell isolado de tools/shell-screenshots.sh.
// Libera o D-Bus Eval e expõe funções para posicionar janelas, abrir o menu,
// simular a seleção com um mouse virtual e capturar a tela.
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as BoxPointer from 'resource:///org/gnome/shell/ui/boxpointer.js';

const wait = ms => new Promise(r => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
    r();
    return GLib.SOURCE_REMOVE;
}));

class Shots {
    ext() {
        return Main.extensionManager.lookup('textshot@wesleyara')?.stateObj;
    }

    state() {
        const e = Main.extensionManager.lookup('textshot@wesleyara');
        return {state: e?.state, error: e?.error ?? null, indicator: !!e?.stateObj?._indicator,
            windows: global.get_window_actors().map(a => a.meta_window.get_title())};
    }

    arrange(x, y, width, height) {
        Main.overview.hide();
        for (const actor of global.get_window_actors()) {
            const w = actor.meta_window;
            w.unmaximize?.(3);
            w.move_resize_frame(false, x, y, width, height);
            w.activate(global.get_current_time());
        }
        return this.state();
    }

    async capture(path, rect = null) {
        const shooter = new Shell.Screenshot();
        const stream = Gio.File.new_for_path(path).replace(null, false, Gio.FileCreateFlags.NONE, null);
        if (rect)
            await shooter.screenshot_area(rect.x, rect.y, rect.width, rect.height, stream);
        else
            await shooter.screenshot(false, stream);
        stream.close(null);
        return path;
    }

    /** Mostra um texto grande no centro da tela (usado pelo teste de compatibilidade). */
    showText(text) {
        Main.overview.hide();
        this._label?.destroy();
        this._label = new St.Label({
            text,
            style: 'font-size: 40px; color: black; background-color: white; padding: 40px 60px;',
        });
        Main.layoutManager.uiGroup.add_child(this._label);
        this._label.set_position(200, 200);
        return new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
            const [w, h] = this._label.get_transformed_size();
            resolve({x: 200, y: 200, width: Math.round(w), height: Math.round(h)});
            return GLib.SOURCE_REMOVE;
        }));
    }

    async menu(path) {
        const ind = this.ext()._indicator;
        ind.menu.open(BoxPointer.PopupAnimation.NONE);
        await wait(300);
        ind._historyMenu.setSubmenuShown(true);
        await wait(700);
        const box = ind.menu.actor;
        const [mx, my] = box.get_transformed_position();
        const [mw, mh] = box.get_transformed_size();
        const [ix] = ind.get_transformed_position();
        const right = Math.min(global.stage.width, Math.max(mx + mw, ix + ind.width) + 40);
        const left = Math.max(0, Math.min(mx, ix) - 160);
        const rect = {x: Math.round(left), y: 0, width: Math.round(right - left), height: Math.round(my + mh + 30)};
        await this.capture(path, rect);
        ind.menu.close(BoxPointer.PopupAnimation.NONE);
        return rect;
    }

    async selection(path, x1, y1, x2, y2, copiedPath) {
        const seat = global.stage.get_context?.().get_backend().get_default_seat() ??
            Clutter.get_default_backend().get_default_seat();
        const dev = seat.create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
        const now = () => GLib.get_monotonic_time();

        dev.notify_absolute_motion(now(), x1 - 40, y1 - 40);
        this.ext().extract();
        await wait(1500);
        dev.notify_absolute_motion(now(), x1, y1);
        await wait(100);
        dev.notify_button(now(), Clutter.BUTTON_PRIMARY, Clutter.ButtonState.PRESSED);
        for (let i = 1; i <= 20; i++) {
            dev.notify_absolute_motion(now(), x1 + (x2 - x1) * i / 20, y1 + (y2 - y1) * i / 20);
            await wait(30);
        }
        await wait(500);
        await this.capture(path);

        dev.notify_button(now(), Clutter.BUTTON_PRIMARY, Clutter.ButtonState.RELEASED);
        // espera o OCR e a notificação aparecerem
        await wait(3500);
        if (copiedPath) {
            const w = 760;
            await this.capture(copiedPath, {x: Math.round((global.stage.width - w) / 2), y: 0, width: w, height: 170});
        }
        dev.notify_absolute_motion(now(), global.stage.width - 5, global.stage.height - 5);
        return new Promise(resolve => St.Clipboard.get_default().get_text(St.ClipboardType.CLIPBOARD,
            (_c, text) => resolve(text)));
    }
}

export default class ScreenshotHelper {
    enable() {
        global.context.unsafe_mode = true;
        globalThis.shots = new Shots();
    }

    disable() {
        delete globalThis.shots;
    }
}
