#!/usr/bin/env python3
"""Confere se toda string _('...') do código tem tradução em todos os idiomas
e se os marcadores {nome} batem."""
import json
import pathlib
import re
import subprocess
import sys

root = pathlib.Path(__file__).resolve().parent.parent / 'gnome-extension'
code = ''.join(p.read_text() for p in root.glob('*.js') if p.name != 'translations.js')
strings = set()
for m in re.finditer(r"""\b_\((['"])((?:\\.|(?!\1).)*)\1""", code):
    strings.add(m.group(2).encode().decode('unicode_escape').encode('latin-1').decode('utf-8'))

# carrega translations.js via node (formato: export const TRANSLATIONS = {...})
js = (root / 'translations.js').read_text().replace('export const TRANSLATIONS =', 'const T =')
out = subprocess.run(['node', '-e', js + '\nprocess.stdout.write(JSON.stringify(T))'],
                     capture_output=True, text=True, check=True).stdout
translations = json.loads(out)

errors = 0
for lang, table in translations.items():
    for s in sorted(strings):
        if s not in table:
            print(f'[{lang}] faltando: {s!r}')
            errors += 1
        elif sorted(re.findall(r'\{\w+\}', s)) != sorted(re.findall(r'\{\w+\}', table[s])):
            print(f'[{lang}] marcadores diferentes: {s!r}')
            errors += 1
    for s in sorted(set(table) - strings):
        print(f'[{lang}] não usada: {s!r}')
print(f'{len(strings)} strings, {len(translations)} idiomas, {errors} erros')
sys.exit(1 if errors else 0)
