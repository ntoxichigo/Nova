import { NextRequest, NextResponse } from 'next/server';
import { discoverMCPTools } from '@/lib/mcp/client';

// GET /api/mcp/servers/tools — discover all tools from all enabled MCP servers
export async function GET(_req: NextRequest) {
  try {
    const tools = await discoverMCPTools();
    return NextResponse.json({
      tools: tools.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
        server: t.serverName,
      })),
      count: tools.length,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
