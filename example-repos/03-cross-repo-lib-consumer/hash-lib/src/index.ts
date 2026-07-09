import { createHash } from 'crypto';

export function computeSig(input: string): string {
  return createHash('sha1').update(input).digest('hex');
}
