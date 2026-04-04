'use client';

import { motion } from 'framer-motion';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  Zap,
  Code,
  Pen,
  BarChart3,
  Palette,
  Settings,
  Lightbulb,
  Rocket,
  Shield,
  Heart,
  Star,
  BookOpen,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Skill } from '@/store/app-store';

const iconMap: Record<string, React.ReactNode> = {
  Zap: <Zap className="h-5 w-5" />,
  Code: <Code className="h-5 w-5" />,
  Pen: <Pen className="h-5 w-5" />,
  BarChart3: <BarChart3 className="h-5 w-5" />,
  Palette: <Palette className="h-5 w-5" />,
  Settings: <Settings className="h-5 w-5" />,
  Lightbulb: <Lightbulb className="h-5 w-5" />,
  Rocket: <Rocket className="h-5 w-5" />,
  Shield: <Shield className="h-5 w-5" />,
  Heart: <Heart className="h-5 w-5" />,
  Star: <Star className="h-5 w-5" />,
  BookOpen: <BookOpen className="h-5 w-5" />,
};

const categoryColors: Record<string, string> = {
  general: 'bg-secondary text-muted-foreground border-border/50',
  coding: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  writing: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  analysis: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20',
  creative: 'bg-pink-500/10 text-pink-400 border-pink-500/20',
  other: 'bg-secondary text-muted-foreground border-border/50',
};

interface SkillCardProps {
  skill: Skill;
  onToggle: (id: string) => void;
  onEdit: (skill: Skill) => void;
  onDelete: (id: string) => void;
}

export function SkillCard({ skill, onToggle, onEdit, onDelete }: SkillCardProps) {
  const Icon = iconMap[skill.icon] || <Zap className="h-5 w-5" />;
  const colorClass = categoryColors[skill.category] || categoryColors.general;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      whileHover={{ y: -2 }}
      transition={{ duration: 0.2 }}
      className={cn(
        'group relative rounded-xl border bg-card p-5 transition-all',
        skill.isActive
          ? 'border-primary/30 nova-glow'
          : 'border-border/50 opacity-70'
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div
            className={cn(
              'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg transition-colors',
              skill.isActive ? 'bg-primary/20 text-primary' : 'bg-muted text-muted-foreground'
            )}
          >
            {Icon}
          </div>
          <div className="min-w-0">
            <h3 className="font-semibold text-sm">{skill.name}</h3>
            <Badge variant="outline" className={cn('mt-1 text-[10px]', colorClass)}>
              {skill.category}
            </Badge>
          </div>
        </div>
        <Switch
          checked={skill.isActive}
          onCheckedChange={() => onToggle(skill.id)}
          className="scale-90"
        />
      </div>

      <p className="mt-3 text-sm text-muted-foreground line-clamp-2">{skill.description}</p>

      <div className="mt-4 flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <Button
          variant="outline"
          size="sm"
          onClick={() => onEdit(skill)}
          className="h-7 text-xs"
        >
          Edit
        </Button>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs text-destructive hover:bg-destructive/10"
            >
              Delete
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Skill</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to delete <strong>&quot;{skill.name}&quot;</strong>? This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => onDelete(skill.id)}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </motion.div>
  );
}

export { iconMap, categoryColors };
