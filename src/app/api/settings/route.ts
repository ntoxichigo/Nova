import { NextRequest, NextResponse } from 'next/server';
import { getAllSettings, setAllSettings } from '@/lib/settings';
import { maskSensitiveSettings, sanitizeSettingPayload } from '@/lib/settings-schema';
import { tryRecordAuditEvent } from '@/lib/audit';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const settings = await getAllSettings();
    return NextResponse.json(maskSensitiveSettings(settings));
  } catch (error: unknown) {
    console.error('Error fetching settings:', error);
    return NextResponse.json({ error: 'Failed to fetch settings' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    if (typeof body !== 'object' || body === null) {
      return NextResponse.json({ error: 'Invalid settings object' }, { status: 400 });
    }

    const sanitized = sanitizeSettingPayload(body as Record<string, unknown>);
    await setAllSettings(sanitized);

    await tryRecordAuditEvent({
      source: 'settings',
      action: 'update',
      entityType: 'settings',
      entityId: 'global',
      entityLabel: 'Global Settings',
      summary: `Updated ${Object.keys(sanitized).length} settings`,
      details: {
        keys: Object.keys(sanitized),
      },
    });

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error('Error saving settings:', error);
    const message = error instanceof Error ? error.message : 'Failed to save settings';
    const status = error instanceof Error ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
