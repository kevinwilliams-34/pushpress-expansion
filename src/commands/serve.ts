/**
 * serve command — starts the webhook HTTP server + daily scheduled scan.
 */

import chalk from 'chalk';
import { createServer } from '../server';
import { runScan } from './scan';

export interface ServeOptions {
  port?: number;
  token?: string;
  noScheduler?: boolean;
}

const SCAN_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

async function runScheduledScan(): Promise<void> {
  const now = new Date().toLocaleString();
  console.log(chalk.dim(`\n  [scheduler] ${now} — starting daily scan (last 25h)...`));
  try {
    const result = await runScan({ since: '25h', output: 'slack', trigger: 'scheduled' });
    console.log(chalk.dim(`  [scheduler] scan complete — ${result.found} signal(s) found, ${result.skipped} skipped.`));
  } catch (err) {
    console.error(chalk.red(`  [scheduler] scan failed: ${(err as Error).message}`));
  }
}

export function runServe(options: ServeOptions = {}): void {
  const port = options.port ?? parseInt(process.env.PORT ?? '3000', 10);
  const secret = options.token ?? process.env.WEBHOOK_SECRET ?? undefined;

  const server = createServer(secret);

  server.listen(port, () => {
    console.log(chalk.bold('\n🚀 PushPress Expansion Intelligence — Webhook Server'));
    console.log(`  Listening on ${chalk.cyan(`http://localhost:${port}`)}`);
    console.log(`  Auth:         ${secret ? chalk.green('enabled (x-webhook-secret)') : chalk.yellow('disabled (set WEBHOOK_SECRET to enable)')}`);
    console.log('');
    console.log('  Endpoints:');
    console.log(`    ${chalk.dim('POST')} /webhook/conversation-created`);
    console.log(`    ${chalk.dim('POST')} /webhook/conversation-replied`);
    console.log(`    ${chalk.dim('GET')}  /health`);
    console.log(`    ${chalk.dim('GET')}  /signals`);
    console.log(`    ${chalk.dim('GET')}  /signals/:id`);
    console.log('');
    console.log(chalk.dim('  Make webhook payload:'));
    console.log(chalk.dim('  { "conversation_id": "...", "contact_id": "..." }'));
    console.log('');

    if (!options.noScheduler) {
      console.log(chalk.dim(`  [scheduler] daily scan enabled — runs every 24h`));
      console.log('');
      // Run first scan 5 minutes after startup (let server settle), then every 24h
      setTimeout(() => {
        void runScheduledScan();
        setInterval(() => void runScheduledScan(), SCAN_INTERVAL_MS);
      }, 5 * 60 * 1000);
    }
  });

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(chalk.red(`  Port ${port} is already in use. Try --port <other>`));
    } else {
      console.error(chalk.red(`  Server error: ${err.message}`));
    }
    process.exit(1);
  });

  // Log incoming webhook requests
  const originalListen = server.listeners('request');
  server.on('request', (req) => {
    if (req.method === 'POST') {
      console.log(chalk.dim(`  ${new Date().toLocaleTimeString()} ${req.method} ${req.url}`));
    }
  });
  void originalListen; // suppress unused warning
}
