import express, { Request, Response } from 'express';
import { createHash } from 'crypto';

const app = express();

function computeSig(input: string): string {
  return createHash('md5').update(input).digest('hex');
}

app.get('/sig-json/:id', (req: Request, res: Response) => {
  res.json({ id: req.params.id, sig: computeSig(String(req.params.id)) });
});

app.get('/sig-plain/:id', (req: Request, res: Response) => {
  res.send(computeSig(String(req.params.id)));
});

app.listen(3000);
