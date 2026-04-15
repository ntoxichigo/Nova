'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { SkillCard } from './SkillCard';
import { CreateSkillDialog } from './CreateSkillDialog';
import { useAppStore, type Skill } from '@/store/app-store';
import { toast } from 'sonner';
import { Sparkles, Search, Filter, Download, Crown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { categoryColors } from './SkillCard';

const categories = ['all', 'general', 'coding', 'writing', 'analysis', 'creative', 'other'];

export function SkillsView() {
  const { skills, setSkills } = useAppStore();
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterCategory, setFilterCategory] = useState('all');
  const [filterActive, setFilterActive] = useState<'all' | 'active' | 'inactive'>('all');
  const [editSkill, setEditSkill] = useState<Skill | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [applyingGolden12, setApplyingGolden12] = useState(false);

  const handleImportBuiltins = async () => {
    setImporting(true);
    try {
      const res = await fetch('/api/skills/import-builtins', { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        toast.success(`Imported ${data.imported} built-in skills (${data.skipped} already existed)`);
        loadSkills();
      } else {
        toast.error('Failed to import built-in skills');
      }
    } catch {
      toast.error('Failed to import built-in skills');
    } finally {
      setImporting(false);
    }
  };

  const handleApplyGolden12 = async () => {
    const confirmed = window.confirm(
      'Apply Golden 12 profile? This will activate the top 12 workflow skills and archive all others.'
    );
    if (!confirmed) return;

    setApplyingGolden12(true);
    try {
      const res = await fetch('/api/skills/profiles/golden-12', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dryRun: false }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || 'Failed to apply Golden 12 profile');
        return;
      }

      const data = await res.json();
      toast.success(
        `Golden 12 applied: ${data.activeAfter} active, ${data.archivedCount} archived`
      );

      if (data.missingCount > 0) {
        toast.warning(`${data.missingCount} profile slots are missing installed skills`);
      }

      loadSkills();
    } catch (err) {
      console.error('Failed to apply Golden 12 profile:', err);
      toast.error('Failed to apply Golden 12 profile');
    } finally {
      setApplyingGolden12(false);
    }
  };

  const loadSkills = useCallback(async () => {
    try {
      const res = await fetch('/api/skills');
      if (res.ok) {
        const data = await res.json();
        setSkills(data);
      }
    } catch (err) {
      console.error('Failed to load skills:', err);
      toast.error('Failed to load skills');
    } finally {
      setLoading(false);
    }
  }, [setSkills]);

  useEffect(() => {
    loadSkills();
  }, [loadSkills]);

  const handleCreate = async (data: {
    name: string;
    description: string;
    instructions: string;
    category: string;
    icon: string;
  }) => {
    try {
      const res = await fetch('/api/skills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (res.ok) {
        toast.success(`Skill "${data.name}" created successfully!`);
        loadSkills();
      }
    } catch (err) {
      toast.error('Failed to create skill');
    }
  };

  const handleUpdate = async (data: {
    name: string;
    description: string;
    instructions: string;
    category: string;
    icon: string;
  }) => {
    if (!editSkill) return;
    try {
      const res = await fetch('/api/skills', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: editSkill.id, ...data }),
      });
      if (res.ok) {
        toast.success(`Skill "${data.name}" updated!`);
        setEditDialogOpen(false);
        setEditSkill(null);
        loadSkills();
      }
    } catch (err) {
      toast.error('Failed to update skill');
    }
  };

  const handleToggle = async (id: string) => {
    try {
      const res = await fetch('/api/skills/toggle', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      if (res.ok) {
        loadSkills();
      }
    } catch (err) {
      toast.error('Failed to toggle skill');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/skills?id=${id}`, { method: 'DELETE' });
      if (res.ok) {
        toast.success('Skill deleted');
        loadSkills();
      }
    } catch (err) {
      toast.error('Failed to delete skill');
    }
  };

  const handleEdit = (skill: Skill) => {
    setEditSkill(skill);
    setEditDialogOpen(true);
  };

  // Filter skills
  const filteredSkills = skills.filter((skill) => {
    if (filterCategory !== 'all' && skill.category !== filterCategory) return false;
    if (filterActive === 'active' && !skill.isActive) return false;
    if (filterActive === 'inactive' && skill.isActive) return false;
    if (search) {
      const searchLower = search.toLowerCase();
      return (
        skill.name.toLowerCase().includes(searchLower) ||
        skill.description.toLowerCase().includes(searchLower) ||
        skill.category.toLowerCase().includes(searchLower)
      );
    }
    return true;
  });

  const activeCount = skills.filter((s) => s.isActive).length;
  const inactiveCount = skills.length - activeCount;

  return (
    <div className="h-full overflow-y-auto">
    <div className="mx-auto max-w-6xl p-6">
      {/* Header */}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <Sparkles className="h-6 w-6 text-primary" />
            Skills Dashboard
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage Nova&apos;s capabilities. {activeCount} active · {inactiveCount} inactive
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="default"
            onClick={handleApplyGolden12}
            disabled={applyingGolden12}
            className="gap-2"
          >
            <Crown className="h-4 w-4" />
            {applyingGolden12 ? 'Applying Golden 12...' : 'Apply Golden 12'}
          </Button>
          <Button
            variant="outline"
            onClick={handleImportBuiltins}
            disabled={importing}
            className="gap-2"
          >
            <Download className="h-4 w-4" />
            {importing ? 'Importing…' : 'Import Built-in Skills'}
          </Button>
          <CreateSkillDialog onSubmit={handleCreate} />
        </div>
      </div>

      {/* Filters */}
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search skills..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 border-border/50 bg-secondary/30"
          />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <div className="flex flex-wrap gap-1">
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => setFilterCategory(cat)}
                className={cn(
                  'rounded-full px-3 py-1 text-xs transition-colors',
                  filterCategory === cat
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-secondary/50 text-muted-foreground hover:text-foreground'
                )}
              >
                {cat === 'all' ? 'All' : cat.charAt(0).toUpperCase() + cat.slice(1)}
              </button>
            ))}
          </div>
          <div className="h-4 w-px bg-border" />
          <div className="flex gap-1">
            {(['all', 'active', 'inactive'] as const).map((status) => (
              <button
                key={status}
                onClick={() => setFilterActive(status)}
                className={cn(
                  'rounded-full px-3 py-1 text-xs transition-colors',
                  filterActive === status
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-secondary/50 text-muted-foreground hover:text-foreground'
                )}
              >
                {status.charAt(0).toUpperCase() + status.slice(1)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Skills Grid */}
      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-48 rounded-xl bg-secondary/30" />
          ))}
        </div>
      ) : filteredSkills.length === 0 ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex flex-col items-center justify-center gap-4 py-16"
        >
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
            <Sparkles className="h-8 w-8 text-primary" />
          </div>
          <div className="text-center">
            <p className="font-medium">No skills found</p>
            <p className="text-sm text-muted-foreground">
              {skills.length === 0
                ? 'Create your first skill to teach Nova something new.'
                : 'Try adjusting your filters.'}
            </p>
          </div>
        </motion.div>
      ) : (
        <motion.div layout className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <AnimatePresence>
            {filteredSkills.map((skill) => (
              <SkillCard
                key={skill.id}
                skill={skill}
                onToggle={handleToggle}
                onEdit={handleEdit}
                onDelete={handleDelete}
              />
            ))}
          </AnimatePresence>
        </motion.div>
      )}

      {/* Edit Dialog */}
      {editSkill && (
        <CreateSkillDialog
          key={editSkill.id}
          skill={editSkill}
          onSubmit={handleUpdate}
          open={editDialogOpen}
          onOpenChange={setEditDialogOpen}
        />
      )}
    </div>
    </div>
  );
}
