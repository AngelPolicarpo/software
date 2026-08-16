#!/usr/bin/env bash
# Compila os addons nativos contra glibc 2.31, do fonte.
#
# Roda DENTRO do container de build/Dockerfile. Não execute no host: o host desta máquina
# é glibc 2.43 (Ubuntu 26.04) e o resultado não serviria à matriz de A16.
#
# POR QUE ESTE PASSO EXISTE, medido em 2026-08-16: os prebuilds publicados no npm são
# compilados pelos mantenedores contra a glibc deles. Os de linux-x64 exigem
# better-sqlite3 2.34, sodium-native 2.33, udx-native 2.14 — dois deles ACIMA do piso 2.31
# que a matriz de A16 declara. Um artefato montado com eles quebraria em toda máquina entre
# 2.31 e 2.33 (Debian 11, Ubuntu 20.04) e o gate teria passado mentindo.
#
# TRÊS SISTEMAS DE BUILD DIFERENTES, também medido:
#   better-sqlite3  binding.gyp, e só compila com --force_build=1; sem isso o node-gyp
#                   termina "ok" tendo apenas tocado stamps.
#   sodium-native   CMakeLists.txt + cmake-bare/cmake-fetch/cmake-napi. NÃO tem binding.gyp.
#   udx-native      idem.
# `@electron/rebuild` termina com "Rebuild Complete" sem compilar nenhum dos três.
set -uo pipefail

ELECTRON_VERSION="${ELECTRON_VERSION:?defina ELECTRON_VERSION}"
GLIBC_FLOOR="2.31"
OUT="${ADDONS_OUT:-out/gate-G0}"
NM="/work/node_modules"

echo "==> glibc do ambiente de build: $(ldd --version | head -1)"
echo "==> cmake: $(cmake --version | head -1)"
echo "==> alvo: Electron ${ELECTRON_VERSION}, linux-x64, do fonte"

max_glibc() {
  local v
  v="$(objdump -T "$1" 2>/dev/null | grep -oE 'GLIBC_[0-9]+(\.[0-9]+)+' | sed 's/GLIBC_//' | sort -V | tail -1)"
  [ -z "$v" ] && v="none"
  printf '%s' "$v"
}
version_le() { [ "$1" = "$(printf '%s\n%s\n' "$1" "$2" | sort -V | head -1)" ]; }

if [ ! -d node_modules ]; then
  echo "==> npm install"
  npm install --no-audit --no-fund >/dev/null
fi
mkdir -p "${OUT}"

# --- (1) evidência do "antes" ----------------------------------------------------------
SHIPPED=""
for p in better-sqlite3 sodium-native udx-native; do
  while IFS= read -r f; do
    [ -z "$f" ] && continue
    SHIPPED="${SHIPPED}    {\"pkg\": \"${p}\", \"path\": \"${f#node_modules/}\", \"maxGlibc\": \"$(max_glibc "$f")\"},
"
  done < <(find "node_modules/${p}/prebuilds" -path '*linux-x64*' -name '*.node' 2>/dev/null | sort)
done

STATUS=""

# --- (2a) better-sqlite3: node-gyp, com --force_build=1 --------------------------------
echo "==> better-sqlite3: node-gyp rebuild --force_build=1"
(
  cd node_modules/better-sqlite3 || exit 1
  export npm_config_runtime=electron
  export npm_config_target="${ELECTRON_VERSION}"
  export npm_config_disturl=https://electronjs.org/headers
  export npm_config_arch=x64 npm_config_target_arch=x64
  npx --yes node-gyp rebuild --release --force_build=1
) >"out/gyp-better-sqlite3.log" 2>&1 \
  && { STATUS="${STATUS}better-sqlite3=ok "; echo "    ok"; } \
  || { STATUS="${STATUS}better-sqlite3=FALHOU "; echo "    FALHOU"; tail -12 out/gyp-better-sqlite3.log | sed 's/^/    | /'; }

# --- (2b) sodium-native e udx-native: cmake -------------------------------------------
# São addons N-API puros: não recebem versão de runtime como alvo. O que a compilação
# aqui garante não é ABI de Electron, é o piso de glibc.
for p in sodium-native udx-native; do
  echo "==> ${p}: cmake"
  (
    cd "node_modules/${p}" || exit 1
    cmake -S . -B build-src -DCMAKE_BUILD_TYPE=Release -DCMAKE_PREFIX_PATH="${NM}" \
      && cmake --build build-src --parallel "$(nproc)"
  ) >"out/cmake-${p}.log" 2>&1 \
    && { STATUS="${STATUS}${p}=ok "; echo "    ok"; } \
    || { STATUS="${STATUS}${p}=FALHOU "; echo "    FALHOU"; tail -12 "out/cmake-${p}.log" | sed 's/^/    | /'; }
done

# --- (3) instala o que foi compilado por cima do prebuild publicado --------------------
# `require-addon` e `node-gyp-build` procuram em prebuilds/<plataforma>-<arch>/. Escrever
# ali é o que faz o binário do container ser o binário que o app carrega — e é o que
# "nenhum rebuild manual pós-empacotamento" exige que já esteja resolvido no build.
echo "==> instalando binários compilados sobre os prebuilds"
INSTALLED=""
install_built() {
  local pkg="$1" src="$2" dest="$3"
  if [ -f "$src" ]; then
    mkdir -p "$(dirname "$dest")"
    cp -f "$src" "$dest"
    INSTALLED="${INSTALLED}${pkg} "
    echo "    ${pkg}: $(basename "$src") -> ${dest#node_modules/}"
  else
    echo "    ${pkg}: nada compilado em ${src}"
  fi
}
install_built better-sqlite3 \
  "node_modules/better-sqlite3/build/Release/better_sqlite3.node" \
  "node_modules/better-sqlite3/prebuilds/linux-x64.node"
for p in sodium-native udx-native; do
  built="$(find "node_modules/${p}/build-src" -name "${p}.node" -type f 2>/dev/null | head -1)"
  install_built "${p}" "${built:-/nonexistent}" "node_modules/${p}/prebuilds/linux-x64/${p}.node"
done

# --- (4) evidência do "depois" ---------------------------------------------------------
BUILT=""
fail=0
found=0
check() {
  local pkg="$1" f="$2"
  [ -f "$f" ] || return 0
  found=$((found + 1))
  local g verdict
  g="$(max_glibc "$f")"
  if [ "$g" = "none" ]; then verdict="SEM_SIMBOLO_GLIBC"
  elif version_le "$g" "${GLIBC_FLOOR}"; then verdict="OK"
  else verdict="ACIMA_DO_PISO"; fail=1; fi
  BUILT="${BUILT}    {\"pkg\": \"${pkg}\", \"path\": \"${f#node_modules/}\", \"sizeBytes\": $(stat -c%s "$f"), \"maxGlibc\": \"${g}\", \"verdict\": \"${verdict}\"},
"
}
check better-sqlite3 node_modules/better-sqlite3/prebuilds/linux-x64.node
check sodium-native  node_modules/sodium-native/prebuilds/linux-x64/sodium-native.node
check udx-native     node_modules/udx-native/prebuilds/linux-x64/udx-native.node
[ "${found}" -eq 3 ] || fail=1

{
  echo "{"
  echo "  \"electronVersion\": \"${ELECTRON_VERSION}\","
  echo "  \"glibcFloor\": \"${GLIBC_FLOOR}\","
  echo "  \"buildGlibc\": \"$(ldd --version | head -1 | grep -oE '[0-9]+\.[0-9]+' | tail -1)\","
  echo "  \"builtAt\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\","
  echo "  \"buildStatus\": \"${STATUS}\","
  echo "  \"instalados\": \"${INSTALLED}\","
  echo "  \"prebuildsPublicadosNoNpm\": ["
  printf '%s' "${SHIPPED}" | sed '$ s/,$//'
  echo "  ],"
  echo "  \"aposCompilarNoContainer\": ["
  printf '%s' "${BUILT}" | sed '$ s/,$//'
  echo "  ],"
  echo "  \"verdict\": \"$([ ${fail} -eq 0 ] && echo APROVADO || echo REPROVADO)\""
  echo "}"
} > "${OUT}/addons-build.json"

echo "==> ${OUT}/addons-build.json"
exit ${fail}
