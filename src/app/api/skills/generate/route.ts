import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getLLMConfig } from '@/lib/settings';
import { createLLMProvider } from '@/lib/llm';

export async function POST(request: NextRequest) {
  try {
    const { description } = await request.json();

    if (!description || typeof description !== 'string' || description.trim().length < 3) {
      return NextResponse.json({ error: 'Description is required' }, { status: 400 });
    }

    const llmConfig = await getLLMConfig();
    const provider = createLLMProvider(llmConfig);

    const prompt = `You are a skill designer for an AI agent system. Based on the user's description, create a detailed, production-ready skill definition.

User description: "${description.trim()}"

Respond with ONLY a valid JSON object (no markdown, no extra text) with these exact fields:
{
  "name": "Short skill name (2-4 words, title case)",
  "category": "One of: productivity, research, creative, technical, communication, analysis, automation, general",
  "icon": "One of: Zap, Brain, Search, Code, FileText, Globe, Star, Wrench, Calendar, BarChart, MessageSquare, Lightbulb, Target, Shield, Rocket",
  "description": "1-2 sentence description of what this skill does and when to use it",
  "instructions": "Detailed instructions for the AI (3-6 sentences). Include: what triggers this skill, how to approach tasks with it, what format to respond in, any special considerations or tone."
}`;

    let raw = '';
    try {
      for await (const chunk of provider.stream([{ role: 'user', content: prompt }])) {
        raw += chunk;
      }
    } catch {
      // Fallback: try chat
      const res = await provider.chat([{ role: 'user', content: prompt }]);
      raw = res.content;
    }

    // Extract JSON from response
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return NextResponse.json({ error: 'Failed to generate skill — model did not return valid JSON' }, { status: 500 });
    }

    let skillData: {
      name: string;
      category: string;
      icon: string;
      description: string;
      instructions: string;
    };

    try {
      skillData = JSON.parse(jsonMatch[0]);
    } catch {
      return NextResponse.json({ error: 'Failed to parse generated skill' }, { status: 500 });
    }

    // Validate required fields
    if (!skillData.name || !skillData.description || !skillData.instructions) {
      return NextResponse.json({ error: 'Generated skill is missing required fields' }, { status: 500 });
    }

    // Save to DB
    const skill = await db.skill.create({
      data: {
        name: skillData.name,
        description: skillData.description,
        instructions: skillData.instructions,
        category: skillData.category || 'general',
        icon: skillData.icon || 'Zap',
        isActive: true,
      },
    });

    return NextResponse.json({ skill, generated: true }, { status: 201 });
  } catch (error: unknown) {
    console.error('Skill generation error:', error);
    return NextResponse.json({ error: 'Failed to generate skill' }, { status: 500 });
  }
}
