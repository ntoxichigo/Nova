import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function POST() {
  try {
    await db.$transaction([
      db.message.deleteMany(),
      db.conversation.deleteMany(),
      db.knowledge.deleteMany(),
      db.agentMemory.deleteMany(),
      db.skill.deleteMany(),
      db.settings.deleteMany(),
    ]);

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error('Error clearing all data:', error);
    return NextResponse.json({ error: 'Failed to clear data' }, { status: 500 });
  }
}
