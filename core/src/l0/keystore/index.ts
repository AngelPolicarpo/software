// `keystore` — L0, ponte IPC-M para wrap/unwrap da Data Key (§4, §3.2, §5.4, A13).
//
// §4: não depende de ninguém.
// §4: NUNCA vê a chave de identidade — apenas embrulha/desembrulha a Data Key simétrica.

export interface KeystoreOracle {
  wrapDataKey(dataKeyB64: string): Promise<string>;
  unwrapDataKey(wrappedB64: string): Promise<string>;
}

export class FallbackKeystoreOracle implements KeystoreOracle {
  status: 'insecure-fallback' = 'insecure-fallback';

  async wrapDataKey(dataKeyB64: string): Promise<string> {
    // Modo fallback/inseguro quando não há secret store (§3.2 L-2)
    return Buffer.from(`insecure:${dataKeyB64}`, 'utf8').toString('base64');
  }

  async unwrapDataKey(wrappedB64: string): Promise<string> {
    const raw = Buffer.from(wrappedB64, 'base64').toString('utf8');
    if (!raw.startsWith('insecure:')) {
      throw new Error('Formato de fallback inválido');
    }
    return raw.slice('insecure:'.length);
  }
}
