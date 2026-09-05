# Uniduni

Comunidade P2P de voz, vídeo e tela — sem servidor central. Cada comunidade é hospedada
pela máquina de quem a criou.

## Sumário

- [Sobre](#sobre)
- [Funcionalidades principais](#funcionalidades-principais)
- [Instalação / quick start](#instalação--quick-start)
- [Uso](#uso)
- [Documentação](#documentação)
- [Configuração](#configuração)
- [Contribuindo](#contribuindo)
- [Licença](#licença)

## Sobre

Uniduni é um app de comunidade em voz, vídeo e compartilhamento de tela, no formato de
servidores/canais, mas sem backend central: os dados moram na máquina de quem hospeda a
comunidade e são descobertos por DHT, não por um servidor de terceiros.

O repositório está em transição de especificação para implementação. `core/` é o primeiro
código de produto do projeto (o núcleo determinístico do estado da comunidade); `frontend/`
hoje é uma interface com dados mockados, ainda sem a camada P2P; `backend/` — a replicação
via Hyperswarm/Hypercore/Hyperdht — ainda não foi iniciada. Consulte
[`docs/backlog.md`](docs/backlog.md) para o estado atual de cada fatia.

## Funcionalidades principais

O que a arquitetura normativa (`docs/backend-v2.md`) define para o produto:

- Comunidades hospedadas pela máquina de quem as cria, sem servidor central.
- Estado da comunidade como `fold(log)` — função pura, total e determinística sobre um log
  append-only.
- Voz em malha P2P direta entre participantes.
- Compartilhamento de tela via WebRTC em estrela, com degradação medida sob carga (§17.5).
- Sem teto artificial de ocupação — nem de voz, nem de câmeras, nem de espectadores de tela
  (§90); o limite real é a máquina do host.
- Shell Electron com fronteiras de processo explícitas (main / `utilityProcess` / renderer).

Partes marcadas `REQUIRES POC` ou `BENCHMARK REQUIRED` na especificação só entram em
produto depois de evidência experimental — ver [`poc/`](poc/) e
[`docs/plano-de-validacao-experimental-v2.md`](docs/plano-de-validacao-experimental-v2.md).

## Instalação / quick start

Requer Node.js ≥ 22. O repositório é um monorepo sem workspace raiz — cada pacote
(`core/`, `frontend/`, `app/`) tem seu próprio `package.json`.

```bash
# núcleo (fold, projector, permissions, outbox...)
cd core
npm install
npm run build
npm test

# interface (Vite + React, hoje com dados mockados)
cd ../frontend
npm install
npm run build

# shell Electron — carrega frontend/dist e core/dist diretamente em dev
cd ../app
npm install
npm run dev
```

Os três comandos de build acima foram executados neste repositório antes desta seção ser
escrita.

## Uso

`app` é o produto (Electron: main + `utilityProcess` + renderer). `npm run dev` em `app/`
abre o shell com a interface de `frontend/` e o núcleo de `core/` rodando como
`utilityProcess`. Como `backend/` (a camada de rede P2P) ainda não existe, hoje isso expõe
o núcleo real por trás de uma interface com dados mockados — não uma comunidade
efetivamente distribuída entre duas máquinas.

Para rodar só o núcleo, sem Electron:

```bash
cd core
npm test          # build + suíte unitária/projeção/fronteira
npm run typecheck
```

Para empacotar (Windows x64 / Linux x64, glibc ≥ 2.31 — únicos alvos do v1):

```bash
cd app
npm run montar        # copia frontend/dist e core/dist para dentro do pacote
npm run dist:win       # ou dist:linux
```

## Documentação

A especificação normativa vive em [`docs/`](docs/), com precedência definida em
[`CLAUDE.md`](CLAUDE.md#source-of-truth):

1. [`docs/backend-v2.md`](docs/backend-v2.md) — arquitetura do núcleo.
2. [`docs/adr-v2.md`](docs/adr-v2.md) — decisões arquiteturais.
3. [`docs/plano-de-validacao-experimental-v2.md`](docs/plano-de-validacao-experimental-v2.md) — como cada gate é validado.
4. [`docs/deltas-ux-v2.md`](docs/deltas-ux-v2.md) e [`docs/frontend.md`](docs/frontend.md) — UX e frontend.
5. [`docs/backlog.md`](docs/backlog.md) — o que está aberto hoje.

`core/README.md` documenta o estado módulo a módulo do núcleo.

## Configuração

Variáveis de ambiente lidas pelo núcleo/app (ver `docs/backend-v2.md` §27.2 para a lista
normativa completa):

| Variável | Efeito |
|---|---|
| `P2P_DATA_DIR` | diretório onde o `manifest.db`/`view.db` e as chaves são gravados |
| `P2P_BUILD_CHANNEL` | `prod` ou `dev` — gateia código de desenvolvimento |
| `P2P_RENDERER_URL` | em dev, sobrepõe o carregamento do `frontend/dist` por uma URL (ex.: servidor do Vite) |

## Contribuindo

Veja [`CONTRIBUTING.md`](CONTRIBUTING.md) para como rodar o ambiente local, a convenção de
commits e branches, e como abrir PR.

## Licença

[MIT](LICENSE).
