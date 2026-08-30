import { defineConfig } from "vite";

// Build SEPARADO do driver do smoke de voz (B45) — nada disto vai para o pacote do
// produto. Um único HTML que embute a MalhaDeVoz real e o cliente IPC-R real; o smoke
// do app o carrega por `loadFile` em cada uma das duas janelas.
export default defineConfig({
  base: "./",
  build: {
    outDir: "dist-smoke-voz",
    emptyOutDir: true,
    rollupOptions: {
      input: "src/smoke-voz/index.html",
    },
  },
});
