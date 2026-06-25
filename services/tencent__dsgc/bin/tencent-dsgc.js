#!/usr/bin/env node

import { fileURLToPath } from 'node:url';
import { runServiceMain } from '@chaitin-ai/octobus-sdk';

import { service } from '../src/service.js';

await runServiceMain(service, {
  entryFile: fileURLToPath(import.meta.url),
});
