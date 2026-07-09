import express, { Request, Response } from 'express';
import { signRequest } from '@demo/hash-middleware';

const app = express();

app.post('/sign', (req: Request, res: Response) => {
  const data = String((req.body ?? {}).data ?? '');
  res.json(signRequest(data));
});

app.listen(3000);
