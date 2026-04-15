import chalk from 'chalk';
import boxen from 'boxen';
import ora, { type Ora } from 'ora';

// ── Color palette ─────────────────────────────────────────────────────────────
export const C = {
  primary:   (s: string) => chalk.hex('#7C3AED')(s),
  secondary: (s: string) => chalk.hex('#06B6D4')(s),
  success:   (s: string) => chalk.hex('#10B981')(s),
  warning:   (s: string) => chalk.hex('#F59E0B')(s),
  error:     (s: string) => chalk.hex('#EF4444')(s),
  muted:     (s: string) => chalk.hex('#9CA3AF')(s),
  dim:       (s: string) => chalk.dim(s),
  user:      (s: string) => chalk.hex('#34D399')(s),
  agent:     (s: string) => chalk.hex('#A78BFA')(s),
  tool:      (s: string) => chalk.hex('#FCD34D')(s),
  code:      (s: string) => chalk.hex('#E06C75')(s),
  bold:      chalk.bold,
};

// ── ASCII logo ────────────────────────────────────────────────────────────────
const LOGO = [
  '  ███╗   ██╗████████╗ ██████╗ ██╗  ██╗',
  '  ████╗  ██║╚══██╔══╝██╔═══██╗╚██╗██╔╝',
  '  ██╔██╗ ██║   ██║   ██║   ██║ ╚███╔╝ ',
  '  ██║╚██╗██║   ██║   ██║   ██║ ██╔██╗ ',
  '  ██║ ╚████║   ██║   ╚██████╔╝██╔╝ ██╗',
  '  ╚═╝  ╚═══╝   ╚═╝    ╚═════╝ ╚═╝  ╚═╝',
];
const GRADIENT = ['#7C3AED', '#8B5CF6', '#6D28D9', '#4F46E5', '#2563EB', '#0891B2'];

export function printBanner(provider?: string, model?: string, version = '2.0.0'): void {
  process.stdout.write('\x1Bc'); // clear screen
  process.stdout.write('\n');
  LOGO.forEach((line, i) => console.log(chalk.hex(GRADIENT[i])(line)));
  console.log();
  console.log(C.muted('  Your Personal AI Agent  ·  Open Source CLI  ·  v' + version));
  if (provider && model) {
    process.stdout.write(
      C.dim('  ⚙  ') +
      C.secondary(provider) +
      C.dim('  ·  ') +
      C.primary(model) +
      '\n',
    );
  }
  process.stdout.write('\n');
}

// ── Horizontal rule ──────────────────────────────────────────────────────────
export function hr(char = '─', color?: (s: string) => string): string {
  const w = Math.min(process.stdout.columns || 80, 80);
  const line = char.repeat(w);
  return color ? color(line) : C.muted(line);
}

// ── Spinner ──────────────────────────────────────────────────────────────────
export function spinner(text: string): Ora {
  return ora({ text: C.muted(text), spinner: 'dots', color: 'magenta' });
}

// ── Message decorators ───────────────────────────────────────────────────────
export function printUserPrompt(): void {
  process.stdout.write('\n' + C.user(' You') + C.muted(' ▶  '));
}

export function printAgentHeader(name: string): void {
  process.stdout.write(
    '\n' +
    C.primary(' ▍') +
    C.bold(C.agent(` ${name}  `)) +
    '\n\n  ',
  );
}

export function printAgentChunk(chunk: string): void {
  process.stdout.write(C.agent(chunk));
}

export function printStats(tokens: number, ms: number): void {
  const tps = ms > 0 ? Math.round(tokens / (ms / 1000)) : 0;
  const statStr = C.muted(
    ` ↑ ~${tokens} tok  ·  ${(ms / 1000).toFixed(1)}s` +
    (tps ? `  ·  ${tps} tok/s` : ''),
  );
  console.log('\n\n' + hr('═', C.muted) + '\n' + statStr + '\n' + hr('═', C.muted));
}

export function printToolStart(name: string): void {
  process.stdout.write('\n\n' + C.tool(`  ⚡ running ${name}…`));
}

export function printToolDone(name: string): void {
  process.stdout.write('  ' + C.success(`✓ ${name} done`));
}

export function printToolError(name: string, err: string): void {
  process.stdout.write('  ' + C.error(`✗ ${name}: ${err}`));
}

export function printError(msg: string): void {
  const box = boxen(C.error('  ' + msg + '  '), {
    padding: { left: 1, right: 1, top: 0, bottom: 0 },
    borderStyle: 'round',
    borderColor: 'red',
  });
  console.error('\n' + box + '\n');
}

export function printInfo(msg: string): void {
  console.log(C.secondary(`  ℹ  `) + C.muted(msg));
}

export function printSuccess(msg: string): void {
  console.log(C.success(`  ✓  `) + C.muted(msg));
}

export function printHelp(): void {
  const cmds: [string, string][] = [
    ['/help',   'Show this help'],
    ['/config', 'Show current configuration'],
    ['/clear',  'Clear conversation history'],
    ['/new',    'Start a fresh conversation'],
    ['/setup',  'Re-run setup wizard'],
    ['/exit',   'Exit Nova'],
  ];
  const hints: [string, string][] = [
    ['Ctrl+C',  'Quit at any time'],
    ['Ctrl+L',  'Clear screen'],
  ];
  console.log('\n' + hr());
  console.log(C.bold(C.primary('\n  Commands:\n')));
  cmds.forEach(([c, d]) => console.log(`  ${C.secondary(c.padEnd(12))}  ${C.muted(d)}`));
  console.log(C.bold(C.primary('\n  Shortcuts:\n')));
  hints.forEach(([k, d]) => console.log(`  ${C.secondary(k.padEnd(12))}  ${C.muted(d)}`));
  console.log('\n' + hr() + '\n');
}

// ── Simple inline markdown colors (applied post-stream) ──────────────────────
export function renderMarkdown(text: string): string {
  return (
    text
      // Headers
      .replace(/^### (.+)$/gm, (_, t) => '\n' + C.bold(chalk.hex('#E5C07B')('■ ' + t)) + '\n')
      .replace(/^## (.+)$/gm,  (_, t) => '\n' + C.bold(chalk.hex('#61AFEF')('▌ ' + t)) + '\n')
      .replace(/^# (.+)$/gm,  (_, t) => '\n' + C.bold(chalk.hex('#C678DD')('▍ ' + t)) + '\n')
      // Bold
      .replace(/\*\*(.+?)\*\*/gs, (_, t) => chalk.bold(t))
      // Inline code
      .replace(/`([^`\n]+)`/g, (_, t) => chalk.bgHex('#2D2D2D').hex('#E06C75')(` ${t} `))
      // Blockquote
      .replace(/^> (.+)$/gm, (_, t) => C.muted('  │ ') + C.dim(t))
      // Bullet points
      .replace(/^[*-] (.+)$/gm, () => C.primary('  • ') + '$1')
      // Numbered list
      .replace(/^(\d+)\. (.+)$/gm, (_, n, t) => C.primary(`  ${n}. `) + t)
  );
}
