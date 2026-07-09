import { sha1 } from '@demo/hash-lib';

export function signRequest(payload: string): { payload: string; sig: string } {
  return { payload, sig: sha1(payload) };
}
