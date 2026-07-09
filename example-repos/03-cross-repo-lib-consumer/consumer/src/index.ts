import express, { Request, Response } from 'express';
import { computeSig } from '@demo/hash-lib';

const app = express();

app.get('/user/:id', (req: Request, res: Response) => {
  res.json({ id: req.params.id, sig: computeSig(String(req.params.id)) });
});

app.listen(3000);
