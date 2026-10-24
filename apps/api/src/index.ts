import 'dotenv/config';
import { createApp } from './app.js';

const app = createApp();
const port = Number(process.env.PORT ?? 3001);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535');
}

app.listen(port, () => {
  console.log(`ADAPT API listening on http://localhost:${port}`);
});
