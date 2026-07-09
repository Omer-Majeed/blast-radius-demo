import express, { Request, Response } from 'express';
import { createHash } from 'crypto';

const app = express();

function debugTraceId(input: string): string {
  return createHash('md5').update(input).digest('hex');
}

app.get('/user/:id', (req: Request, res: Response) => {
  const id = String(req.params.id);
  const traceId = debugTraceId(id);
  console.log('trace', traceId);
  res.json({ id, ok: true });
});

app.listen(3000);
