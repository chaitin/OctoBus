#!/usr/bin/env node
import { runServiceMain } from '@chaitin-ai/octobus-sdk';

import { service } from '../src/service.js';

await runServiceMain(service);
