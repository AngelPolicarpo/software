import { useEffect, useState } from "react";

/**
 * Breakpoint em JavaScript — usado só onde a diferença entre larguras é
 * **estrutural**, não de estilo: em Mobile a grade de voz vira lista
 * vertical compacta, ou carrossel horizontal acima de 4 participantes (§9,
 * 2.3), e isso muda o que é renderizado, não só como.
 *
 * Onde CSS resolve (esconder, reordenar, mudar largura), a regra segue sendo
 * classe `tablet:`/`desktop:` — este hook não é atalho para isso.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(
    () => window.matchMedia(query).matches,
  );

  useEffect(() => {
    const list = window.matchMedia(query);
    setMatches(list.matches);
    const handle = (event: MediaQueryListEvent) => setMatches(event.matches);
    list.addEventListener("change", handle);
    return () => list.removeEventListener("change", handle);
  }, [query]);

  return matches;
}

/** §16 — Mobile é o estado base, abaixo do breakpoint `tablet` (640px). */
export function useIsMobile(): boolean {
  return useMediaQuery("(max-width: 639.98px)");
}
