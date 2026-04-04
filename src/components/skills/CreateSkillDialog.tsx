'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { iconMap, categoryColors } from './SkillCard';
import type { Skill } from '@/store/app-store';
import { cn } from '@/lib/utils';
import { Plus, Sparkles } from 'lucide-react';

const categories = ['general', 'coding', 'writing', 'analysis', 'creative', 'other'];
const availableIcons = Object.keys(iconMap);

interface CreateSkillDialogProps {
  skill?: Skill | null;
  onSubmit: (data: {
    name: string;
    description: string;
    instructions: string;
    category: string;
    icon: string;
  }) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function CreateSkillDialog({
  skill,
  onSubmit,
  open,
  onOpenChange,
}: CreateSkillDialogProps) {
  const isEditing = !!skill;
  const [name, setName] = useState(skill?.name || '');
  const [description, setDescription] = useState(skill?.description || '');
  const [instructions, setInstructions] = useState(skill?.instructions || '');
  const [category, setCategory] = useState(skill?.category || 'general');
  const [icon, setIcon] = useState(skill?.icon || 'Zap');
  const [internalOpen, setInternalOpen] = useState(false);

  const isOpen = open !== undefined ? open : internalOpen;
  const setIsOpen = onOpenChange || setInternalOpen;

  const handleDialogChange = (newOpen: boolean) => {
    if (!newOpen && !onOpenChange) {
      setName('');
      setDescription('');
      setInstructions('');
      setCategory('general');
      setIcon('Zap');
    }
    setIsOpen(newOpen);
  };

  const handleSubmit = () => {
    if (!name.trim() || !description.trim() || !instructions.trim()) return;
    onSubmit({ name, description, instructions, category, icon });
    setIsOpen(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleDialogChange}>
      {!isEditing && onOpenChange === undefined && (
        <DialogTrigger asChild>
          <Button className="gap-2 bg-primary hover:bg-primary/90 nova-glow">
            <Plus className="h-4 w-4" />
            Create Skill
          </Button>
        </DialogTrigger>
      )}
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto border-border/50 bg-card">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            {isEditing ? 'Edit Skill' : 'Create New Skill'}
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2">
          {/* Icon Picker */}
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Choose an Icon</Label>
            <div className="flex flex-wrap gap-2">
              {availableIcons.map((iconName) => {
                const IconComp = iconMap[iconName];
                return (
                  <button
                    key={iconName}
                    onClick={() => setIcon(iconName)}
                    className={cn(
                      'flex h-10 w-10 items-center justify-center rounded-lg border transition-all',
                      icon === iconName
                        ? 'border-primary bg-primary/20 text-primary nova-glow'
                        : 'border-border/50 bg-secondary/50 text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {IconComp}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Name */}
          <div className="space-y-2">
            <Label htmlFor="skill-name">Skill Name</Label>
            <Input
              id="skill-name"
              placeholder="e.g., Code Review Expert"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="border-border/50 bg-secondary/30"
            />
          </div>

          {/* Category */}
          <div className="space-y-2">
            <Label>Category</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger className="border-border/50 bg-secondary/30">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {categories.map((cat) => (
                  <SelectItem key={cat} value={cat}>
                    <span className="flex items-center gap-2">
                      <span
                        className={cn(
                          'inline-block h-2 w-2 rounded-full',
                          categoryColors[cat]?.split(' ')[0]
                        )}
                      />
                      {cat.charAt(0).toUpperCase() + cat.slice(1)}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="skill-desc">Short Description</Label>
            <Textarea
              id="skill-desc"
              placeholder="A brief description of what this skill does..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="min-h-[80px] resize-none border-border/50 bg-secondary/30"
            />
          </div>

          {/* Instructions */}
          <div className="space-y-2">
            <Label htmlFor="skill-instructions">Instructions & Knowledge</Label>
            <Textarea
              id="skill-instructions"
              placeholder="Detailed instructions for Nova on how to use this skill. Be specific about what the AI should do when this skill is relevant..."
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              className="min-h-[150px] resize-none border-border/50 bg-secondary/30"
            />
            <p className="text-xs text-muted-foreground">
              This is the core knowledge Nova will use when this skill is activated. Be as detailed as possible.
            </p>
          </div>

          <Button
            onClick={handleSubmit}
            disabled={!name.trim() || !description.trim() || !instructions.trim()}
            className="w-full bg-primary hover:bg-primary/90"
          >
            {isEditing ? 'Update Skill' : 'Create Skill'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
