// Dois arquivos irmãos que diferem só em maiúsculas são o MESMO arquivo num filesystem
// que não distingue caso — o do Windows, que é metade da matriz do v1 (§1).
//
// O TypeScript recusa o programa inteiro nessa situação (`TS1261`), e o modo de falhar é o
// pior possível: invisível em Linux, verde no dev, vermelho só no CI do outro alvo. Foi
// assim que `ModoHistorico.tsx` e `modoHistorico.ts` quebraram o build de 2026-08-28.
//
// A colisão que importa é a do nome SEM extensão: é por ele que o TS resolve um import, e
// `./x` acha tanto `x.ts` quanto `X.tsx`.

import fs from 'node:fs';
import path from 'node:path';

const RAIZ = path.resolve(import.meta.dirname, '..', 'src');

function varrer(dir) {
  const porChaveMinuscula = new Map();
  const colisoes = [];
  for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
    const completo = path.join(dir, entrada.name);
    if (entrada.isDirectory()) {
      colisoes.push(...varrer(completo));
      continue;
    }
    if (!/\.(ts|tsx|mts|cts)$/.test(entrada.name)) continue;
    const chave = entrada.name.replace(/\.[^.]+$/, '').toLowerCase();
    const anterior = porChaveMinuscula.get(chave);
    if (anterior !== undefined) colisoes.push([anterior, completo]);
    else porChaveMinuscula.set(chave, completo);
  }
  return colisoes;
}

const colisoes = varrer(RAIZ);
if (colisoes.length > 0) {
  for (const [a, b] of colisoes) {
    console.error(`colisão de caixa: ${path.relative(RAIZ, a)}  <->  ${path.relative(RAIZ, b)}`);
  }
  console.error('\nOs nomes diferem só em maiúsculas: no Windows são o mesmo arquivo, e o `tsc` recusa (TS1261).');
  process.exit(1);
}
console.log(`caixa ok — nenhum par de módulos em src/ se distingue só por maiúsculas`);
