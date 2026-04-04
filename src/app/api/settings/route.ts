import { NextRequest, NextResponse } from 'next/server';
import { getAllSettings, setAllSettings, getLLMConfig } from '@/lib/settings';
import { createLLMProvider } from '@/lib/llm';

export async function GET() {
  try {
    const settings = await getAllSettings();
    return NextResponse.json(settings);
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
    await setAllSettings(body);
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error('Error saving settings:', error);
    return NextResponse.json({ error: 'Failed to save settings' }, { status: 500 });
  }
}
