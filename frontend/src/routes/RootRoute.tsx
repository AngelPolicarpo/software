import { AppShell } from "../components/shell/AppShell";
import { OnboardingScreen } from "../features/onboarding/OnboardingScreen";
import { useIdentityStore } from "../store/identityStore";

/**
 * Rota `/` (§4) — resolve por estado, não por URL:
 * sem identidade → Onboarding (0.1);
 * com identidade e 0 comunidades → Hub vazio (0.2), dentro do shell;
 * com comunidade ativa salva → Shell (1.1) nela.
 */
export function RootRoute() {
  const identity = useIdentityStore((state) => state.identity);

  if (!identity) return <OnboardingScreen />;

  return <AppShell />;
}
