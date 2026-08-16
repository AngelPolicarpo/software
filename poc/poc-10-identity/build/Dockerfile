# Contrato de build de A16: "o piso de glibc é do host de build, não do host de teste".
#
# Debian 11 (bullseye) tem glibc 2.31 — exatamente o piso declarado na matriz. Compilar
# aqui é o que torna "glibc >= 2.31" verdadeiro; compilar no host (glibc 2.43, Ubuntu 26.04)
# produziria um .node que falha em toda máquina entre 2.31 e 2.42, e o gate passaria mentindo.
FROM node:22-bullseye

# python-is-python3: node-gyp procura o binário `python` e o bullseye só instala `python3`.
# git: `cmake-fetch` clona libsodium e libudx durante a configuração do cmake.
# O cmake do bullseye é 3.18 e os CMakeLists de sodium-native/udx-native exigem >= 3.25,
# então ele vem do pip, não do apt.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      python-is-python3 python3-pip ca-certificates git \
 && rm -rf /var/lib/apt/lists/* \
 && pip3 install --no-cache-dir 'cmake>=3.28' \
 && cmake --version

WORKDIR /work

ENV npm_config_cache=/work/.npm-cache \
    ELECTRON_CACHE=/work/.electron-cache \
    ELECTRON_SKIP_BINARY_DOWNLOAD=1

ENTRYPOINT ["bash", "build/build-addons.sh"]
