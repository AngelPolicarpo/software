# POC-10 / gate G10 — `safeStorage`, fronteira da chave e lock composto

**Veredito: APROVADO** em `linux-x64`, 10/10 critérios, 2026-08-16.
Artefato: `out/gate-G10/gate-G10.json`. Este documento **não é normativo**.

Cobre `adr-v2.md` A13 e A16, `backend-v2.md` §10.8 (lock composto), §18.6 (`wipe`
retomável) e §3.5 (deep links), conforme `plano-de-validacao-experimental-v2.md` §3 POC-10.

---

## 1. O que foi construído

Electron 43.4.0 empacotado, main + núcleo em `utilityProcess`, com as duas fronteiras
separadas. O main é **oráculo**, não guardião: embrulha e desembrulha a Data Key com
`safeStorage` e nada mais. Não há caminho no código pelo qual a chave de identidade chegue
até ele — a separação está no tipo, não só na intenção (`src/protocol/messages.ts`).

Não foram implementados: comunidade, RPC de produto, renderer de produto. O renderer existe
apenas para que a IPC-R tenha quadros reais sob varredura.

## 2. Critérios e evidência

| # | Critério | Resultado |
|---|---|---|
| D1 | Identidade criada e recuperada igual após reinício | chave pública idêntica nos dois boots; `created` verdadeiro no primeiro, falso no segundo |
| D2 | **Zero** ocorrência da semente em disco, log e IPC-R | 20 arquivos e 4 quadros varridos, nas três codificações (bytes crus, hex, base64) — nenhuma ocorrência |
| D3 | A semente em disco está cifrada | `identity.enc` tem 72 bytes e não contém a semente crua |
| D4 | Dois launches concorrentes: exatamente um abre o núcleo | um só núcleo pronto; o perdedor barrado e encerrado |
| D5 | Lock órfão de PID morto não impede a abertura | `LOCK` com PID inexistente não bloqueou o boot |
| D6 | Lock composto na ordem exata de §10.8 | `app-instance → lock-file → corestore-rocksdb → sqlite` |
| D7 | `wipe` retoma e completa a partir de **todos** os estágios | os 6 estágios de §18.6, cada um com `SIGKILL` no ponto |
| D8 | `basic_text` recusa abrir sem aceite explícito | `E_KEYSTORE_INSECURE`, e o aceite é persistido |
| D9 | Export/import com frase certa e errada | frase errada recusa com `E_DECRYPT`; frase certa restaura a chave pública |
| D10 | Gramática fechada do deep link (§3.5) | 1 aceito, 3 recusados (código curto, path traversal, `javascript:`) |

A varredura de D2 é a peça central. Para procurar um padrão de bytes é preciso conhecê-lo,
então o harness **injeta** uma semente conhecida por `POC10_TEST_SEED` e depois caça esses
bytes em todo arquivo do diretório de dados, em `stdout`, em `stderr` e em cada quadro que
passou pela IPC-R. O núcleo nunca escreve a semente em lugar nenhum; se ela aparecesse,
seria vazamento de verdade e não artefato do teste.

## 3. Achados

### 3.1 Em WSL2 o Electron escolhe `basic_text` sozinho

`safeStorage.getSelectedStorageBackend()` devolve `basic_text` e
`isEncryptionAvailable()` devolve `false` **mesmo com `gnome-keyring` rodando e
`org.freedesktop.secrets` no barramento**. A seleção do backend depende da detecção de
ambiente de desktop, e em WSL2 não há nenhum.

Com `--password-store=gnome-libsecret` **ou** `XDG_CURRENT_DESKTOP=GNOME`, o backend passa a
`gnome_libsecret`, `isEncryptionAvailable()` vira `true`, o round-trip funciona e o
ciphertext (prefixo `v11`) não contém o texto claro.

Consequência para o produto: no Linux, cair em `basic_text` **não** é sinal de que o usuário
não tem secret store — pode ser só detecção de ambiente falhando. A13(5) manda recusar abrir
até haver aceite explícito, e isso continua certo; o que este achado acrescenta é que o
aplicativo precisa decidir se passa `--password-store` explicitamente antes de concluir que
o ambiente é degradado. **Não está na spec.**

### 3.2 A retomada do `wipe` precisa acontecer antes de abrir corestore e bancos

§18.6 diz que a retomada acontece "antes de qualquer outra coisa" (§3.3). A leitura ingênua
— abrir tudo, ler `wipe_state`, retomar — **quebra**, e o gate pegou:

```
lock hold by current process ... /p2p/store/db/LOCK: No locks available
```

Retomar de um estágio igual ou posterior a `view-deleted` pula `cores-closed`. O estágio
`key-wiped` então remove o diretório do RocksDB que aquele mesmo boot acabou de abrir, e a
reabertura colide com o handle que o próprio processo ainda mantém.

A ordem correta, e implementada aqui: adquire o `LOCK` (etapa 2), lê `wipe_state` **sem
abrir** corestore nem bancos — pelo sentinela `p2p/WIPE`, ou abrindo `manifest.db` em
somente-leitura e fechando —, retoma, e só então abre o resto. O texto de §18.6 é compatível
com isso, mas não o diz; quem implementar seguindo a ordem literal das etapas encontra o
mesmo erro.

### 3.3 As duas barreiras de §10.8 falham de formas diferentes

A etapa 1 (`app.requestSingleInstanceLock`) encerra o processo **em silêncio**, sem escrever
resultado — é o que a regra 1 de §10.8 manda. A etapa 2 (lock de arquivo) deixa o núcleo
subir e recusa com `E_CORE_ALREADY_RUNNING`.

Para o gate isso importa: "segunda instância nunca abre o núcleo" fica satisfeito pelos dois
caminhos, mas só o segundo produz erro nomeado. Um harness que procurasse mensagem de erro
concluiria, erradamente, que nada barrou a segunda instância.

### 3.4 `bare-compat-napi` é dependência de build obrigatória

`sodium-native` e `udx-native` geram **dois** alvos no CMake: o N-API e o do runtime Bare.
Sem `bare-compat-napi` instalado, o alvo Bare falha com `fatal error: bare.h` e o build
inteiro para — deixando os prebuilds do npm no lugar, acima do piso de glibc. Registrado
porque o sintoma (`bare.h` ausente) não sugere a causa (falta um devDependency).

## 4. O que este POC **não** prova

- **`G0-E1` (A16).** O alvo Linux foi validado em WSL2. Ficam sem evidência: a entrega do
  secret store como um desktop real a faz, o registro de handler `xdg-mime`/`.desktop`, e o
  caminho de deep link de §3.5 numa sessão gráfica de verdade — aqui o deep link foi
  exercitado pelo parse e pelo encaminhamento `second-instance`, não pelo handler do sistema.
- **O alvo Windows.** Este relatório cobre `linux-x64`. G10 exige Windows também.
- **Crash do main** (distinto do crash do núcleo) não foi exercitado.
- **`upgrade`** — boot com dados de uma versão anterior do esquema — não foi exercitado.
- A semente foi procurada por padrão de bytes em disco, log e IPC-R. **Não** houve varredura
  de memória do processo, nem de swap, nem de core dump.
- `L-2` de `backend-v2.md` continua valendo: `safeStorage` não protege contra um adversário
  com execução no dispositivo, e este POC não altera isso.

## 5. Como reproduzir

```bash
cd poc/poc-10-identity
npm ci
npm run addons          # compila os nativos no container de glibc 2.31 — obrigatório
npm run build
npm run pack
POC10_PROFILE=quick node dist/scripts/run-all.js   # escreve out/gate-G10-quick/
POC10_PROFILE=full  node dist/scripts/run-all.js   # escreve out/gate-G10/, o artefato do gate
```

O harness força `XDG_CURRENT_DESKTOP=GNOME` no Linux para exercitar o caminho **com** secret
store, e o limpa no cenário `insecure-refuse` para exercitar o degradado. Em WSL2 o
`gnome-keyring` precisa estar rodando e destravado; sem sessão gráfica isso não acontece
sozinho:

```bash
printf '<senha>' | gnome-keyring-daemon --unlock --components=secrets,pkcs11 --daemonize
```
