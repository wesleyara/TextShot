// Gera docs/screenshots/*.png renderizando a janela de configurações real da
// extensão fora do GNOME Shell. Uso: make screenshots  (ou gjs -m tools/screenshots.js [idioma])
//
// As configurações do usuário são copiadas para um backend em memória, então nada
// é alterado no sistema. Uma janela aparece por alguns segundos durante a captura.
import Adw from 'gi://Adw?version=1';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk?version=4.0';

const ROOT = GLib.path_get_dirname(GLib.path_get_dirname(
    GLib.filename_from_uri(import.meta.url)[0]));
const SRC = GLib.build_filenamev([ROOT, 'gnome-extension']);
const OUT = GLib.build_filenamev([ROOT, 'docs', 'screenshots']);
const SCHEMA_ID = 'org.gnome.shell.extensions.textshot';
const LANG = ARGV[0] ?? 'en';

// --- copia a extensão para um diretório temporário trocando o import do Shell por um stub
const tmp = GLib.dir_make_tmp('textshot-shots-XXXXXX');
for (const name of ['prefs.js', 'lib.js', 'i18n.js', 'translations.js']) {
    let [, bytes] = GLib.file_get_contents(GLib.build_filenamev([SRC, name]));
    let text = new TextDecoder().decode(bytes);
    if (name === 'prefs.js') {
        text = text.replace(
            "'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js'",
            "'./stub.js'");
    }
    GLib.file_set_contents(GLib.build_filenamev([tmp, name]), text);
}

// compila o schema num diretório próprio
GLib.mkdir_with_parents(`${tmp}/schemas`, 0o755);
Gio.File.new_for_path(`${SRC}/schemas/${SCHEMA_ID}.gschema.xml`)
    .copy(Gio.File.new_for_path(`${tmp}/schemas/${SCHEMA_ID}.gschema.xml`), 0, null, null);
GLib.spawn_command_line_sync(`glib-compile-schemas ${tmp}/schemas`);

GLib.file_set_contents(`${tmp}/stub.js`, `
import Gio from 'gi://Gio';
export class ExtensionPreferences {
    constructor(path, settingsFactory, metadata) { this.path = path; this._factory = settingsFactory; this.metadata = metadata; }
    getSettings() { return this._factory(); }
}`);

const source = Gio.SettingsSchemaSource.new_from_directory(`${tmp}/schemas`,
    Gio.SettingsSchemaSource.get_default(), false);
const schema = source.lookup(SCHEMA_ID, false);
const backend = Gio.memory_settings_backend_new();
const path = '/org/gnome/shell/extensions/textshot/';

// copia os valores atuais do usuário (se a extensão estiver instalada) e fixa o idioma
const memory = Gio.Settings.new_full(schema, backend, path);
try {
    const real = Gio.Settings.new_full(schema, null, path);
    for (const key of schema.list_keys())
        memory.set_value(key, real.get_value(key));
} catch {}
memory.set_string('ui-language', LANG);
if (memory.get_strv('history').length === 0)
    memory.set_strv('history', ['Hello from TextShot!', 'https://github.com/wesleyara/TextShot']);

const {default: Prefs} = await import(`file://${tmp}/prefs.js`);

const wait = ms => new Promise(r => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
    r();
    return GLib.SOURCE_REMOVE;
}));

function save(window, file) {
    const width = window.get_width(), height = window.get_height();
    const paintable = new Gtk.WidgetPaintable({widget: window});
    const snapshot = new Gtk.Snapshot();
    paintable.snapshot(snapshot, width, height);
    const node = snapshot.to_node();
    const texture = window.get_native().get_renderer().render_texture(node, null);
    texture.save_to_png(`${OUT}/${file}`);
    print(`docs/screenshots/${file}`);
}

const app = new Adw.Application({application_id: 'io.github.wesleyara.TextShot.Screenshots'});
app.connect('activate', () => {
    shoot().catch(e => {
        printerr(`erro: ${e}\n${e.stack}`);
        app.quit();
    });
});

async function shoot() {
    Adw.StyleManager.get_default().color_scheme = Adw.ColorScheme.FORCE_LIGHT;
    GLib.mkdir_with_parents(OUT, 0o755);

    const installed = GLib.build_filenamev([GLib.get_user_data_dir(), 'gnome-shell', 'extensions', 'textshot@wesleyara']);
    const extPath = GLib.file_test(installed, GLib.FileTest.IS_DIR) ? installed : SRC;
    const [, metaBytes] = GLib.file_get_contents(`${SRC}/metadata.json`);
    const metadata = JSON.parse(new TextDecoder().decode(metaBytes));
    const prefs = new Prefs(extPath, () => Gio.Settings.new_full(schema, backend, path), metadata);
    const window = new Adw.PreferencesWindow({application: app, title: 'TextShot'});
    prefs.fillPreferencesWindow(window);
    window.set_default_size(680, 780);
    window.present();
    await wait(2500);

    const suffix = LANG === 'en' ? '' : `-${LANG}`;
    for (const page of ['general', 'ocr', 'storage']) {
        window.visible_page_name = page;
        await wait(800);
        save(window, `${page}${suffix}.png`);
    }

    window.visible_page_name = 'ocr';
    window._ocr._openManager();
    await wait(3000);
    save(window, `download-languages${suffix}.png`);

    app.quit();
}
await app.runAsync([]);
GLib.spawn_command_line_sync(`rm -rf ${tmp}`);
