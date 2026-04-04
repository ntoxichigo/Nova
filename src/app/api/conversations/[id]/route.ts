import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    
    const messages = await db.message.findMany({
      where: { conversationId: id },
      orderBy: { createdAt: 'asc' },
    });

    // Resolve skill IDs to names for all messages
    const allSkills = await db.skill.findMany({
      select: { id: true, name: true },
    });
    const skillNameMap = new Map(allSkills.map((s) => [s.id, s.name]));

    const processedMessages = messages.map((msg) => {
      let skillsUsed: string[] = [];
      try {
        const parsed = JSON.parse(msg.skillsUsed || '[]');
        if (Array.isArray(parsed)) {
          skillsUsed = parsed.map((skillId: string) => skillNameMap.get(skillId) || skillId);
        }
      } catch {
        skillsUsed = [];
      }
      return {
        ...msg,
        skillsUsed,
      };
    });
    
    return NextResponse.json(processedMessages);
  } catch (error: unknown) {
    console.error('Error fetching messages:', error);
    return NextResponse.json({ error: 'Failed to fetch messages' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    
    await db.conversation.delete({ where: { id } });
    
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error('Error deleting conversation:', error);
    return NextResponse.json({ error: 'Failed to delete conversation' }, { status: 500 });
  }
}
