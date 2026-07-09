import express, { Request, Response } from 'express';
import { createHash } from 'crypto';

const app = express();

async function computeSigAsync(input: string): Promise<string> {
  await new Promise((r) => setTimeout(r, 0));
  return createHash('md5').update(input).digest('hex');
}

app.get('/user/:id', async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const sig = await computeSigAsync(id);
  res.json({ id, sig });
});

app.listen(3000);
