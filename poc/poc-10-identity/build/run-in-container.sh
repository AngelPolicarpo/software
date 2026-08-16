#!/usr/bin/env bash
# Constrói a imagem de glibc 2.31 e compila os addons dentro dela.
#
# É o único caminho suportado para produzir os binários nativos deste POC. Compilar no
# host viola A16: o piso de glibc é do host de BUILD, e o host desta máquina é 2.43.
set -euo pipefail

cd "$(dirname "$0")/.."
ELECTRON_VERSION="${ELECTRON_VERSION:-43.4.0}"
IMAGE=poc03-glibc231

echo "==> construindo ${IMAGE}"
docker build -q -t "${IMAGE}" -f build/Dockerfile build/ >/dev/null

echo "==> compilando addons (Electron ${ELECTRON_VERSION})"
mkdir -p .container-home out
# --user preserva a posse dos arquivos: sem isso o container escreve como root no
# node_modules montado e o host não consegue mais empacotar.
docker run --rm \
  -v "$PWD":/work -w /work \
  --user "$(id -u):$(id -g)" \
  -e HOME=/work/.container-home \
  -e ELECTRON_VERSION="${ELECTRON_VERSION}" \
  -e ADDONS_OUT="out/gate-G10" \
  "${IMAGE}"
