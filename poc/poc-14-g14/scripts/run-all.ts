// Gate G14 — POC-14. Uso: POC14_PROFILE=quick|full node dist/scripts/run-all.js
// O perfil `full` sobrescreve `out/gate-G14/`; `quick` escreve `out/gate-G14-quick/`.
//
// Os cinco cenários de POC-14, nesta ordem, e um veredito **por critério**. Um cenário que o
// ambiente não deu é `nao-medido`, nunca "aprovado com ressalva": é o padrão de G7/G8/G12, e
// a razão dele é que um gate que arredonda para verde não serve para bloquear a fase 11.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { platform, arch, cpus, totalmem, hostname, release } from 'node:os';
import { join } from 'node:path';

import { dmFoldRecord, dmHello, dmWorld, type DmState } from '../src/core.js';
import { cenario5 } from '../src/crash.js';
import { cenario1, cenario2 } from '../src/determinismo.js';
import { custoDeReinterpretacao } from '../src/custo.js';
import { rodarFuzzer, tamanhosDeBorda, type ResultadoFuzzer } from '../src/fuzzer.js';
import { cenario3, cenario4, versaoDe } from '../src/hyper.js';
const profile = (process.env['POC14_PROFILE'] ?? 'full') === 'quick' ? 'quick' : 'full';
const outDir = join(process.cwd(), 'out', profile === 'full' ? 'gate-G14' : 'gate-G14-quick');
const workDir = join(process.cwd(), 'out', '.work');

const P = profile === 'quick'
  ? { ordensDeEntrega: 12, fuzzer: 200_000, particaoPorLado: 3, crashRepeticoes: 1, coreTotal: 8, corePerdidos: 5, custoTamanhos: [500, 1_000, 2_000] }
  : { ordensDeEntrega: 240, fuzzer: 10_000_000, particaoPorLado: 12, crashRepeticoes: 6, coreTotal: 24, corePerdidos: 9, custoTamanhos: [1_000, 2_000, 4_000, 8_000] };

function sha256(p: string): string {
  try {
    return createHash('sha256').update(readFileSync(p)).digest('hex');
  } catch {
    return '<ausente>';
  }
}

type Veredito = 'aprovado' | 'reprovado' | 'nao-medido';

const passos: { id: string; desc: string; ok: boolean }[] = [];
function passo(id: string, desc: string, ok: boolean): void {
  passos.push({ id, desc, ok });
  console.log(`  ${ok ? 'ok' : 'FALHOU'} — ${id} ${desc}`);
}

console.log(`POC-14 / gate G14 — perfil ${profile}`);

// ─── Cenário 1 — determinismo do merge ──────────────────────────────────────────────────
const w = dmWorld();
const c1 = cenario1(w, P.ordensDeEntrega, 0x6a7e);
passo('S1', `${c1.ordensDeEntrega} ordens de entrega → hash de dump único`, c1.ok);

// ─── Cenário 2 — inserção retroativa e reinterpretação por snapshot ─────────────────────
const c2 = cenario2(w, [0, 1, 2, 3, 5, 8]);
passo('S2', 'inserção retroativa reinterpreta a partir de snapshot e converge', c2.ok);

// ─── Totalidade (critério 2) ────────────────────────────────────────────────────────────
function aberta(): DmState {
  let s = w.state();
  s = dmFoldRecord(s, dmHello(w, w.lo), 'lo', 0, w.ctx).next;
  s = dmFoldRecord(s, dmHello(w, w.hi), 'hi', 0, w.ctx).next;
  return s;
}
console.log(`  … fuzzer: ${P.fuzzer.toLocaleString('pt-BR')} registros hostis`);
const fuzzer: ResultadoFuzzer = rodarFuzzer(w, aberta, P.fuzzer, 0x5eed);
const bordas = tamanhosDeBorda().map((n) => {
  const r = dmFoldRecord(aberta(), Buffer.alloc(n), 'lo', 1, w.ctx);
  return { bytes: n, decision: r.decision, reason: r.reason ?? null };
});
const totalidadeOk =
  fuzzer.panic === 0 &&
  fuzzer.ultimoPanico === null &&
  fuzzer.desfechoFora === 0 &&
  fuzzer.efeitoEmRecusa === 0 &&
  // O critério é literal: "todo registro hostil termina em `REJECTED` ou `IGNORED` com o
  // código de §31.7.3". Um `APPLIED` no corpus, ou uma recusa sem código, reprova.
  fuzzer.applied === 0 &&
  fuzzer.semCodigo === 0 &&
  fuzzer.ordSumSempreInteiro &&
  fuzzer.rejected > 0 &&
  fuzzer.ignored > 0 &&
  bordas.every((b) => b.decision !== undefined);
passo('S-FUZZ', `panic = ${fuzzer.panic}, desfecho fora dos três = ${fuzzer.desfechoFora}, applied = ${fuzzer.applied}`, totalidadeOk);

// ─── Custo da janela de `ts` (ACHADO-G14-04) ────────────────────────────────────────────
const custo = custoDeReinterpretacao(w, P.custoTamanhos);
passo(
  'S-CUSTO',
  `reinterpretação do zero: ms/registro ×${custo.fatorComAck} para um log ×${custo.crescimentoDoLog}; janela de ts limitada com ack (${custo.janelaLimitadaComAck}) e do tamanho do log sem ack (${custo.janelaCresceSemAck})`,
  custo.janelaCresceSemAck && custo.janelaLimitadaComAck,
);

// ─── Cenário 3 — partição e reconciliação ───────────────────────────────────────────────
console.log('  … partição numa hyperdht/testnet (dois nós, cores reais)');
const c3 = await cenario3(w, join(workDir, 's3'), P.particaoPorLado);
passo('S3', `convergência após partição (${c3.erro ?? 'sem erro'})`, c3.ok);

// ─── Cenário 4 — core encurtado e a pergunta aberta de §31.13 ───────────────────────────
console.log('  … core encurtado: detecção, recomposição e o append prematuro');
const c4 = await cenario4(w, join(workDir, 's4'), P.coreTotal, P.corePerdidos);
passo('S4', `desynced detectado antes do append (${c4.erro ?? 'sem erro'})`, c4.ok);

// ─── Cenário 5 — SIGKILL em cada ponto do append ────────────────────────────────────────
console.log(`  … SIGKILL em 4 pontos × ${P.crashRepeticoes}`);
const c5 = await cenario5(join(workDir, 's5'), join(process.cwd(), 'dist', 'scripts', 'append-crash.js'), P.crashRepeticoes);
passo('S5', `sem fork sob SIGKILL (${c5.erro ?? 'sem erro'})`, c5.ok);

// ─── Veredito por critério de §31.26 ────────────────────────────────────────────────────

const criterios: Record<string, { veredito: Veredito; medido: string }> = {
  '1-determinismo-do-merge': {
    veredito: c1.ok && c2.ok ? 'aprovado' : 'reprovado',
    medido:
      `${c1.ordensDeEntrega} ordens de entrega + o nó que recebe os dois logs prontos → ${c1.hashes.length} hash de dump distinto(s); ` +
      `${c1.logs.lo}+${c1.logs.hi} registros, ${c1.aplicados} aplicados e ${c1.recusados} recusados; ordSum estável em todo prefixo: ${c1.ordSumEstavel}; ` +
      `inserção retroativa em 6 cadências de snapshot, do começo e do meio da história, converge para o mesmo hash: ${c2.convergiu}; ` +
      `a inserção no meio partiu de snapshot: ${c2.partiuDeSnapshot}; \`fold_build_id\` errado descarta e recomeça do zero: ${c2.buildIdErradoDescartaSnapshot}`,
  },
  '2-totalidade': {
    veredito: totalidadeOk ? 'aprovado' : 'reprovado',
    medido:
      `${fuzzer.registros.toLocaleString('pt-BR')} registros hostis (semente 0x${fuzzer.semente.toString(16)}), 12 sabotagens, ${fuzzer.lotes} lote(s) de ${fuzzer.registrosPorLote}, ${fuzzer.registrosPorSegundo.toLocaleString('pt-BR')} reg/s; ` +
      `dmFold.panic = ${fuzzer.panic}; desfecho fora de APPLIED/REJECTED/IGNORED = ${fuzzer.desfechoFora}; APPLIED = ${fuzzer.applied}; recusa sem código de §31.7.3 = ${fuzzer.semCodigo}; efeito em recusa = ${fuzzer.efeitoEmRecusa}`,
  },
  '3-convergencia-apos-particao': {
    veredito: c3.erro !== undefined ? 'nao-medido' : c3.ok ? 'aprovado' : 'reprovado',
    medido: c3.erro ?? `escrita concorrente dos dois lados em partição real (hyperdht/testnet); hash do nó A = hash do nó B = referência: ${c3.convergiu}; forks: ${c3.forks}`,
  },
  '4-core-encurtado-e-desynced': {
    veredito: c4.erro !== undefined ? 'nao-medido' : c4.ok ? 'aprovado' : 'reprovado',
    medido:
      c4.erro ??
      `core.length ${c4.deteccao.coreLengthAoReabrir} < self_high_water ${c4.deteccao.selfHighWater} → ${c4.deteccao.estado}, ` +
        `${c4.deteccao.appendsFeitosEmDesynced} append em desynced; append prematuro conflita em [${c4.appendPrematuro.ondeConflitou.join(', ')}]`,
  },
  '5-sem-fork-sob-sigkill': {
    veredito: c5.erro !== undefined ? 'nao-medido' : c5.ok ? 'aprovado' : 'reprovado',
    medido:
      c5.erro ??
      `${c5.mortes} SIGKILL em 4 pontos do caminho de append; forks: ${c5.forks}; desynced observado: ${c5.desyncedObservado}; ` +
        `o caminho de escrita se recusou a appendar em desynced ${c5.recusasDeAppend}×; appends após desynced: ${c5.appendsAposDesynced}; par convergiu: ${c5.parConvergiu}`,
  },
};

const achados = [
  {
    id: 'ACHADO-G14-01',
    titulo: 'a pergunta aberta de §31.13 tem resposta: o `hypercore@' + c4.recomposicao.hypercore + '` recompõe o próprio core do escritor a partir de um par, sem appendar',
    medido:
      `escritor com core.length ${c4.recomposicao.lengthAntes} e self_high_water ${c4.deteccao.selfHighWater} reconectado ao par: ` +
      `recompôs = ${c4.recomposicao.recompos}, length final = ${c4.recomposicao.lengthDepois}, blocos byte a byte iguais = ${c4.recomposicao.blocosConferem}, ` +
      `append posterior aceito = ${c4.recomposicao.appendDepoisFunciona}, par leu o bloco novo = ${c4.recomposicao.parLeuOBlocoNovo}, ` +
      `forks durante a recomposição = ${c4.recomposicao.forks}, custo = ${c4.recomposicao.ms} ms`,
    consequencia: c4.recomposicao.recompos && c4.recomposicao.blocosConferem && c4.recomposicao.appendDepoisFunciona
      ? 'a saída (1) de §31.13 — restauração por replicação — se sustenta neste ambiente. `desynced` NÃO é terminal e L-25 não ganha a segunda metade. A implementação continua condicionada a: recompor ANTES de qualquer append, e manter a barreira de `self_high_water`.'
      : 'a saída (1) de §31.13 NÃO se sustentou: `desynced` vira terminal, sobra o aceite explícito de perda e L-25 ganha a segunda metade.',
  },
  {
    id: 'ACHADO-G14-02',
    titulo: 'o contrafactual mede por que a barreira existe: appendar antes de recompor produz o bloco conflitante que §31.13 descreve',
    medido:
      `escritor com o mesmo prefixo curto appendou no índice ${P.corePerdidos} e conectou ao par que tinha o bloco original: ` +
      `conflito detectado = ${c4.appendPrematuro.conflitoDetectado} em [${c4.appendPrematuro.ondeConflitou.join(', ')}]; ` +
      `o par preservou o bloco original = ${c4.appendPrematuro.parPreservouOBlocoOriginal}`,
    consequencia:
      'o `hypercore` não mescla e não escolhe: as duas sessões fecham no conflito. É a evidência direta de que a ordem "grava `self_high_water`, compara, só então appenda" de §31.13 não é conservadorismo.',
  },
  {
    id: 'ACHADO-G14-03',
    titulo: 'o custo da reinterpretação por inserção retroativa é o do trecho, não o da conversa — desde que haja snapshot',
    medido:
      `inserção no COMEÇO da história (o log do par chega inteiro depois): parte de [${c2.doComeco.partiuDe.join(', ')}], ${c2.doComeco.registros} registros, ${c2.doComeco.ms} ms | ` +
      `inserção no MEIO: parte de [${c2.doMeio.partiuDe.join(', ')}], ${c2.doMeio.registros} registros, ${c2.doMeio.snapshotsDescartados} snapshot(s) descartado(s), ${c2.doMeio.ms} ms | ` +
      c2.hashPorSnapshotEvery
        .map((l) => `snapshotEvery=${l.snapshotEvery}: ${l.registros} registros reinterpretados, [${l.partiuDe.join(', ')}]`)
        .join(' | '),
    consequencia:
      'quando o ponto de inserção é o começo da conversa — o log do par chegando inteiro depois —, NÃO existe snapshot anterior a ele e a reinterpretação parte do zero por definição, com qualquer cadência. O snapshot só paga quando a inserção cai no meio da história, que é o caso corrente de uma conversa viva. Os dois convergem para o mesmo hash: o snapshot é custo, não semântica — o que §31.13 promete, e o que B56 precisa saber antes de escolher a cadência.',
  },
  {
    id: 'ACHADO-G14-04',
    titulo: 'reinterpretar do zero é super-linear: a cópia por container do `DmDraft` custa O(estado) por registro',
    medido:
      `log ×${custo.crescimentoDoLog} → ms/registro ×${custo.fatorComAck} (conversa viva, os dois lados reconhecendo): ` +
      custo.comAckDoPar.map((a) => `${a.registros} reg → ${a.ms} ms (${a.msPorRegistro} ms/reg, ${a.mensagensNoEstado} mensagens, janelas ${a.janelaLo}/${a.janelaHi})`).join('; ') +
      ` | um lado só, o par nunca reconhece: ` +
      custo.semAckDoPar.map((a) => `${a.registros} reg → ${a.ms} ms (${a.msPorRegistro} ms/reg, janela lo ${a.janelaLo})`).join('; ') +
      ` — fator ${custo.fatorSemAck}×`,
    consequencia:
      'não é desvio de §31.7.2 e não reprova critério nenhum de §31.26: a cópia-na-escrita por container é o arranjo que a própria seção escolhe, o mesmo do `fold` de §8. Duas leituras para B56. (a) O snapshot de `dm_ds_snapshot` não é otimização: é o que impede essa curva de aparecer no boot, e o cenário 2 mostra que ele muda custo e não semântica. (b) A janela de `ts` fica limitada enquanto o par reconhece (RD-4 poda), e passa a ser do tamanho do log quando o par nunca escreve — que é a conversa de uma pessoa só, e é normal. NÃO foi corrigido aqui: `core/` não se altera para um gate passar, e nada aqui reprovou.',
  },
  {
    id: 'ACHADO-G14-05',
    titulo: '`self_high_water` gravado ANTES do append deixa a conversa `desynced` depois de um crash em que nada se perdeu — e a saída (1) de §31.13 não tem de onde restaurar',
    medido:
      `nas ${c5.mortes} mortes, \`desynced\` apareceu ${c5.desyncedObservado}× e em ${c5.desyncedSemPerdaReal} delas o PAR também não tinha os blocos "faltantes" — ` +
      `porque eles nunca existiram: o \`self_high_water\` foi gravado para um append que morreu antes de acontecer (pontos \`entre\` e \`durante\`). ` +
      `O caminho de escrita se recusou a appendar ${c5.recusasDeAppend}× e nenhum fork nasceu (forks: ${c5.forks}).`,
    consequencia:
      'o critério 5 passa: a ordem de §31.13 é conservadora e nenhum fork existiu. O que o gate acrescenta é que ela é conservadora **demais** para este caso — um crash na janela entre a gravação e o append marca a conversa como perdida sem perda nenhuma, e a saída (1) (restauração por replicação, medida no cenário 4) não resolve, porque o bloco que "falta" nunca chegou a existir em lugar nenhum. É decisão de B57, não deste gate: ou o boot distingue `core.length === self_high_water − 1` sem par adiante (append pendente que não landou) de uma perda de verdade, ou o `self_high_water` passa a ser gravado de outra forma. Registrado, não decidido.',
  },
];

const openCriteria = [
  'Electron empacotado (matriz de A16): os cinco cenários rodaram em Node puro. `utilityProcess`, preload e o caminho IPC-R de §31.16 não estão neste harness — o gate mede o `dmFold` e o merge, e a integração é da fase 11.',
  'Queda de energia com `fsync` observado: `SIGKILL` mata o processo e não toca o page cache do SO. O cenário 5 mede falha de PROCESSO, que é o que §10.7.1 diz que `await core.append` cobre; a metade de energia é G4 e continua sem evidência (§31.10 já declara isso).',
  'A recomposição do critério 4 foi medida com o par ONLINE e com o prefixo perdido íntegro. Um par offline, ou um prefixo corrompido em vez de curto, não estão medidos — e o segundo não é `desynced`, é `forked` (§18.9), que este gate não exercita.',
  'A perda local foi reproduzida com um storage novo e a mesma `keyPair` (o prefixo é byte a byte o do par, porque Ed25519 é determinístico). Truncar um storage do RocksDB no meio de uma escrita é outra falha, e o `device-file` do próprio hypercore a recusa — fica para o gate empacotado.',
  '`dm_ds_snapshot`, `dm_messages` e as demais tabelas de §31.12 aqui são estruturas do harness, não `view.db`. O projetor real, a barreira `view.db` → `manifest.db` → eventos e o `dm.reordered` no fio são B56.',
  'A partição do cenário 3 é a queda do socket. Partição assimétrica (uma direção), NAT e relay são G5/G8 e não se repetem aqui.',
];

const t0 = Date.now();
const veredito: 'aprovado' | 'parcial' | 'invalidado' = passos.every((p) => p.ok)
  ? openCriteria.length > 0
    ? 'parcial'
    : 'aprovado'
  : 'invalidado';

mkdirSync(outDir, { recursive: true });
const artifact = {
  gate: 'G14',
  hypothesis:
    'O estado de uma conversa direta é uma função pura, total e determinística do PAR de logs de escritor único: dois nós que recebam os mesmos dois logs em ordens de replicação diferentes convergem para o mesmo estado, e nenhuma entrada — inclusive hostil — faz o `dmFold` lançar (A29, backend-v2 §31.26)',
  escopo:
    'o `dmFold` e o merge medidos são os do PRODUTO (`core/dist/src/l1/dmFold`, `core/dist/src/l1/dmCodec`, B54). O projetor de §31.12, o snapshot de `dm_ds_snapshot` e o `self_high_water` de `manifest.db` são versões DESCARTÁVEIS dentro do harness: são B56 e B57, e os dois estão bloqueados por este gate',
  cobertura: [
    'cenário 1: a mesma dupla de logs entregue em ordens de entrega permutadas — hash de dump do estado projetado idêntico entre todas, e `ordSum` de cada registro estável em todo prefixo do par',
    'cenário 2: inserção retroativa forçando a reinterpretação de §31.13 — descarte dos snapshots acima do ponto de inserção, recarga do anterior ou igual, reinterpretação até as duas cabeças e `dm.reordered{fromOrdSum}` depois do commit; `fold_build_id` que não bate descarta o snapshot e recomeça do zero (§10.6)',
    `cenário 3: partição real numa hyperdht/testnet, escrita concorrente dos dois lados e reconciliação sem intervenção, com dois nós e quatro cores de verdade`,
    'cenário 4: escritor que perdeu blocos do próprio core reabrindo com `core.length < self_high_water` — a detecção antes do append, a pergunta `REQUIRES POC` de §31.13 sobre recompor a partir do par, e o contrafactual do append prematuro',
    'cenário 5: `SIGKILL` em quatro pontos do caminho de append de §31.10 (antes do `self_high_water`, entre ele e o append, com o append em voo, e depois dele), com o par replicando a cada volta',
    `totalidade: ${P.fuzzer.toLocaleString('pt-BR')} registros hostis sobre o \`dmFold\` do produto, 12 sabotagens (uma por estágio de §31.7.3), PRNG determinístico`,
  ],
  openCriteria,
  profile,
  executedAt: new Date().toISOString(),
  host: hostname(),
  so: { platform: platform(), release: release(), arch: arch() },
  cpu: { model: cpus()[0]?.model ?? '<desconhecido>', cores: cpus().length },
  memGiB: Math.round((totalmem() / 1024 ** 3) * 10) / 10,
  runtime: { node: process.version, hypercore: versaoDe('hypercore'), hyperdht: versaoDe('hyperdht'), sodium: versaoDe('sodium-native') },
  lockfile: { file: 'package-lock.json', sha256: sha256(join(process.cwd(), 'package-lock.json')) },
  nucleoMedido: {
    dmFold: 'core/dist/src/l1/dmFold/index.js',
    dmCodec: 'core/dist/src/l1/dmCodec/index.js',
    caboDeEscrita: 'core/dist/test/helpers/dm.js',
  },
  scenarios: passos.map((s) => ({ name: `${s.id} — ${s.desc}`, ok: s.ok })),
  metrics: {
    cenario1: c1,
    cenario2: c2,
    totalidade: { ...fuzzer, bordas },
    custoDeReinterpretacao: custo,
    cenario3: c3,
    cenario4: c4,
    cenario5: c5,
  },
  criterios,
  achados,
  veredito,
  limitations: [
    'implementações deste harness são experimentais e descartáveis — decisões e achados se reaproveitam, código não',
    'o projetor, o snapshot e o `self_high_water` daqui não são os de §31.12/§31.13: são o mínimo para os cenários 2, 4 e 5 terem o que medir, e B56/B57 os constroem de verdade',
    'B66 e B67 (lacunas de especificação abertas por B54) NÃO são decididas aqui: o harness mede o efeito delas, não o texto normativo',
  ],
  duracaoMs: Date.now() - t0,
};

writeFileSync(join(outDir, 'gate-G14.json'), `${JSON.stringify(artifact, null, 2)}\n`);
console.log(`artefato: ${join(outDir, 'gate-G14.json')} — veredito: ${veredito}`);
for (const [nome, c] of Object.entries(criterios)) console.log(`  critério ${nome}: ${c.veredito}`);
if (veredito === 'invalidado') process.exitCode = 1;
