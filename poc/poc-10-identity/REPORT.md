# POC-10 / gate G10 — `safeStorage`, fronteira da chave e lock composto

**Veredito: APROVADO nos dois alvos da matriz**, 10/10 critérios em cada, 2026-08-16.
Artefatos: `out/gate-G10/gate-G10.json` (`linux-x64`) e `out/gate-G10/windows/gate-G10.json`
(`win32-x64`), consolidados em `out/gate-G10/matriz.json` (`completo: true`).
Este documento **não é normativo**.

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

### 3.1.1 Medição de `--password-store` (B2, 2026-08-16)

O achado acima deixou uma pergunta em aberto. Ela foi medida no artefato empacotado, nove
configurações, mesma máquina e mesmo `gnome-keyring`:

| # | Configuração | `getSelectedStorageBackend()` | `isEncryptionAvailable()` | Tempo |
|---|---|---|---|---|
| A | autodetecção, sem `XDG_CURRENT_DESKTOP` | `basic_text` | **false** | 342 ms |
| B | `XDG_CURRENT_DESKTOP=GNOME` | `gnome_libsecret` | **true** | 570 ms |
| C | `--password-store=gnome-libsecret` | `gnome_libsecret` | **true** | 533 ms |
| D | `--password-store=gnome-libsecret`, **sem barramento de sessão** | `gnome_libsecret` | **false** | 387 ms |
| E | `--password-store=kwallet5` (ausente) | `kwallet5` | **false** | 351 ms |
| F | `--password-store=kwallet6` (ausente) | `kwallet6` | **false** | 355 ms |
| G | `--password-store=basic` | `basic_text` | **false** | 379 ms |
| H | autodetecção, sem barramento | `basic_text` | **false** | 360 ms |
| I | `--password-store=gnome-libsecret` + `XDG=GNOME` | `gnome_libsecret` | **true** | 596 ms |

Quatro conclusões, e as três primeiras são o que fecha a pergunta:

1. **`getSelectedStorageBackend()` reporta intenção, não capacidade.** Em D, E e F ele
   devolve o backend **pedido** enquanto `isEncryptionAvailable()` é `false`. O nome do
   backend não é sinal de segurança. `isEncryptionAvailable()` é — e foi `true` exatamente
   nos três casos em que o round-trip funcionou (`v11`, 35 bytes, decifra igual).
2. **A ⇄ C é a prova do falso negativo.** Mesma máquina, mesmo chaveiro, mesmo barramento:
   só muda a flag, e `available` vai de `false` a `true`. Ler `basic_text` como "não há
   secret store" está errado nessa configuração.
3. **Forçar não fabrica segurança.** Quando o serviço realmente não existe (D, sem
   barramento; E e F, sem kwallet), `available` continua `false`. A assimetria é o que torna
   o probe seguro: ele só recupera store que existe, nunca inventa um.
4. **Não há risco de travamento.** O pior caso mediu 596 ms; os backends ausentes falham em
   ~350 ms, sem timeout de D-Bus.

**Onde a flag pode ser aplicada.** `app.commandLine.appendSwitch('password-store', …)` só
tem efeito **antes** de `app.whenReady()`; depois do ready não muda nada — medido nos dois
modos. Como `isEncryptionAvailable()` só responde depois do ready, "tentar outro backend"
significa **relançar o processo**, não reconfigurar em voo.

Consequência para o produto, e é emenda normativa: A13(5) manda recusar em degradado, o que
continua certo, mas a spec identifica degradado por `basic_text` — e o caso A mostra que isso
recusa uma máquina que tem chaveiro funcionando, empurrando o usuário a aceitar modo
inseguro sem necessidade. O patch proposto está em `docs/sequenciamento-pos-fase-0.md` §11.

### 3.1.2 O lock de §10.8 não sobe no Windows escrito da forma óbvia

A primeira corrida em `win32-x64` reprovou **9 dos 10 critérios**, todos com o mesmo erro no
boot: `EPERM: operation not permitted, ftruncate`. Não era defeito de produto — era a etapa 2
do lock composto:

```js
const fd = fs.openSync(LOCK_PATH, 'a+');   // O_RDWR|O_APPEND|O_CREAT
fs.ftruncateSync(fd, 0);                   // EPERM no Windows
```

**No Windows um descritor em modo append recusa `ftruncate`.** No Linux funciona, então o
código passa em toda a bateria de um alvo e falha inteiro no outro. O `'w+'` não é a saída:
ele truncaria **antes** do `tryLock`, apagando o PID do dono legítimo justamente no caso em
que o lock está ocupado — que é quando §10.8 precisa ler o dono para decidir se é órfão. A
forma portátil é `O_RDWR|O_CREAT`, que cria sem truncar e sem append.

Vale para a fase 1: §10.8 é entrega de fase 1, e este é o tipo de divergência que só aparece
rodando no segundo alvo.

**Delta medido.** Como o artefato de `linux-x64` foi produzido antes deste fix, a
equivalência das duas variantes no Linux foi medida diretamente, fora do Electron: arquivo
novo, sobrescrita de conteúdo anterior, disputa de lock e legibilidade do dono com lock
ativo. Resultado **idêntico byte a byte** nas quatro. O artefato de `linux-x64` continua
valendo para o código atual por medição, não por argumento.

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
- **Sessão gráfica no Windows.** O alvo `win32-x64` foi exercitado em Windows nativo, com
  `safeStorage` em DPAPI (`backend: win32`, `available: true`), mas por linha de comando —
  registro de handler de protocolo pelo instalador e deep link entregue pelo shell do
  sistema seguem sem evidência, como no Linux.
- **Proveniência dos dois artefatos.** O de `win32-x64` saiu do código com o fix de §3.1.2;
  o de `linux-x64` é anterior a ele. A equivalência no Linux foi medida (§3.1.2), não
  assumida.
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

### O alvo Windows

O harness escolhe o diretório de saída por `process.platform`, então **rode-o com `node` no
próprio Windows** — não por interop a partir do WSL, que reportaria `linux-x64`.

```powershell
npm run pack:win
# copie release\win-unpacked para uma pasta em C: (evite \\wsl.localhost e /mnt/c)
$env:POC10_BIN = "C:\temp\poc10\poc-10-identity.exe"
$env:POC10_PROFILE = "full"
node dist\scripts\run-all.js
```

Escreve `out/gate-G10/windows/gate-G10.json` e recompõe `out/gate-G10/matriz.json` a partir
dos dois artefatos, **sem tocar** no de `linux-x64`. Se o artefato do Windows for trazido de
outra máquina em vez de gerado aqui, consolide sem reexecutar nada — rodar o harness inteiro
só para consolidar sobrescreveria o artefato do alvo local:

```bash
POC10_PROFILE=full POC10_MATRIZ_ONLY=1 node dist/scripts/run-all.js   # sai != 0 se incompleta
``` A corrida imprime `matriz: COMPLETA` só
quando os dois alvos estiverem presentes e aprovados; até lá, `INCOMPLETA` com o alvo que
falta. O piso de glibc não se aplica aqui, mas `G0-E2` sim: os `.node` de `win32-x64` são
prebuilds do npm (A16).
