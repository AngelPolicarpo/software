import { OnboardingScreen } from "../features/onboarding/OnboardingScreen";
import { ShellPlaceholder } from "./ShellPlaceholder";
import { useIdentityStore } from "../store/identityStore";

/**
 * Rota `/` (§4) — resolve por estado, não por URL:
 * sem identidade → Onboarding (0.1);
 * com identidade e 0 comunidades → Hub vazio (0.2);
 * com comunidade ativa salva → Shell (1.1) nela.
 *
 * Os dois últimos casos ainda caem no placeholder abaixo, que sai quando
 * o shell for implementado.
 */
export function RootRoute() {
  const identity = useIdentityStore((state) => state.identity);

  if (!identity) return <OnboardingScreen />;

  return <ShellPlaceholder />;
}
