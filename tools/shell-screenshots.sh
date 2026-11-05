#!/usr/bin/env bash
# Tira as capturas da extensão rodando de verdade (seleção, menu, notificação)
# dentro de um GNOME Shell headless e isolado: usa dconf, extensões e barramento
# D-Bus próprios num diretório temporário, sem tocar na sessão do usuário.
# Uso: make shell-screenshots
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/docs/screenshots"
ZIP="$ROOT/dist/textshot@wesleyara.shell-extension.zip"
WORK="$(mktemp -d -t textshot-shell-XXXXXX)"
trap 'rm -rf "$WORK"' EXIT

if [[ "${1:-}" != "--inner" ]]; then
    export XDG_DATA_HOME="$WORK/data" XDG_CONFIG_HOME="$WORK/config"
    export XDG_CACHE_HOME="$WORK/cache" XDG_STATE_HOME="$WORK/state"
    EXT="$XDG_DATA_HOME/gnome-shell/extensions"
    mkdir -p "$EXT" "$OUT"
    unzip -q "$ZIP" -d "$EXT/textshot@wesleyara"
    glib-compile-schemas "$EXT/textshot@wesleyara/schemas"
    cp -r "$ROOT/tools/shell-helper" "$EXT/screenshot-helper@textshot.dev"
    trap - EXIT
    WORK="$WORK" dbus-run-session -- "$0" --inner
    rm -rf "$WORK"
    exit
fi

DISPLAY_NAME="textshot-shots-$$"
unset DISPLAY WAYLAND_DISPLAY

gsettings set org.gnome.shell enabled-extensions "['screenshot-helper@textshot.dev', 'textshot@wesleyara']"
gsettings set org.gnome.shell welcome-dialog-last-shown-version '999'
gsettings set org.gnome.desktop.interface enable-animations false
gsettings set org.gnome.TextEditor use-system-font false 2>/dev/null || true
gsettings set org.gnome.TextEditor custom-font 'Cantarell 26' 2>/dev/null || true
gsettings set org.gnome.TextEditor show-line-numbers false 2>/dev/null || true
gsettings set org.gnome.TextEditor restore-session false 2>/dev/null || true

gnome-shell --headless --wayland --no-x11 --wayland-display "$DISPLAY_NAME" \
    --virtual-monitor 1440x900 > "$WORK/shell.log" 2>&1 &
SHELL_PID=$!
trap 'kill $SHELL_PID 2>/dev/null || true' EXIT

ev() {
    gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell \
        --method org.gnome.Shell.Eval "$1"
}

for _ in $(seq 60); do
    if ev 'globalThis.shots ? shots.state() : null' 2>/dev/null | grep -q '"state"'; then break; fi
    sleep 0.5
done
sleep 4  # deixa a extensão terminar a verificação inicial de dependências
ev 'shots.state()'

cat > "$WORK/sample.txt" <<'TXT'
TextShot

Copy text from anywhere on your screen.
Press Super + Shift + T, drag over the text
and paste it wherever you want.
TXT
WAYLAND_DISPLAY="$DISPLAY_NAME" GDK_BACKEND=wayland \
    gnome-text-editor --standalone "$WORK/sample.txt" > "$WORK/editor.log" 2>&1 &
sleep 5
ev 'shots.arrange(220, 140, 1000, 620)'
sleep 1

ev "shots.selection('$OUT/selection.png', 212, 312, 925, 488, '$OUT/copied.png')"
sleep 1
ev "shots.menu('$OUT/menu.png')"

echo "--> $OUT/menu.png $OUT/selection.png $OUT/copied.png"
