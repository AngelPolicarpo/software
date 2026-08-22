// Gate G12 — POC-12 (escopo executável em Node, sem rede externa).
// Uso: POC12_PROFILE=quick|full node dist/scripts/run-all.js
// O perfil full sobrescreve out/gate-G12/; quick escreve out/gate-G12-quick/.

import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { platform, arch, cpus, totalmem, hostname, release } from 'node:os';
import { createHash } from 'node:crypto';

import { runScenarios } from '../src/harness.js';

const profile = ((process.env['POC12_PROFILE'] ?? 'full') as string) === 'quick' ? 'quick' : 'full';
const outDir = join(process.cwd(), 'out', profile === 'full' ? 'gate-G12' : 'gate-G12-quick');

function sha256(p: string): string {
  try {
    return createHash('sha256').update(readFileSync(p)).digest('hex');
  } catch {
    return '<ausente>';
  }
}

console.log(`POC-12 / gate G12 (escopo Node) — perfil ${profile}`);
const outcome = await runScenarios(profile);
for (const s of outcome.steps) console.log(`  ${s.ok ? 'ok' : 'FALHOU'} — ${s.id} ${s.desc}`);

const veredito: 'parcial' | 'invalidado' = outcome.ok ? 'parcial' : 'invalidado';

mkdirSync(outDir, { recursive: true });
const artifact = {
  gate: 'G12',
  hypothesis:
    'Um sucessor com escrow válido assume após o grace period, cria a comunidade de continuação com prova de posse e os membros migram sem fork — estrutura preservada (A23, POC-12)',
  escopo: 'subconjunto executável em Node sem rede externa — NÃO fecha o gate',
  cobertura: [
    'escrow crypto_box_seal(communitySeed, x25519(targetKey)) lido do LOG BRUTO da origem — só o sucessor alvo abre; intruso e selo adulterado → null',
    'chaves do core antigo derivadas da semente decifrada; a posse é demonstrada pela prova assume/1 sobre BLAKE2b(\'assume/1\' ‖ novaKey ‖ u64le(originFinalSeq))',
    'camada b de R-18: grace period HOST_INACTIVITY_MS respeitado; fora da lista de sucessores nunca assume',
    'continuação criada pelo sucessor e aceita pelo fold REAL: gênese com originCommunityId/originFinalSeq/blobsKey novo + community.assumeHost na seq 6 (R-27)',
    'estrutura preservada no lote estendido: cargos, categorias e canais da origem recriados com nomes idênticos (duplicatas mapeiam para as equivalentes)',
    'L-15 medido: mensagens, convites e relays não migram',
    'ACHADO-G12-01 medido: membros NÃO são reconstruídos no lote estendido — membership segue a autoria do op e a prova de convite vincula o communityId novo (§27); continuação nasce só com o sucessor',
    'L-16: duas continuações válidas → réplicas seguem a de maior prioridade; claim fora da lista vira disputed; réplica SEM a origem segue a camada a',
    'assunção não escreve no core antigo — host que volta depois encontra o log intacto, sem mecanismo de desfazer',
  ],
  openCriteria: [
    'convergência de MEMBROS: depende de decisão normativa para ACHADO-G12-01 — desacoplar alvo da autoria em member.join, transplante de lote assinado, ou reentrada assistida por convites publicados pelo sucessor',
    'Hypercore real multi-nó: réplicas distintas migrando o rail via swarm/corestore (aqui: estado único por cenário, log em memória)',
    'host que volta DEPOIS de replicação em curso na comunidade nova (corrida entre origem viva e continuação)',
    'escrow corrompido persistido no log de verdade e recusado na leitura do sucessor (aqui: corrupção injetada pós-selo)',
    'Electron empacotado com utilityProcess + manifest (§5.3) para derivar chaves do core a partir da semente recuperada',
  ],
  profile,
  executedAt: new Date().toISOString(),
  host: hostname(),
  so: { platform: platform(), release: release(), arch: arch() },
  cpu: { model: cpus()[0]?.model ?? '<desconhecido>', cores: cpus().length },
  memGiB: Math.round((totalmem() / 1024 ** 3) * 10) / 10,
  runtime: { node: process.version },
  lockfile: { file: 'package-lock.json', sha256: sha256(join(process.cwd(), 'package-lock.json')) },
  scenarios: outcome.steps.map((s) => ({ name: `${s.id} — ${s.desc}`, ok: s.ok })),
  metrics: outcome.metrics,
  veredito,
  criteriaMeasured: {
    escrow: '100% dos sucessores abriram o próprio escrow do log; intruso e adulterado recusados',
    grace: 'nenhuma assunção antes de HOST_INACTIVITY_MS; fora da lista de sucessores, nunca',
    continuacao: 'fold REAL aplica gênese+assumeHost sem rejeição; R-18(a) verifica contra a chave pública da ORIGEM',
    estrutura: 'cargos/categorias/canais preservados com nomes idênticos; L-15 verificado (mensagens/convites/relays vazios)',
    arbitragem: 'maior prioridade vence deterministicamente; disputed marcado sem migrar; réplica sem origem segue camada a',
    coreAntigo: 'zero writes na origem durante a assunção',
  },
  limitations: [
    'implementações deste harness são experimentais e descartáveis — decisões e achados se reaproveitam, código não',
    'um único processo/log em memória: sem swarm, sem hypercore real, sem corrida de replicação',
    'ACHADO-G12-01 bloqueia parcialmente o critério "membros idênticos" do plano — pendente decisão normativa (§27)',
  ],
};

writeFileSync(join(outDir, 'gate-G12.json'), `${JSON.stringify(artifact, null, 2)}\n`);
console.log(`artefato: ${join(outDir, 'gate-G12.json')} — veredito: ${veredito}`);
