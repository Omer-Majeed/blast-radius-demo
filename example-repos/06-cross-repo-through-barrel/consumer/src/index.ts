import express, { Request, Response } from 'express';
import { md5 } from '@demo/barrel-lib';

const app = express();

app.get('/user/:id', (req: Request, res: Response) => {
  res.json({ id: req.params.id, sig: md5(String(req.params.id)) });
});

app.listen(3000);
