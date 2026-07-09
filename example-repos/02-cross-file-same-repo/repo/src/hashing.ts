import { createHash } from 'crypto';

export function computeSig(input: string): string {
  return createHash('md5').update(input).digest('hex');
}
