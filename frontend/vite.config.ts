import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  // O renderer é carregado por `loadFile` a partir de `frontend/dist/index.html` (§3.1):
  // em `file://` os caminhos absolutos do default (`/assets/...`) apontam para a raiz do
  // disco. Base relativa é o que faz o bundle carregar dentro do shell.
  base: './',
  plugins: [react(), tailwindcss()],
})
