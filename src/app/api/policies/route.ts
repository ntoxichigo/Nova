import { NextRequest, NextResponse } from 'next/server';
import { DEFAULT_ACTION_POLICY, saveActionPolicy, getActionPolicy } from '@/lib/policy';
import { tryRecordAuditEvent } from '@/lib/audit';

export async function GET() {
  try {
    const policy = await getActionPolicy();
    return NextResponse.json(policy);
  } catch (error) {
    console.error('policies GET:', error);
    return NextResponse.json(DEFAULT_ACTION_POLICY, { status: 200 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const policy = await saveActionPolicy(body);

    await tryRecordAuditEvent({
      source: 'settings',
      action: 'policy_update',
      entityType: 'policy',
      entityId: 'agent_action_policy',
      entityLabel: 'Agent Action Policy',
      summary: 'Updated Mission Control policy gates',
      details: { policy },
    });

    return NextResponse.json(policy);
  } catch (error) {
    console.error('policies PUT:', error);
    return NextResponse.json({ error: 'Failed to save policy' }, { status: 500 });
  }
}
