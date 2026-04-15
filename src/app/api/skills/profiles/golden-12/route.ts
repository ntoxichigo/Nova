import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { tryRecordAuditEvent } from '@/lib/audit';
import {
  GOLDEN_12_PROFILE_ID,
  GOLDEN_12_PROFILE_NAME,
  selectGolden12Skills,
  type SkillProfileSkill,
} from '@/lib/skills/profiles';

const BACKUP_KEY = 'skills.profile.backup.before_golden12';
const ACTIVE_PROFILE_KEY = 'skills.profile.active';

function toProfileSkill(skill: {
  id: string;
  name: string;
  description: string;
  category: string;
  isActive: boolean;
}): SkillProfileSkill {
  return {
    id: skill.id,
    name: skill.name,
    description: skill.description,
    category: skill.category,
    isActive: skill.isActive,
  };
}

export async function GET() {
  try {
    const skills = await db.skill.findMany({
      select: {
        id: true,
        name: true,
        description: true,
        category: true,
        isActive: true,
      },
      orderBy: { name: 'asc' },
    });

    const selection = selectGolden12Skills(skills.map(toProfileSkill));
    const selectedIds = new Set(selection.selected.map((item) => item.skill.id));

    return NextResponse.json({
      profileId: GOLDEN_12_PROFILE_ID,
      profileName: GOLDEN_12_PROFILE_NAME,
      totalSkills: skills.length,
      selectedCount: selection.selected.length,
      missingCount: selection.missing.length,
      selected: selection.selected.map((item) => ({
        slotKey: item.slot.key,
        slotLabel: item.slot.label,
        reason: item.slot.reason,
        skillId: item.skill.id,
        skillName: item.skill.name,
        currentlyActive: item.skill.isActive,
      })),
      missing: selection.missing.map((slot) => ({
        slotKey: slot.key,
        slotLabel: slot.label,
        reason: slot.reason,
        candidates: slot.candidates,
      })),
      wouldArchive: skills
        .filter((skill) => !selectedIds.has(skill.id))
        .map((skill) => ({
          id: skill.id,
          name: skill.name,
          currentlyActive: skill.isActive,
        })),
    });
  } catch (error: unknown) {
    console.error('Error preparing Golden 12 profile preview:', error);
    return NextResponse.json({ error: 'Failed to preview Golden 12 profile' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    let dryRun = false;
    try {
      const body = await request.json();
      dryRun = body?.dryRun === true;
    } catch {
      dryRun = false;
    }

    const skills = await db.skill.findMany({
      select: {
        id: true,
        name: true,
        description: true,
        category: true,
        isActive: true,
      },
      orderBy: { name: 'asc' },
    });

    const selection = selectGolden12Skills(skills.map(toProfileSkill));
    if (selection.selected.length === 0) {
      return NextResponse.json(
        { error: 'Golden 12 profile could not match any installed skills' },
        { status: 400 }
      );
    }

    const selectedIds = selection.selected.map((item) => item.skill.id);
    const selectedIdSet = new Set(selectedIds);
    const selectedNames = selection.selected.map((item) => item.skill.name);
    const activeBefore = skills.filter((skill) => skill.isActive).length;
    const activeAfter = selectedIds.length;
    const archivedCount = skills.length - selectedIds.length;

    const responsePayload = {
      profileId: GOLDEN_12_PROFILE_ID,
      profileName: GOLDEN_12_PROFILE_NAME,
      dryRun,
      totalSkills: skills.length,
      activeBefore,
      activeAfter,
      archivedCount,
      selectedCount: selection.selected.length,
      missingCount: selection.missing.length,
      selected: selection.selected.map((item) => ({
        slotKey: item.slot.key,
        slotLabel: item.slot.label,
        reason: item.slot.reason,
        skillId: item.skill.id,
        skillName: item.skill.name,
      })),
      missing: selection.missing.map((slot) => ({
        slotKey: slot.key,
        slotLabel: slot.label,
        reason: slot.reason,
        candidates: slot.candidates,
      })),
      archived: skills
        .filter((skill) => !selectedIdSet.has(skill.id))
        .map((skill) => ({
          id: skill.id,
          name: skill.name,
          wasActive: skill.isActive,
        })),
    };

    if (dryRun) {
      return NextResponse.json(responsePayload);
    }

    const now = new Date().toISOString();
    const backupValue = JSON.stringify({
      profileId: GOLDEN_12_PROFILE_ID,
      profileName: GOLDEN_12_PROFILE_NAME,
      capturedAt: now,
      skills: skills.map((skill) => ({
        id: skill.id,
        name: skill.name,
        isActive: skill.isActive,
      })),
    });
    const activeProfileValue = JSON.stringify({
      profileId: GOLDEN_12_PROFILE_ID,
      profileName: GOLDEN_12_PROFILE_NAME,
      appliedAt: now,
      activeSkillIds: selectedIds,
      activeSkillNames: selectedNames,
      totalSkills: skills.length,
      archivedCount,
      missingSlotCount: selection.missing.length,
    });

    await db.$transaction([
      db.skill.updateMany({
        where: { id: { in: selectedIds } },
        data: { isActive: true },
      }),
      db.skill.updateMany({
        where: { id: { notIn: selectedIds } },
        data: { isActive: false },
      }),
      db.settings.upsert({
        where: { key: BACKUP_KEY },
        create: { key: BACKUP_KEY, value: backupValue },
        update: { value: backupValue },
      }),
      db.settings.upsert({
        where: { key: ACTIVE_PROFILE_KEY },
        create: { key: ACTIVE_PROFILE_KEY, value: activeProfileValue },
        update: { value: activeProfileValue },
      }),
    ]);

    await tryRecordAuditEvent({
      source: 'skills',
      action: 'apply_profile',
      entityType: 'skill_profile',
      entityId: GOLDEN_12_PROFILE_ID,
      entityLabel: GOLDEN_12_PROFILE_NAME,
      summary: `Applied ${GOLDEN_12_PROFILE_NAME}: ${selectedIds.length} active, ${archivedCount} archived`,
      details: {
        activeBefore,
        activeAfter,
        selectedSkillNames: selectedNames,
        missingSlots: selection.missing.map((slot) => slot.label),
        backupKey: BACKUP_KEY,
      },
    });

    return NextResponse.json(responsePayload);
  } catch (error: unknown) {
    console.error('Error applying Golden 12 profile:', error);
    return NextResponse.json({ error: 'Failed to apply Golden 12 profile' }, { status: 500 });
  }
}
