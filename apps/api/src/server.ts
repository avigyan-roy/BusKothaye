import { createApp } from './app.js';
import { ConfigError, describeConfig, loadConfig } from './config.js';
import { createLogger } from './observability/logger.js';
import { RouteRegistry } from './routes/route-registry.js';
import { createRepository } from './store/index.js';

/**
 * Process entry point: validate configuration, load route data, bind the port,
 * and shut down cleanly. Everything that could fail does so here, loudly, before
 * the port opens — a container that accepts requests it cannot serve is worse
 * than one that refuses to start.
 */

async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      // Print the problems, never the environment that caused them.
      process.stderr.write(`${error.message}:\n`);
      for (const problem of error.problems) process.stderr.write(`  - ${problem}\n`);
      process.exit(1);
    }
    throw error;
  }

  const logger = createLogger(config.logLevel);
  const registry = await RouteRegistry.load(config.routeDataDir);
  const repo = createRepository(config);
  registry.applyOverrides(await repo.listRouteOverrides());
  const { app, accounts } = createApp({ config, repo, registry, logger });
  // Bootstrap before listening so a half-configured deployment never exposes a
  // demo console that nobody can administer.
  await accounts.ensureAdminAccount(config.adminUsername, config.adminPassword);

  const server = app.listen(config.port, '0.0.0.0', () => {
    logger.info('api listening', { config: describeConfig(config) });
  });

  // App Runner replaces instances on deployment; finishing in-flight requests
  // before exiting is what keeps a release from dropping a contributor's upload.
  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('shutting down', { signal });
    server.close(() => {
      void repo.close().finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((error: unknown) => {
  process.stderr.write(
    `Failed to start: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
});
