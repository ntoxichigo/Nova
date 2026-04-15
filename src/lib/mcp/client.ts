import { spawn, type ChildProcess } from 'child_process';
import { db } from '@/lib/db';

interface MCPTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  serverId: string;
  serverName: string;
}

interface MCPServerConfig {
  id: string;
  name: string;
  transport: 'stdio' | 'sse';
  command: string;
  url: string;
  args: string[];
  env: Record<string, string>;
}

const activeProcesses = new Map<string, ChildProcess>();

let cachedTools: MCPTool[] = [];
let lastRefreshed = 0;

function parseCommandString(command: string): string[] {
  const parts: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;

  for (let index = 0; index < command.length; index++) {
    const char = command[index];

    if (char === '\\' && index + 1 < command.length) {
      current += command[index + 1];
      index += 1;
      continue;
    }

    if ((char === '"' || char === "'") && (!quote || quote === char)) {
      quote = quote ? null : char;
      continue;
    }

    if (!quote && /\s/.test(char)) {
      if (current) {
        parts.push(current);
        current = '';
      }
      continue;
    }

    current += char;
  }

  if (quote) {
    throw new Error('Unterminated quote in MCP command');
  }

  if (current) {
    parts.push(current);
  }

  return parts;
}

function parseServerConfig(server: {
  id: string;
  name: string;
  transport: string;
  command: string;
  url: string;
  args: string;
  env: string;
}): MCPServerConfig {
  let args: string[] = [];
  let env: Record<string, string> = {};

  try {
    args = JSON.parse(server.args);
  } catch {
    args = [];
  }

  try {
    env = JSON.parse(server.env);
  } catch {
    env = {};
  }

  return {
    id: server.id,
    name: server.name,
    transport: server.transport === 'sse' ? 'sse' : 'stdio',
    command: server.command,
    url: server.url,
    args,
    env,
  };
}

async function rpcStdio(
  processRef: ChildProcess,
  method: string,
  params: Record<string, unknown> = {},
  timeoutMs = 10000,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const id = Date.now();
    const payload = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';
    const timeout = setTimeout(() => reject(new Error(`MCP rpc timeout: ${method}`)), timeoutMs);

    const onData = (data: Buffer) => {
      const text = data.toString();
      for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line);
          if (parsed.id !== id) continue;
          clearTimeout(timeout);
          processRef.stdout?.off('data', onData);
          if (parsed.error) {
            reject(new Error(parsed.error.message || 'RPC error'));
          } else {
            resolve(parsed.result);
          }
          return;
        } catch {
          // Ignore partial JSON chunks.
        }
      }
    };

    processRef.stdout?.on('data', onData);
    processRef.stdin?.write(payload);
  });
}

async function rpcSSE(
  url: string,
  method: string,
  params: Record<string, unknown> = {},
): Promise<unknown> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`MCP SSE error: ${response.status}`);
  const json = await response.json();
  if (json.error) throw new Error(json.error.message || 'RPC error');
  return json.result;
}

function getOrSpawn(config: MCPServerConfig): ChildProcess {
  const existing = activeProcesses.get(config.id);
  if (existing && !existing.killed) {
    return existing;
  }

  if (!config.command.trim()) {
    throw new Error(`MCP server "${config.name}" does not have a command configured`);
  }

  const commandParts = parseCommandString(config.command);
  if (commandParts.length === 0) {
    throw new Error(`MCP server "${config.name}" command is empty`);
  }

  const [command, ...inlineArgs] = commandParts;
  const processRef = spawn(command, [...inlineArgs, ...config.args], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, ...config.env },
  });

  processRef.on('exit', () => activeProcesses.delete(config.id));
  processRef.stderr?.on('data', (data) => {
    console.error(`MCP ${config.name} stderr:`, data.toString());
  });

  activeProcesses.set(config.id, processRef);
  return processRef;
}

async function listTools(config: MCPServerConfig): Promise<MCPTool[]> {
  if (config.transport === 'sse') {
    const result = (await rpcSSE(config.url, 'tools/list')) as {
      tools?: Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }>;
    };

    return (result.tools || []).map((tool) => ({
      name: `mcp_${config.id}_${tool.name}`,
      description: tool.description || tool.name,
      inputSchema: tool.inputSchema || {},
      serverId: config.id,
      serverName: config.name,
    }));
  }

  const processRef = getOrSpawn(config);
  await rpcStdio(processRef, 'initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'nova', version: '1.0.0' },
  }).catch(() => {});

  const result = (await rpcStdio(processRef, 'tools/list')) as {
    tools?: Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }>;
  };

  return (result.tools || []).map((tool) => ({
    name: `mcp_${config.id}_${tool.name}`,
    description: tool.description || tool.name,
    inputSchema: tool.inputSchema || {},
    serverId: config.id,
    serverName: config.name,
  }));
}

export async function discoverMCPTools(): Promise<MCPTool[]> {
  if (Date.now() - lastRefreshed < 30000 && cachedTools.length > 0) {
    return cachedTools;
  }

  const servers = await db.mCPServer.findMany({ where: { enabled: true } });
  const tools: MCPTool[] = [];

  for (const server of servers) {
    const config = parseServerConfig(server);
    try {
      const discovered = await listTools(config);
      tools.push(...discovered);
      await db.mCPServer.update({
        where: { id: server.id },
        data: { toolCount: discovered.length },
      }).catch(() => {});
    } catch (error) {
      console.error(`MCP discover ${server.name}:`, error);
    }
  }

  cachedTools = tools;
  lastRefreshed = Date.now();
  return tools;
}

export async function callMCPTool(toolName: string, args: Record<string, unknown>): Promise<string> {
  const parts = toolName.split('_');
  if (parts.length < 3 || parts[0] !== 'mcp') {
    throw new Error(`Invalid MCP tool name: ${toolName}`);
  }

  const serverId = parts[1];
  const realToolName = parts.slice(2).join('_');
  const server = await db.mCPServer.findUnique({ where: { id: serverId } });
  if (!server || !server.enabled) {
    throw new Error(`MCP server "${serverId}" not found or disabled`);
  }

  const config = parseServerConfig(server);
  const result = config.transport === 'sse'
    ? await rpcSSE(config.url, 'tools/call', { name: realToolName, arguments: args })
    : await rpcStdio(getOrSpawn(config), 'tools/call', { name: realToolName, arguments: args });

  const typedResult = result as { content?: Array<{ type: string; text?: string }> };
  if (typedResult.content && Array.isArray(typedResult.content)) {
    return typedResult.content.map((entry) => entry.text || JSON.stringify(entry)).join('\n');
  }

  return typeof result === 'string' ? result : JSON.stringify(result, null, 2);
}

export function invalidateMCPServer(serverId?: string) {
  cachedTools = [];
  lastRefreshed = 0;

  if (!serverId) return;

  const active = activeProcesses.get(serverId);
  if (active) {
    try {
      active.kill();
    } catch {
      // Ignore shutdown failures during cache invalidation.
    }
    activeProcesses.delete(serverId);
  }
}

export function shutdownMCPServers() {
  for (const [, processRef] of activeProcesses) {
    try {
      processRef.kill();
    } catch {
      // Ignore best-effort shutdown errors.
    }
  }
  activeProcesses.clear();
  cachedTools = [];
  lastRefreshed = 0;
}
