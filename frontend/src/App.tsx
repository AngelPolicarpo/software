import { MemoryRouter, Navigate, Route, Routes } from "react-router-dom";
import { ToastViewport } from "./components/ui/Toast";
import { DevBar } from "./features/dev/DevBar";
import { RootRoute } from "./routes/RootRoute";
import { InviteRoute } from "./routes/InviteRoute";
import { MessageRoute } from "./routes/MessageRoute";
import { Sincronizador } from "./live/Sincronizador";

/**
 * Três rotas reais, resto é estado (§4).
 *
 * Comunidade/canal selecionado, painéis, modais e sessão de voz ficam fora
 * do router, em Zustand — nada disso é recurso endereçável por servidor.
 *
 * `MemoryRouter` porque o produto é Electron carregado por `file://` (§3.1):
 * não há barra de endereço, e `BrowserRouter` sobre `file://` não resolve as
 * rotas. A tabela é a mesma — era exatamente a troca que o mock previa.
 * Deep links chegam como evento do main (§3.5), nunca como URL.
 */
function App() {
  return (
    <MemoryRouter>
      <Sincronizador>
        <Routes>
          <Route path="/" element={<RootRoute />} />
          <Route path="/invite/:code" element={<InviteRoute />} />
          <Route path="/m/:code" element={<MessageRoute />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>

        {/* Fora das rotas: toasts e afinador de dev sobrevivem à navegação. */}
        <ToastViewport />
        <DevBar />
      </Sincronizador>
    </MemoryRouter>
  );
}

export default App;
