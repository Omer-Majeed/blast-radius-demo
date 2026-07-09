import type { Response } from 'express';

export function reply(res: Response, data: unknown): void {
  res.json(data);
}
