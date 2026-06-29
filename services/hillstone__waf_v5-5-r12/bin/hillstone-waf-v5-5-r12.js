#!/usr/bin/env node

const sdk = require('@chaitin-ai/octobus-sdk');
const { service } = require('../src/service.js');

sdk.runServiceMain(service);
