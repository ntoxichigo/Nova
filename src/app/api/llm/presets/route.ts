import { NextRequest, NextResponse } from 'next/server';
import { tryRecordAuditEvent } from '@/lib/audit';
import { setAllSettings } from '@/lib/settings';
import { getLlmPresetById, LLM_PRESETS } from '@/lib/llm/presets';

export const runtime = 'nodejs';

export async function GET() {
  return NextResponse.json({ presets: LLM_PRESETS });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const presetId = typeof body?.presetId === 'string' ? body.presetId : '';
    const preset = getLlmPresetById(presetId);
    if (!preset) {
      return NextResponse.json({ error: 'Invalid presetId.' }, { status: 400 });
    }

    await setAllSettings(preset.settings);
    await tryRecordAuditEvent({
      source: 'settings',
      action: 'llm_preset_apply',
      entityType: 'settings',
      entityId: preset.id,
      entityLabel: preset.label,
      summary: `Applied LLM preset ${preset.label}`,
      details: {
        presetId: preset.id,
        keys: Object.keys(preset.settings),
      },
    });

    return NextResponse.json({ success: true, preset });
  } catch (error) {
    console.error('llm presets POST:', error);
    return NextResponse.json({ error: 'Failed to apply preset.' }, { status: 500 });
  }
}
