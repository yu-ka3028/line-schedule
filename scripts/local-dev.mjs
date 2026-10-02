import { spawn } from 'node:child_process';
import process from 'node:process';

const child = spawn('npx', ['vercel', 'dev', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: process.env,
});

child.on('error', (error) => {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
  } else {
    process.exit(code ?? 1);
  }
});
