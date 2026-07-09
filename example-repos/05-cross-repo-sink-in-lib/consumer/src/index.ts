import express, { Request, Response } from 'express';
import { createHash } from 'crypto';
import { reply } from '@demo/response-lib';

const app = express();

app.get('/user/:id', (req: Request, res: Response) => {
  const sig = createHash('md5').update(String(req.params.id)).digest('hex');
  reply(res, { id: req.params.id, sig });
});

app.listen(3000);
