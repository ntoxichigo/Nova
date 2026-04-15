import { NextRequest, NextResponse } from 'next/server';
import { tryRecordAuditEvent } from '@/lib/audit';
import { applyOperatingPreset, getOperatingSystemState, listOperatingPresets } from '@/lib/operating-system';
import type { OperatingProfile } from '@/lib/settings';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const [state, presets] = await Promise.all([
      getOperatingSystemState(),
      Promise.resolve(listOperatingPresets()),
    ]);
    return NextResponse.json({ state, presets });
  } catch (error) {
    console.error('operating-system GET:', error);
    return NextResponse.json({ error: 'Failed to load operating system state.' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const presetId = body?.presetId as OperatingProfile | undefined;
    if (!presetId || !['complete', 'studio', 'guarded', 'autonomous'].includes(presetId)) {
      return NextResponse.json({ error: 'Invalid presetId.' }, { status: 400 });
    }

    const preset = await applyOperatingPreset(presetId);
    const state = await getOperatingSystemState();

    await tryRecordAuditEvent({
      source: 'settings',
      action: 'operating_profile_apply',
      entityType: 'settings',
      entityId: 'operating-system',
      entityLabel: 'Operating System',
      summary: `Applied Nova operating profile ${preset.label}`,
      details: {
        presetId,
        automationMode: state.automationMode,
      },
    });

    return NextResponse.json({ success: true, preset, state });
  } catch (error) {
    console.error('operating-system POST:', error);
    return NextResponse.json({ error: 'Failed to apply operating profile.' }, { status: 500 });
  }
}
