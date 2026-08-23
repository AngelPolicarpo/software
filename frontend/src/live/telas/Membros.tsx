/**
 * Roster e perfil — `query.members` e `query.member` (§15.6, §23.3).
 *
 * O agrupamento por cargo, a ordem alfabética dentro do grupo e a contagem agregada de
 * offline são do núcleo (§23.2/§23.3). A tela não reordena: repetir a ordenação aqui criaria
 * uma segunda definição de "quem vem antes".
 *
 * A presença tem duas fontes com papéis diferentes, e é de propósito: `query.members` traz a
 * do instante da consulta, e o mapa vivo de `comunidades.ts` (delta com TTL de 45 s) tem a
 * de agora. A tela prefere a viva quando existe. Em nenhum dos dois caminhos o valor
 * `offline` é escrito — ele não é publicado (§6.1), e ausência é que o significa.
 *
 * As affordances de moderação vêm decididas: `canKick`/`canBan`/`canTimeout`/`canSetRoles`
 * são resposta de `query.member`, calculadas sobre a hierarquia de §8.4.1. Recalcular aqui
 * seria escrever a regra de hierarquia uma segunda vez, fora do `fold`.
 */

import { useEffect, useState } from "react";
import { Button } from "../../components/ui/Button";
import { TextField } from "../../components/ui/TextField";
import { useComunidade } from "../comunidade";
import { useComunidades } from "../comunidades";
import { api } from "../../ipc/api";
import { Avatar, Nome, Vazio } from "./comuns";
import { corDe, dataHora, tamanho } from "./formato";
import { mensagemDeErro } from "../sessao";

export function Membros() {
  const roster = useComunidade((s) => s.roster);
  const carregarRoster = useComunidade((s) => s.carregarRoster);
  const abrirPerfil = useComunidade((s) => s.abrirPerfil);
  const presencaDe = useComunidades((s) => s.presencaDe);
  const [busca, setBusca] = useState("");

  useEffect(() => {
    void carregarRoster();
  }, [carregarRoster]);

  return (
    <div className="flex h-full flex-col">
      <div className="p-3">
        <TextField
          label="Procurar"
          value={busca}
          onChange={(v) => {
            setBusca(v);
            void carregarRoster({ query: v.length > 0 ? v : undefined });
          }}
        />
      </div>

      <div className="flex-1 overflow-y-auto px-3 pb-3">
        {roster === null ? (
          <Vazio>Carregando o roster…</Vazio>
        ) : (
          <>
            {roster.groups.map((g) => (
              <section key={g.roleId} className="mb-4">
                <h4 className="pb-1 text-caption uppercase" style={{ color: corDe(g.roleColor) }}>
                  {g.roleName} — {g.members.length}
                </h4>
                <ul>
                  {g.members.map((m) => (
                    <li key={m.key}>
                      <button
                        type="button"
                        onClick={() => void abrirPerfil(m.key)}
                        className="flex w-full items-center gap-2 rounded px-1 py-1 text-left hover:bg-surface-elevated"
                      >
                        <Avatar user={m} size={28} presence={presencaDe(m.key) ?? m.presence} />
                        <Nome user={m} className="min-w-0 flex-1 truncate text-meta text-text-secondary" />
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
            {/* §23.3 — offline é contagem agregada, nunca uma lista de nomes apagados. */}
            {roster.offlineCount > 0 && (
              <p className="text-caption text-text-tertiary">
                {roster.offlineCount} de {roster.total} sem presença publicada agora.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export function Perfil() {
  const perfil = useComunidade((s) => s.perfil);
  const fechar = useComunidade((s) => s.fecharPerfil);
  const cargos = useComunidade((s) => s.cargos);
  const carregarCargos = useComunidade((s) => s.carregarCargos);
  const communityId = useComunidades((s) => s.ativa);
  const presencaDe = useComunidades((s) => s.presencaDe);

  const [motivo, setMotivo] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [editandoCargos, setEditandoCargos] = useState(false);

  useEffect(() => {
    if (perfil !== null && cargos.length === 0) void carregarCargos();
  }, [perfil, cargos.length, carregarCargos]);

  if (perfil === null || communityId === null) return null;

  async function acao(fn: () => Promise<unknown>): Promise<void> {
    setOcupado(true);
    setErro(null);
    try {
      await fn();
      await useComunidade.getState().abrirPerfil(perfil!.key);
    } catch (e) {
      setErro(mensagemDeErro(e));
    } finally {
      setOcupado(false);
    }
  }

  const emTimeout = perfil.timeoutUntil !== undefined && perfil.timeoutUntil > Date.now();

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-surface-overlay-scrim p-6" onClick={fechar}>
      <div
        className="w-full max-w-md rounded-lg border border-border-subtle bg-surface-primary p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3">
          <Avatar user={perfil} size={56} presence={presencaDe(perfil.key) ?? perfil.presence} />
          <div className="min-w-0">
            <Nome user={perfil} className="block truncate text-h2 text-text-primary" />
            <p className="text-meta text-text-tertiary">{perfil.handle}</p>
          </div>
        </div>

        <dl className="mt-4 flex flex-col gap-1 text-meta">
          <div className="flex justify-between">
            <dt className="text-text-tertiary">Entrou em</dt>
            <dd className="text-text-secondary">{dataHora(perfil.joinedAt)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-text-tertiary">Anexos enviados</dt>
            <dd className="text-text-secondary">{tamanho(perfil.storageUsedBytes)}</dd>
          </div>
          {perfil.banned && (
            <div className="flex justify-between">
              <dt className="text-text-tertiary">Estado</dt>
              <dd className="text-feedback-danger">banida desta comunidade</dd>
            </div>
          )}
          {emTimeout && (
            <div className="flex justify-between">
              <dt className="text-text-tertiary">Silenciada até</dt>
              <dd className="text-feedback-warning">{dataHora(perfil.timeoutUntil!)}</dd>
            </div>
          )}
        </dl>

        <div className="mt-4 flex flex-wrap gap-1">
          {perfil.roles.map((r) => (
            <span
              key={r.id}
              className="rounded-full border px-2 py-0.5 text-caption"
              style={{ borderColor: corDe(r.color), color: corDe(r.color) }}
            >
              {r.name}
            </span>
          ))}
        </div>

        {perfil.canSetRoles && (
          <div className="mt-4">
            <Button size="sm" variant="secondary" onClick={() => setEditandoCargos((v) => !v)}>
              {editandoCargos ? "Fechar cargos" : "Editar cargos"}
            </Button>
            {editandoCargos && (
              <ul className="mt-2 flex flex-col gap-1">
                {cargos.map((c) => {
                  const tem = perfil.roleIds.includes(c.id);
                  return (
                    <li key={c.id}>
                      <label className="flex items-center gap-2 text-meta text-text-secondary">
                        <input
                          type="checkbox"
                          checked={tem}
                          disabled={c.isFounder || c.isDefault || ocupado}
                          onChange={() =>
                            void acao(() =>
                              api.memberSetRoles({
                                communityId,
                                targetKey: perfil.key,
                                roleIds: tem ? perfil.roleIds.filter((x) => x !== c.id) : [...perfil.roleIds, c.id],
                              }),
                            )
                          }
                        />
                        <span style={{ color: corDe(c.color) }}>{c.name}</span>
                        {(c.isFounder || c.isDefault) && (
                          <span className="text-caption text-text-tertiary">
                            {c.isFounder ? "fundador — imutável" : "cargo base — de todo membro"}
                          </span>
                        )}
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}

        {perfil.canModerate && (
          <div className="mt-4 border-t border-border-subtle pt-4">
            <TextField label="Motivo (opcional)" value={motivo} onChange={setMotivo} />
            <div className="mt-2 flex flex-wrap gap-2">
              {perfil.canTimeout &&
                (emTimeout ? (
                  <Button size="sm" variant="secondary" loading={ocupado} onClick={() => void acao(() => api.modRemoveTimeout({ communityId, targetKey: perfil.key }))}>
                    Remover silenciamento
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="secondary"
                    loading={ocupado}
                    onClick={() =>
                      void acao(() =>
                        api.modTimeout({
                          communityId,
                          targetKey: perfil.key,
                          until: Date.now() + 60 * 60 * 1000,
                          ...(motivo.length > 0 ? { reason: motivo } : {}),
                        }),
                      )
                    }
                  >
                    Silenciar por 1 h
                  </Button>
                ))}
              {perfil.canKick && (
                <Button
                  size="sm"
                  variant="secondary"
                  loading={ocupado}
                  onClick={() => void acao(() => api.modKick({ communityId, targetKey: perfil.key, ...(motivo.length > 0 ? { reason: motivo } : {}) }))}
                >
                  Expulsar
                </Button>
              )}
              {perfil.canBan &&
                (perfil.banned ? (
                  <Button size="sm" variant="secondary" loading={ocupado} onClick={() => void acao(() => api.modRevokeBan({ communityId, targetKey: perfil.key }))}>
                    Revogar banimento
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="danger"
                    loading={ocupado}
                    onClick={() => void acao(() => api.modBan({ communityId, targetKey: perfil.key, ...(motivo.length > 0 ? { reason: motivo } : {}) }))}
                  >
                    Banir
                  </Button>
                ))}
            </div>
            <p className="mt-2 text-caption text-text-tertiary">
              Banir oculta as mensagens da pessoa da interface e revoga os convites que ela criou. O
              registro continua no log da comunidade.
            </p>
          </div>
        )}

        {erro !== null && <p className="mt-3 text-meta text-feedback-danger">{erro}</p>}

        <div className="mt-4 flex justify-end">
          <Button variant="ghost" onClick={fechar}>
            Fechar
          </Button>
        </div>
      </div>
    </div>
  );
}
