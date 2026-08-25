// Monta os recursos que o pacote leva DENTRO do app.asar (§3.1):
//   dist/renderer/**  ← frontend/dist   (o main procura ../renderer/index.html)
//   dist/core/**      ← core/dist       (o utility procura ../core)
// Rodar depois dos builds do frontend e do core; quem chama é o script `dist`.
import { cpSync, existsSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const raizApp = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function copiar(de, para, rotulo) {
  const origem = path.resolve(raizApp, de);
  const destino = path.resolve(raizApp, para);
  if (!existsSync(origem)) {
    console.error(`[montar] ${rotulo}: origem ausente — ${origem}`);
    process.exit(1);
  }
  rmSync(destino, { recursive: true, force: true });
  cpSync(origem, destino, { recursive: true });
  const mb = (statSync(destino).size / 1024 / 1024).toFixed(1);
  console.log(`[montar] ${rotulo}: ${para} (${mb} MB)`);
}

copiar("../frontend/dist", "dist/renderer", "renderer");
copiar("../core/dist", "dist/core", "core");
