#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";
import { Command } from "commander";

const services = {
  "huawei-ccm": {
    entryFile: "../huawei__ccm/bin/huawei-ccm.js",
    serviceModule: "../huawei__ccm/src/service.js",
  },
};

const serviceNames = Object.keys(services);

const program = new Command();

program
  .name("octobus-tentacles")
  .usage("<service> [args]")
  .description("Run a service from this package")
  .argument("[service]", "service name")
  .allowUnknownOption(true)
  .allowExcessArguments(true)
  .passThroughOptions()
  .addHelpText("after", `
Services:
${serviceNames.map((name) => `  ${name.padEnd(37)}`).join("\n")}

Use 'octobus-tentacles <service> --help' to print service help.`)
  .action(async (serviceName) => {
    if (!serviceName) {
      program.outputHelp();
      return;
    }

    const selected = services[serviceName];
    if (!selected) {
      process.stderr.write(`Unknown service: ${serviceName}\n\n`);
      program.outputHelp({ error: true });
      process.exitCode = 1;
      return;
    }

    const { service } = await import(new URL(selected.serviceModule, import.meta.url));

    await runServiceMain(service, {
      argv: program.args.slice(1),
      entryFile: fileURLToPath(new URL(selected.entryFile, import.meta.url)),
    });
  });

await program.parseAsync();
