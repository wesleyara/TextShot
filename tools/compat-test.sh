#!/usr/bin/env bash
# Testa a extensão num GNOME Shell real de outra versão, dentro de um container Fedora.
#   tools/compat-test.sh ubuntu:24.04   # GNOME 46
#   tools/compat-test.sh 41             # Fedora 41 = GNOME 47
#   tools/compat-test.sh 42             # Fedora 42 = GNOME 48
#   tools/compat-test.sh 43             # Fedora 43 = GNOME 49
# Verifica: a extensão ativa sem erro, a seleção + OCR copia o texto certo e a janela
# de configurações abre e renderiza as 3 páginas. Capturas ficam em dist/compat/<versão>/.
set -euo pipefail
TARGET="${1:?uso: compat-test.sh <versão do Fedora | ubuntu:XX.YY>}"
[[ "$TARGET" == *:* ]] && IMAGE="$TARGET" || IMAGE="registry.fedoraproject.org/fedora:$TARGET"
NAME="${TARGET//[:\/]/-}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
"$ROOT/scripts/pack.sh" >/dev/null
mkdir -p "$ROOT/dist/compat/$NAME"

docker run --rm -i \
    -v "$ROOT:/src:ro" -v "$ROOT/dist/compat/$NAME:/out" \
    "$IMAGE" bash -s <<'INNER'
set -euo pipefail
if command -v dnf >/dev/null; then
    dnf -y -q install --setopt=install_weak_deps=False --setopt=fastestmirror=True --setopt=timeout=30 --setopt=retries=10 gnome-shell gjs libadwaita gtk4 \
        tesseract tesseract-langpack-eng tesseract-langpack-por mesa-dri-drivers mesa-libEGL \
        dbus-daemon glib2 unzip python3 >/dev/null 2>&1
else
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq >/dev/null
    apt-get install -y -qq --no-install-recommends gnome-shell gjs gir1.2-adw-1 gir1.2-gtk-4.0 \
        tesseract-ocr tesseract-ocr-eng tesseract-ocr-por libgl1-mesa-dri dbus dbus-daemon \
        libglib2.0-bin gsettings-desktop-schemas unzip python3 passwd >/dev/null 2>&1
fi
useradd -m tester
# o GNOME Shell precisa de um barramento de sistema; sem /run/systemd/seats ele usa o login manager "dummy"
mkdir -p /run/dbus && dbus-daemon --system --fork
rm -rf /run/systemd/seats
cat > /home/tester/run.sh <<'RUN'
set -euo pipefail
export XDG_RUNTIME_DIR=/tmp/rt; mkdir -p -m 700 $XDG_RUNTIME_DIR
export XDG_DATA_HOME=$HOME/.local/share
EXT=$XDG_DATA_HOME/gnome-shell/extensions
mkdir -p $EXT
unzip -q /src/dist/textshot@wesleyara.shell-extension.zip -d $EXT/textshot@wesleyara
glib-compile-schemas $EXT/textshot@wesleyara/schemas
cp -r /src/tools/shell-helper $EXT/screenshot-helper@textshot.dev
gsettings set org.gnome.shell disable-extension-version-validation true
gsettings set org.gnome.shell enabled-extensions "['screenshot-helper@textshot.dev', 'textshot@wesleyara']"
gsettings set org.gnome.shell welcome-dialog-last-shown-version '999'
gsettings set org.gnome.desktop.interface enable-animations false

echo "== $(gnome-shell --version), $(gjs --version 2>/dev/null | head -1)"
gnome-shell --headless --wayland --no-x11 --wayland-display compat-0 --virtual-monitor 1280x800 > /out/shell.log 2>&1 &
ev() { gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell --method org.gnome.Shell.Eval "$1"; }
for _ in $(seq 120); do ev 'globalThis.shots ? shots.state() : null' 2>/dev/null | grep -q '"state"' && break; sleep 0.5; done
sleep 4
echo "== estado da extensão"
STATE=$(ev 'shots.state()'); echo "$STATE"
echo "$STATE" | grep -q '"state":1,"error":""' || { echo "FALHOU: extensão não ativou"; exit 1; }
R=$(ev "shots.showText('Hello GNOME compatibility test')")
echo "== área do texto: $R"
G=$(echo "$R" | python3 -c "import sys,json,re; d=json.loads(re.search(r\"'(.*)'\", sys.stdin.read()).group(1)); print(d['x']-10, d['y']-10, d['x']+d['width']+10, d['y']+d['height']+10)")
read X1 Y1 X2 Y2 <<< "$G"
echo "== OCR (texto copiado)"
OCR=$(ev "shots.selection('/out/selection.png', $X1, $Y1, $X2, $Y2, '/out/copied.png')"); echo "$OCR"
echo "$OCR" | grep -q 'Hello GNOME compatibility test' || { echo "FALHOU: texto copiado diferente"; exit 1; }
echo "== menu"; ev "shots.menu('/out/menu.png')"
echo "== configurações"
WAYLAND_DISPLAY=compat-0 GDK_BACKEND=wayland TEXTSHOT_SHOTS_DIR=/out timeout 60 gjs -m /tmp/src/tools/screenshots.js en > /out/prefs.log 2>&1 && echo "prefs ok: $(grep -c png /out/prefs.log) capturas" || { echo "FALHOU: configurações"; tail -20 /out/prefs.log; exit 1; }
echo "== erros do shell relacionados"
grep -iE "textshot|JS ERROR|TypeError|ReferenceError|SyntaxError" /out/shell.log | grep -v "^$" | head -20 || true
RUN
# screenshots.js escreve um diretório temporário ao lado; copia o repo para um lugar gravável
cp -r /src /tmp/src && chown -R tester /tmp/src /out
su tester -c 'cd ~ && dbus-run-session -- bash run.sh'
INNER
