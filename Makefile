UUID    := textshot@wesleyara
SRC     := gnome-extension
DIST    := dist
ZIP     := $(DIST)/$(UUID).shell-extension.zip

.PHONY: all pack check test version release-patch release-minor release-major release-dry-run hooks install enable disable prefs uninstall nested log screenshots shell-screenshots clean

all: pack

pack:
	scripts/pack.sh

# validações rápidas antes de enviar ao extensions.gnome.org
check: pack
	glib-compile-schemas --strict --dry-run $(SRC)/schemas
	python3 -m json.tool $(SRC)/metadata.json > /dev/null
	for f in $(SRC)/*.js; do node --check --input-type=module < $$f || exit 1; done
	python3 tools/check_translations.py
	node --test tests/*.test.mjs
	unzip -l $(ZIP)

install: pack
	gnome-extensions install --force $(ZIP)
	@echo
	@echo ">> Instalado. No Wayland, saia e entre na sessão e depois rode: make enable"

enable:
	gnome-extensions enable $(UUID)

disable:
	gnome-extensions disable $(UUID)

prefs:
	gnome-extensions prefs $(UUID)

uninstall:
	gnome-extensions uninstall $(UUID)

# GNOME Shell aninhado numa janela, para testar sem sair da sessão
nested: install
	dbus-run-session -- gnome-shell --devkit --wayland

log:
	journalctl --user -f -o cat /usr/bin/gnome-shell | grep --line-buffered -iE "textshot|error|warning"

# gera docs/screenshots/*.png das configurações (abre janelas por alguns segundos)
screenshots: install
	gjs -m tools/screenshots.js

# capturas do Shell (seleção, menu, notificação) num GNOME Shell headless e isolado
shell-screenshots: pack
	tools/shell-screenshots.sh

test:
	node --test tests/*.test.mjs

version:
	@node scripts/version.mjs

# Versionamento (igual ao DbLocal): rode na branch develop, limpa e sincronizada.
# Atualiza version-name, escreve o CHANGELOG, cria o commit e a tag vX.Y.Z e faz o push.
release-patch:
	node scripts/release.mjs patch
release-minor:
	node scripts/release.mjs minor
release-major:
	node scripts/release.mjs major
# mostra o que a próxima versão teria, sem mudar nada (KIND=patch|minor|major)
release-dry-run:
	node scripts/release.mjs $(or $(KIND),patch) --dry-run

# bloqueia mensagens de commit com rastros de assistente de IA
hooks:
	git config core.hooksPath .githooks

clean:
	rm -rf $(DIST)
