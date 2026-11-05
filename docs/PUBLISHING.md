# Guia de publicação: TextShot

Passo a passo para publicar e atualizar o TextShot no [extensions.gnome.org](https://extensions.gnome.org) (EGO), o site oficial de onde o app **Extension Manager** e o navegador instalam extensões.

| Item | Valor |
| --- | --- |
| Nome | TextShot |
| UUID | `textshot@wesleyara` (não pode mudar depois de publicado) |
| Schema | `org.gnome.shell.extensions.textshot` |
| Repositório | https://github.com/wesleyara/TextShot |
| Licença | GPL-2.0-or-later |
| GNOME suportado | 50 |
| Versão atual | `make version` (o `version-name` do `metadata.json`) |

---

## 1. Antes de enviar

- [ ] **Teste completo na sua sessão.** Saia e entre na sessão para carregar a versão nova e então:
  - [ ] o ícone aparece no painel e o menu está no idioma escolhido
  - [ ] <kbd>Super</kbd>+<kbd>Shift</kbd>+<kbd>T</kbd> abre a seleção; arrastar copia o texto; <kbd>Esc</kbd> cancela
  - [ ] instalar e desinstalar um idioma em **Settings → OCR → Download languages**
  - [ ] trocar o idioma da interface em **General**
  - [ ] desativar e reativar a extensão (`make disable && make enable`) sem erros em `make log`
- [ ] `make check` passa sem erros.

### Capturas de tela

Já estão em `docs/screenshots/` e são geradas automaticamente:

| Arquivo | Como gerar |
| --- | --- |
| `selection.png`, `copied.png`, `menu.png` | `make shell-screenshots`: sobe um GNOME Shell invisível e isolado (dconf, extensões e D-Bus próprios), abre um editor com texto, simula a seleção com um mouse virtual e captura. Também serve de teste de ponta a ponta: o texto reconhecido é impresso no terminal |
| `general.png`, `ocr.png`, `storage.png`, `download-languages.png` | `make screenshots`: renderiza a janela de configurações real |

A `selection.png` é a melhor imagem para a página no EGO.

## 2. Repositório e versões

O versionamento segue o mesmo fluxo do DbLocal:

- **Branches:** o trabalho acontece em `develop`; `main` só recebe releases (via PR develop → main)
- **Versão:** `version-name` em `gnome-extension/metadata.json`, no formato semver `X.Y.Z` (`make version` mostra a atual)
- **Commits:** [Conventional Commits](https://www.conventionalcommits.org): `feat(escopo): ...`, `fix(...)`, `perf`, `refactor`, `docs`, `test`, `chore`, `ci`. `feat`, `fix`, `perf`, `refactor` e `!` (breaking) entram sozinhos no CHANGELOG; o resto fica de fora
- **CHANGELOG.md:** o que estiver em `## [Unreleased]` entra na próxima versão junto com os commits
- **Mensagens de commit:** `make hooks` ativa o `.githooks/commit-msg`, que recusa mensagens com rastros de assistente de IA

### Primeira publicação no GitHub (uma vez)

```bash
git init -b main
make hooks
git add .
git commit -m "chore: initial import"
git remote add origin git@github.com:wesleyara/TextShot.git
git push -u origin main
git switch -c develop
git push -u origin develop
```

No GitHub, deixe `main` como branch padrão.

### Lançar uma versão

Na `develop`, limpa e sincronizada com o `origin`:

```bash
make release-dry-run KIND=major   # mostra a versão e as notas, sem mudar nada
make release-major                # 0.0.0 -> 1.0.0 (a primeira release)
```

Depois use `make release-patch` (correções), `make release-minor` (recursos novos) ou `make release-major` (mudanças incompatíveis). O comando:

1. atualiza `version-name` no `metadata.json`
2. move o `[Unreleased]` e os commits desde a última tag para `## [X.Y.Z] - data` no `CHANGELOG.md`
3. cria o commit `chore(release): vX.Y.Z` e a tag `vX.Y.Z`
4. faz o push da `develop` e da tag

Em seguida abra e faça merge do PR:

```bash
gh pr create --base main --head develop --title "release: vX.Y.Z"
```

O merge na `main` roda `.github/workflows/release.yml`, que cria a release no GitHub com as notas do CHANGELOG e o zip da extensão anexado. O `ci.yml` valida schema, JavaScript, traduções e testes em todo push e PR, e guarda o zip como artefato.

## 3. Enviar para o extensions.gnome.org

1. Crie uma conta em https://extensions.gnome.org/accounts/register/ e confirme o e-mail
2. Pegue o zip anexado à release no GitHub ou gere localmente com `make check`. O arquivo fica em `dist/textshot@wesleyara.shell-extension.zip`
3. Acesse https://extensions.gnome.org/upload/, envie o zip e aceite os termos (a licença precisa ser compatível com a GPL-2.0-or-later, que é o caso)
4. A extensão entra na fila de revisão. Um revisor humano lê o código, o que costuma levar de alguns dias a algumas semanas. O status fica em **Your extensions**

### Possíveis perguntas do revisor

Respostas prontas, caso o revisor questione algo:

- **Por que roda um programa externo (`tesseract`)?**
  > TextShot uses the tesseract CLI for OCR. It is spawned with Gio.Subprocess only after the user selects an area, it is not bundled, it exits on its own and is force-exited through a Gio.Cancellable when the extension is disabled.
- **Por que usa o PackageKit?**
  > Installing or removing packages only happens after an explicit user action (an "Install" button in a notification or in the preferences). It goes through PackageKit over D-Bus, so authorization is handled by polkit. No pkexec or user-writable scripts are used.
- **Por que tem um sistema de tradução próprio em vez de gettext?**
  > The interface language can be chosen in the preferences independently of the system locale and changes live, which gettext domains do not support per extension. Strings are plain JS objects in translations.js.

## 4. Depois de aprovada

- Na página da extensão no EGO, envie uma **captura de tela** (use a `selection.png`)
- Divulgue o link `https://extensions.gnome.org/extension/<id>/textshot/` no README (seção *From extensions.gnome.org*)

### Descrição sugerida para a página (o EGO usa a do `metadata.json`)

> Select an area of the screen, extract its text with OCR (tesseract) and copy it to the clipboard. Inspired by the Text Extractor from Microsoft PowerToys.
>
> • Shortcut: Super+Shift+T (configurable) • Works on Wayland, no screenshot prompt • OCR runs locally • 100+ languages in priority order • Installs tesseract and languages for you (Debian/Ubuntu, Fedora, Arch) • History and storage usage • Interface in English, Português, Español, Deutsch, Italiano, 中文

## 5. Publicar atualizações

1. Faça as mudanças na `develop` com commits `feat:`/`fix:` (`make nested` ajuda a testar sem sair da sessão)
2. `make release-patch` (ou `-minor` / `-major`) e faça merge do PR develop → main
3. Envie o zip da release em https://extensions.gnome.org/upload/. Cada envio passa por revisão de novo. O campo `version` é definido pelo EGO; nós só controlamos o `version-name`

### Nova versão do GNOME (a cada ~6 meses: 51, 52…)

1. Teste na versão nova (Fedora sai primeiro com ela, ou use uma VM)
2. Adicione o número em `shell-version` no `metadata.json`, por exemplo `["50", "51"]`. Não adicione versões que ainda não foram lançadas
3. Envie como uma atualização normal

Para suportar o GNOME 48/49, teste nessas versões antes de adicioná-las (o código usa APIs do Shell 50, como `set_cursor_type`).

## 6. Regras do EGO que já seguimos

Referência: https://gjs.guide/extensions/review-guidelines/review-guidelines.html

- Nada é criado ou conectado antes de `enable()`, e tudo é destruído em `disable()`: atalho, ícone, seleção, timers, notificação e processo do tesseract
- UUID no formato `nome@namespace`, sem `gnome.org`
- `metadata.json` sem o campo `version` e sem versões futuras do GNOME
- Nenhum binário incluído; nada de telemetria
- Instalação de pacotes só depois de um clique do usuário
- Zip sem arquivos desnecessários (sem `gschemas.compiled`, que o GNOME 44+ gera sozinho)
- Classes CSS com prefixo próprio (`textshot-*`)
