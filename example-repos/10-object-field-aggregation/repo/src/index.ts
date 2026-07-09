import express, { Request, Response } from 'express';
import { createHash } from 'crypto';

const app = express();

interface Signed {
  user: string;
  sig: string;
}

function pack(user: string): Signed {
  return {
    user,
    sig: createHash('md5').update(user).digest('hex'),
  };
}

app.get('/user/:id', (req: Request, res: Response) => {
  const { user, sig } = pack(String(req.params.id));
  res.json({ user, sig });
});

app.listen(3000);
