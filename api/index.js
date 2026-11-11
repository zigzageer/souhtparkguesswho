import { readFile } from 'node:fs/promises';
import { createServerlessApi } from '../lib/serverless-api.js';
const catalog = JSON.parse(await readFile(new URL('../public/data/characters.json', import.meta.url), 'utf8'));
export default createServerlessApi(catalog);
