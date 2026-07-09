import express, { Request, Response } from 'express';
import { createHash } from 'crypto';

const app = express();

function computeSig(input: string): string {
  return createHash('md5').update(input).digest('hex');
}

function handler(req: Request, res: Response): void {
  const id = String(req.params.id);
  const sig = computeSig(id);
  res.json({ id, sig });
}

app.get('/user/:id', handler);

app.listen(3000);
