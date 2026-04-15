import { NextResponse } from 'next/server';
import { allTools } from '@/lib/tools/executors';
import { discoverMCPTools } from '@/lib/mcp/client';

export async function GET() {
  try {
    const builtInTools = allTools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      source: 'builtin' as const,
    }));

    let mcpTools: Array<{ name: string; description: string; source: 'mcp'; server: string }> = [];
    try {
      const discovered = await discoverMCPTools();
      mcpTools = discovered.map((tool) => ({
        name: tool.name,
        description: tool.description,
        source: 'mcp' as const,
        server: tool.serverName,
      }));
    } catch {
      // Keep endpoint usable even when MCP discovery is unavailable.
    }

    const merged = [...builtInTools, ...mcpTools];
    const deduped = Array.from(
      new Map(merged.map((tool) => [tool.name, tool])).values(),
    ).sort((a, b) => a.name.localeCompare(b.name));

    return NextResponse.json({
      tools: deduped,
      count: deduped.length,
      mcpAvailable: mcpTools.length > 0,
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

