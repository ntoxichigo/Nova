import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function POST() {
  try {
    await db.$transaction([
      db.message.deleteMany(),
      db.scriptExecution.deleteMany(),
      db.scriptFile.deleteMany(),
      db.conversation.deleteMany(),
      db.scriptProject.deleteMany(),
      db.knowledge.deleteMany(),
      db.agentMemory.deleteMany(),
      db.memoryRelation.deleteMany(),
      db.skill.deleteMany(),
      db.promptTemplate.deleteMany(),
      db.scheduledTask.deleteMany(),
      db.rSSFeed.deleteMany(),
      db.mCPServer.deleteMany(),
      db.note.deleteMany(),
      db.connection.deleteMany(),
      db.settings.deleteMany(),
    ]);

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error('Error clearing all data:', error);
    return NextResponse.json({ error: 'Failed to clear data' }, { status: 500 });
  }
}
