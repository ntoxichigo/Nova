import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const rootDir = process.cwd();
const zscriptsDir = path.join(rootDir, '.zscripts');
const miniServicesDir = path.join(rootDir, 'mini-services');
const isWindows = process.platform === 'win32';
const npmCmd = isWindows ? 'npm.cmd' : 'npm';

const args = new Set(process.argv.slice(2));
const skipInstall = args.has('--skip-install');
const withMiniServices = args.has('--with-mini-services');

const children = [];
let shuttingDown = false;

function log(msg) {
  const stamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
  process.stdout.write(`[${stamp}] ${msg}\n`);
}

function runStep(label, cmd, cmdArgs, options = {}) {
  return new Promise((resolve, reject) => {
    log(`Starting: ${label}`);
    const started = Date.now();
    const child = spawn(cmd, cmdArgs, {
      cwd: rootDir,
      env: process.env,
      stdio: 'inherit',
      shell: false,
      ...options,
    });

    child.on('error', reject);
    child.on('exit', (code) => {
      const seconds = ((Date.now() - started) / 1000).toFixed(1);
      if (code === 0) {
        log(`Completed: ${label} (${seconds}s)`);
        resolve();
        return;
      }
      reject(new Error(`${label} failed with exit code ${code}`));
    });
  });
}

async function discoverMiniServices() {
  try {
    const entries = await fsp.readdir(miniServicesDir, { withFileTypes: true });
    const services = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const serviceDir = path.join(miniServicesDir, entry.name);
      const pkgPath = path.join(serviceDir, 'package.json');
      if (!fs.existsSync(pkgPath)) continue;

      try {
        const pkgRaw = await fsp.readFile(pkgPath, 'utf8');
        const pkg = JSON.parse(pkgRaw);
        if (pkg?.scripts?.dev) {
          services.push({ name: entry.name, dir: serviceDir });
        }
      } catch {
        // ignore malformed package.json
      }
    }
    return services;
  } catch {
    return [];
  }
}

function startMiniService(service) {
  const logPath = path.join(zscriptsDir, `mini-service-${service.name}.log`);
  const stream = fs.createWriteStream(logPath, { flags: 'a' });
  stream.write(`\n=== ${new Date().toISOString()} starting ${service.name} ===\n`);

  const child = spawn(npmCmd, ['run', 'dev'], {
    cwd: service.dir,
    env: process.env,
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout?.pipe(stream);
  child.stderr?.pipe(stream);
  children.push({ child, name: `mini:${service.name}` });
  log(`Mini-service started: ${service.name} (PID ${child.pid}) log=${logPath}`);

  child.on('exit', (code) => {
    if (shuttingDown) return;
    log(`Mini-service exited: ${service.name} (code ${code ?? 'unknown'})`);
  });
}

function stopChild(name, child) {
  if (!child || child.killed) return;
  try {
    if (isWindows && typeof child.pid === 'number') {
      spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      return;
    }
    child.kill('SIGTERM');
  } catch {
    // ignore cleanup errors
  }
}

function setupCleanup() {
  const cleanup = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    log('Stopping child processes...');
    for (const entry of children) {
      stopChild(entry.name, entry.child);
    }
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}

async function ensureDirs() {
  await fsp.mkdir(zscriptsDir, { recursive: true });
}

async function main() {
  setupCleanup();
  await ensureDirs();

  if (!skipInstall) {
    await runStep('Install dependencies', npmCmd, ['install']);
  } else {
    log('Skipping dependency install (--skip-install)');
  }

  await runStep('Database sync', npmCmd, ['run', 'db:push']);

  if (withMiniServices) {
    const services = await discoverMiniServices();
    if (services.length === 0) {
      log('No mini-services with a dev script were found.');
    } else {
      log(`Starting ${services.length} mini-service(s)...`);
      for (const service of services) {
        startMiniService(service);
      }
    }
  } else {
    log('Mini-services disabled (add --with-mini-services to enable).');
  }

  const devChild = spawn(npmCmd, ['run', 'dev'], {
    cwd: rootDir,
    env: process.env,
    stdio: 'inherit',
    shell: false,
  });
  children.push({ child: devChild, name: 'next-dev' });
  log(`Next.js dev server started (PID ${devChild.pid}).`);

  await new Promise((resolve, reject) => {
    devChild.on('error', reject);
    devChild.on('exit', (code) => {
      if (!shuttingDown) {
        log(`Next.js dev server exited with code ${code ?? 'unknown'}.`);
      }
      resolve();
    });
  });

  shuttingDown = true;
  for (const entry of children) {
    if (entry.child !== devChild) {
      stopChild(entry.name, entry.child);
    }
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  log(`Fatal: ${message}`);
  process.exit(1);
});
