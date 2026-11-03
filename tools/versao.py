#!/usr/bin/env python3
"""Carimba uma versão nos links de CSS e JS das páginas (ex.: css/style.css?v=202611031200).

Assim, depois de cada atualização o navegador baixa os arquivos novos em vez de usar
os antigos guardados, e ninguém vê o site "pela metade".

Uso (na pasta do projeto, antes do commit):  python tools/versao.py
"""
import datetime
import pathlib
import re

raiz = pathlib.Path(__file__).resolve().parent.parent
versao = datetime.datetime.now().strftime("%Y%m%d%H%M")
padrao = re.compile(r'((?:href|src)="(?:css|js)/[^"?]+\.(?:css|js))(?:\?v=[^"]*)?"')

for pagina in sorted(raiz.glob("*.html")):
    with open(pagina, encoding="utf-8", newline="") as f:
        texto = f.read()
    novo, n = padrao.subn(lambda m: f'{m.group(1)}?v={versao}"', texto)
    if novo != texto:
        with open(pagina, "w", encoding="utf-8", newline="") as f:
            f.write(novo)
    print(f"{pagina.name}: {n} arquivos com ?v={versao}")
