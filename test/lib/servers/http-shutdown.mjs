export function installHttpShutdown(app, mcpServer, getHttpServer, name) {
  let shutdownPromise;
  const shutdown = () => {
    shutdownPromise ??= (async () => {
      const failures = [];
      try {
        await mcpServer.close();
      } catch (error) {
        failures.push(error);
      }
      try {
        await new Promise((resolve, reject) => {
          getHttpServer().close((error) => {
            if (error) reject(error);
            else resolve();
          });
        });
      } catch (error) {
        failures.push(error);
      }
      if (failures.length > 0) throw new AggregateError(failures, `${name} failed to close all HTTP resources`);
    })();
    return shutdownPromise;
  };
  const reportFailure = (error) => {
    console.error(`[${name}] shutdown failed:`, error);
    process.exitCode = 1;
  };

  app.post('/__mcpz/shutdown', (_request, response) => {
    response.status(202).end('stopping', () => {
      void shutdown().catch(reportFailure);
    });
  });

  return () => {
    void shutdown().catch(reportFailure);
  };
}
