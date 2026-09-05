# backend

**Diretório morto.** Não existe código aqui e não vai existir — este README é o que sobrou
do layout inicial do repositório.

O plano original dizia que a lógica P2P (Hyperswarm/Hypercore/Hyperdht, ecossistema
Holepunch) entraria aqui depois que um `frontend/` mockado estivesse validado. **Não foi o
que aconteceu.** A arquitetura v2 (`docs/backend-v2.md`) organizou o produto em camadas
dentro de um único pacote de núcleo, e a rede foi construída lá:

- descoberta e replicação — `core/src/l0/swarm/` (`HyperswarmBackend`, o backend real de
  §14.1/§14.3 sobre a DHT), `core/src/l0/corestore/`, `core/src/l1/`, `core/src/l2/`;
- quem liga o swarm à rede em produção — `app/src/utility/index.ts`, dentro do
  `utilityProcess` do Electron;
- a mídia (voz em malha, tela em estrela) é WebRTC no renderer — `frontend/src/live/`.

`hyperswarm`, `hypercore` e `corestore` são dependências de `app/package.json`.

Contexto do projeto em `../CLAUDE.md`; estado das fases em `../docs/backend-v2.md` §29.
