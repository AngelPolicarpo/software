import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { ToastViewport } from "./components/ui/Toast";
import { DevBar } from "./features/dev/DevBar";
import { RootRoute } from "./routes/RootRoute";
import { InviteRoute } from "./routes/InviteRoute";

/**
 * Duas rotas reais, resto é estado (§4).
 *
 * Comunidade/canal selecionado, painéis, modais e sessão de voz ficam fora
 * do router, em Zustand — nada disso é recurso endereçável por servidor.
 *
 * `BrowserRouter` aqui; quando o backend real exigir empacotamento
 * (Electron/Tauri/Bare, premissa 1), esta mesma tabela de rotas roda em
 * `MemoryRouter` sem reescrita.
 */
function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<RootRoute />} />
        <Route path="/invite/:code" element={<InviteRoute />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>

      {/* Fora das rotas: toasts e afinador de dev sobrevivem à navegação. */}
      <ToastViewport />
      <DevBar />
    </BrowserRouter>
  );
}

export default App;
