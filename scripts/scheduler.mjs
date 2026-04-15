const pollIntervalMs = Math.max(
  10_000,
  Number.parseInt(process.env.NOVA_SCHEDULER_INTERVAL_MS || process.env.NTOX_SCHEDULER_INTERVAL_MS || '60000', 10) || 60000,
);
const baseUrl = (
  process.env.NOVA_SCHEDULER_BASE_URL ||
  process.env.NTOX_SCHEDULER_BASE_URL ||
  process.env.NEXTAUTH_URL ||
  process.env.NEXT_PUBLIC_APP_URL ||
  'http://localhost:3000'
).replace(/\/$/, '');
const apiSecret = process.env.NOVA_API_SECRET || process.env.NTOX_API_SECRET || '';
const runOnce = process.argv.includes('--once');

let tickInFlight = false;

function headers() {
  return {
    'Content-Type': 'application/json',
    ...(apiSecret ? { Authorization: `Bearer ${apiSecret}` } : {}),
  };
}

function normalizeFieldParts(field) {
  return field.split(',').map((part) => part.trim()).filter(Boolean);
}

function matchesToken(token, value, min, max) {
  if (token === '*') return true;

  const stepParts = token.split('/');
  const base = stepParts[0];
  const step = stepParts[1] ? Number.parseInt(stepParts[1], 10) : null;
  if (stepParts[1] && (!Number.isInteger(step) || step <= 0)) {
    return false;
  }

  if (base === '*') {
    return step ? (value - min) % step === 0 : true;
  }

  const rangeParts = base.split('-');
  if (rangeParts.length === 1) {
    const exact = Number.parseInt(rangeParts[0], 10);
    if (!Number.isInteger(exact) || exact < min || exact > max) {
      return false;
    }
    return step ? exact === value && (value - min) % step === 0 : exact === value;
  }

  const start = Number.parseInt(rangeParts[0], 10);
  const end = Number.parseInt(rangeParts[1], 10);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start > end || start < min || end > max) {
    return false;
  }
  if (value < start || value > end) {
    return false;
  }
  return step ? (value - start) % step === 0 : true;
}

function fieldMatches(field, value, min, max) {
  return normalizeFieldParts(field).some((token) => matchesToken(token, value, min, max));
}

function cronMatches(expr, date) {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) {
    return false;
  }

  return [
    fieldMatches(parts[0], date.getMinutes(), 0, 59),
    fieldMatches(parts[1], date.getHours(), 0, 23),
    fieldMatches(parts[2], date.getDate(), 1, 31),
    fieldMatches(parts[3], date.getMonth() + 1, 1, 12),
    fieldMatches(parts[4], date.getDay(), 0, 6),
  ].every(Boolean);
}

function wasRunThisMinute(lastRunAt, now) {
  if (!lastRunAt) return false;
  const lastRun = new Date(lastRunAt);
  return (
    lastRun.getFullYear() === now.getFullYear() &&
    lastRun.getMonth() === now.getMonth() &&
    lastRun.getDate() === now.getDate() &&
    lastRun.getHours() === now.getHours() &&
    lastRun.getMinutes() === now.getMinutes()
  );
}

async function fetchJson(path, init = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      ...headers(),
      ...(init.headers || {}),
    },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`${path} failed with ${response.status}: ${body || response.statusText}`);
  }

  return response.json();
}

async function runTask(task) {
  console.log(`[scheduler] running "${task.name}" (${task.id})`);
  await fetchJson('/api/scheduled-tasks/run', {
    method: 'POST',
    body: JSON.stringify({ id: task.id }),
  });
}

async function tick() {
  if (tickInFlight) {
    console.log('[scheduler] skipping tick because the previous one is still running');
    return;
  }

  tickInFlight = true;
  const now = new Date();

  try {
    const tasks = await fetchJson('/api/scheduled-tasks');
    const runnable = tasks.filter((task) => (
      task.enabled &&
      cronMatches(task.cronExpr, now) &&
      !wasRunThisMinute(task.lastRunAt, now)
    ));

    if (runnable.length === 0) {
      console.log(`[scheduler] ${now.toISOString()} no tasks due`);
      return;
    }

    for (const task of runnable) {
      try {
        await runTask(task);
      } catch (error) {
        console.error(`[scheduler] task "${task.name}" failed:`, error instanceof Error ? error.message : error);
      }
    }
  } catch (error) {
    console.error('[scheduler] tick failed:', error instanceof Error ? error.message : error);
  } finally {
    tickInFlight = false;
  }
}

async function main() {
  console.log(`[scheduler] polling ${baseUrl} every ${pollIntervalMs}ms`);
  await tick();

  if (runOnce) {
    return;
  }

  setInterval(() => {
    void tick();
  }, pollIntervalMs);
}

await main();
