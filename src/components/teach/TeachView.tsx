'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import {
  GraduationCap,
  Sparkles,
  BookOpen,
  Brain,
  Settings,
  CheckCircle2,
  Tag,
  Plus,
  X,
  Lightbulb,
  Info,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { iconMap } from '@/components/skills/SkillCard';
import { useAppStore } from '@/store/app-store';

const availableIcons = Object.keys(iconMap);

export function TeachView() {
  const [showSuccess, setShowSuccess] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const { setActiveView } = useAppStore();

  const showSuccessToast = (msg: string) => {
    setSuccessMessage(msg);
    setShowSuccess(true);
    toast.success(msg);
    setTimeout(() => setShowSuccess(false), 3000);
  };

  return (
    <div className="mx-auto max-w-4xl p-6">
      {/* Header */}
      <div className="mb-8 text-center">
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', bounce: 0.4 }}
          className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/15 nova-glow"
        >
          <GraduationCap className="h-8 w-8 text-primary" />
        </motion.div>
        <h1 className="text-2xl font-bold">Teach Nova</h1>
        <p className="mt-2 text-sm text-muted-foreground max-w-md mx-auto">
          Make Nova smarter by teaching it new skills, sharing knowledge, and setting preferences. Everything you teach shapes how Nova responds.
        </p>
      </div>

      {/* Success Animation */}
      <AnimatePresence>
        {showSuccess && (
          <motion.div
            initial={{ opacity: 0, y: -20, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20 }}
            className="mb-6 flex items-center gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4"
          >
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: 'spring', bounce: 0.5, delay: 0.1 }}
            >
              <CheckCircle2 className="h-5 w-5 text-emerald-400" />
            </motion.div>
            <p className="text-sm text-emerald-300">{successMessage}</p>
          </motion.div>
        )}
      </AnimatePresence>

      <Tabs defaultValue="skill" className="space-y-6">
        <TabsList className="grid w-full grid-cols-3 bg-secondary/50 p-1">
          <TabsTrigger value="skill" className="gap-2 data-[state=active]:bg-primary/80 data-[state=active]:text-primary-foreground">
            <Sparkles className="h-4 w-4" />
            <span className="hidden sm:inline">Teach a Skill</span>
            <span className="sm:hidden">Skill</span>
          </TabsTrigger>
          <TabsTrigger value="knowledge" className="gap-2 data-[state=active]:bg-primary/80 data-[state=active]:text-primary-foreground">
            <BookOpen className="h-4 w-4" />
            <span className="hidden sm:inline">Share Knowledge</span>
            <span className="sm:hidden">Knowledge</span>
          </TabsTrigger>
          <TabsTrigger value="preferences" className="gap-2 data-[state=active]:bg-primary/80 data-[state=active]:text-primary-foreground">
            <Settings className="h-4 w-4" />
            <span className="hidden sm:inline">Preferences</span>
            <span className="sm:hidden">Prefs</span>
          </TabsTrigger>
        </TabsList>

        {/* Teach a Skill Tab */}
        <TabsContent value="skill">
          <TeachSkillForm onSuccess={showSuccessToast} />
        </TabsContent>

        {/* Share Knowledge Tab */}
        <TabsContent value="knowledge">
          <ShareKnowledgeForm onSuccess={showSuccessToast} />
        </TabsContent>

        {/* Preferences Tab */}
        <TabsContent value="preferences">
          <SetPreferencesForm onSuccess={showSuccessToast} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function TeachSkillForm({ onSuccess }: { onSuccess: (msg: string) => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [instructions, setInstructions] = useState('');
  const [category, setCategory] = useState('general');
  const [icon, setIcon] = useState('Zap');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !description.trim() || !instructions.trim()) return;
    setLoading(true);

    try {
      const res = await fetch('/api/teach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'skill',
          data: { name, description, instructions, category, icon },
        }),
      });
      if (res.ok) {
        onSuccess(`Nova has learned the "${name}" skill!`);
        setName('');
        setDescription('');
        setInstructions('');
        setCategory('general');
        setIcon('Zap');
      }
    } catch {
      toast.error('Failed to teach skill');
    } finally {
      setLoading(false);
    }
  };

  return (
    <motion.form
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      onSubmit={handleSubmit}
      className="space-y-5 rounded-xl border border-border/50 bg-card p-6"
    >
      <div className="flex items-start gap-3 rounded-lg bg-primary/5 border border-primary/10 p-3">
        <Info className="h-5 w-5 text-primary mt-0.5 shrink-0" />
        <p className="text-xs text-muted-foreground">
          Skills are capabilities Nova can actively use. Give it detailed instructions on what to do when this skill is relevant.
        </p>
      </div>

      {/* Icon Picker */}
      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground">Icon</Label>
        <div className="flex flex-wrap gap-2">
          {availableIcons.map((iconName) => {
            const IconComp = iconMap[iconName];
            return (
              <button
                key={iconName}
                type="button"
                onClick={() => setIcon(iconName)}
                className={cn(
                  'flex h-9 w-9 items-center justify-center rounded-lg border transition-all',
                  icon === iconName
                    ? 'border-primary bg-primary/20 text-primary'
                    : 'border-border/50 bg-secondary/50 text-muted-foreground hover:text-foreground'
                )}
              >
                {IconComp}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="teach-skill-name">Skill Name</Label>
          <Input
            id="teach-skill-name"
            placeholder="e.g., Code Review Expert"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="border-border/50 bg-secondary/30"
          />
        </div>
        <div className="space-y-2">
          <Label>Category</Label>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger className="border-border/50 bg-secondary/30">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="general">General</SelectItem>
              <SelectItem value="coding">Coding</SelectItem>
              <SelectItem value="writing">Writing</SelectItem>
              <SelectItem value="analysis">Analysis</SelectItem>
              <SelectItem value="creative">Creative</SelectItem>
              <SelectItem value="other">Other</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="teach-skill-desc">Short Description</Label>
        <Input
          id="teach-skill-desc"
          placeholder="What does this skill enable Nova to do?"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="border-border/50 bg-secondary/30"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="teach-skill-instructions">Detailed Instructions</Label>
        <Textarea
          id="teach-skill-instructions"
          placeholder="When the user asks about X, do Y... Be specific and detailed about how Nova should behave when using this skill."
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          className="min-h-[160px] resize-none border-border/50 bg-secondary/30"
        />
        <p className="text-xs text-muted-foreground">
          The more detailed the instructions, the better Nova will use this skill.
        </p>
      </div>

      <Button
        type="submit"
        disabled={!name.trim() || !description.trim() || !instructions.trim() || loading}
        className="w-full bg-primary hover:bg-primary/90 gap-2"
      >
        {loading ? (
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ repeat: Infinity, duration: 1 }}
            className="h-4 w-4 rounded-full border-2 border-primary-foreground border-t-transparent"
          />
        ) : (
          <Sparkles className="h-4 w-4" />
        )}
        {loading ? 'Teaching Nova...' : 'Teach This Skill'}
      </Button>
    </motion.form>
  );
}

function ShareKnowledgeForm({ onSuccess }: { onSuccess: (msg: string) => void }) {
  const [topic, setTopic] = useState('');
  const [content, setContent] = useState('');
  const [tagInput, setTagInput] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  const addTag = () => {
    const tag = tagInput.trim();
    if (tag && !tags.includes(tag)) {
      setTags([...tags, tag]);
      setTagInput('');
    }
  };

  const removeTag = (tag: string) => {
    setTags(tags.filter((t) => t !== tag));
  };

  const handleTagKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addTag();
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!topic.trim() || !content.trim()) return;
    setLoading(true);

    try {
      const res = await fetch('/api/teach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'knowledge',
          data: { topic, content, tags },
        }),
      });
      if (res.ok) {
        onSuccess(`Nova now knows about "${topic}"!`);
        setTopic('');
        setContent('');
        setTags([]);
      }
    } catch {
      toast.error('Failed to share knowledge');
    } finally {
      setLoading(false);
    }
  };

  return (
    <motion.form
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      onSubmit={handleSubmit}
      className="space-y-5 rounded-xl border border-border/50 bg-card p-6"
    >
      <div className="flex items-start gap-3 rounded-lg bg-primary/5 border border-primary/10 p-3">
        <Info className="h-5 w-5 text-primary mt-0.5 shrink-0" />
        <p className="text-xs text-muted-foreground">
          Knowledge is factual information Nova can reference. Topics are matched against user queries to provide relevant context.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="teach-topic">Topic</Label>
        <Input
          id="teach-topic"
          placeholder="e.g., React Hooks, Machine Learning Basics, Project Architecture"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          className="border-border/50 bg-secondary/30"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="teach-content">Knowledge Content</Label>
        <Textarea
          id="teach-content"
          placeholder="Share detailed knowledge Nova can use to answer questions on this topic..."
          value={content}
          onChange={(e) => setContent(e.target.value)}
          className="min-h-[160px] resize-none border-border/50 bg-secondary/30"
        />
      </div>

      <div className="space-y-2">
        <Label>Tags (for better matching)</Label>
        <div className="flex gap-2">
          <Input
            placeholder="Add a tag..."
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={handleTagKeyDown}
            className="border-border/50 bg-secondary/30"
          />
          <Button type="button" variant="outline" onClick={addTag} size="icon" className="shrink-0">
            <Plus className="h-4 w-4" />
          </Button>
        </div>
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {tags.map((tag) => (
              <Badge key={tag} variant="outline" className="gap-1 bg-primary/5 border-primary/20 text-primary">
                <Tag className="h-3 w-3" />
                {tag}
                <button type="button" onClick={() => removeTag(tag)} className="ml-1 hover:text-destructive">
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
          </div>
        )}
      </div>

      <Button
        type="submit"
        disabled={!topic.trim() || !content.trim() || loading}
        className="w-full bg-primary hover:bg-primary/90 gap-2"
      >
        {loading ? (
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ repeat: Infinity, duration: 1 }}
            className="h-4 w-4 rounded-full border-2 border-primary-foreground border-t-transparent"
          />
        ) : (
          <BookOpen className="h-4 w-4" />
        )}
        {loading ? 'Sharing Knowledge...' : 'Share Knowledge'}
      </Button>
    </motion.form>
  );
}

function SetPreferencesForm({ onSuccess }: { onSuccess: (msg: string) => void }) {
  const [type, setType] = useState<'preference' | 'fact' | 'instruction' | 'context'>('preference');
  const [content, setContent] = useState('');
  const [importance, setImportance] = useState(5);
  const [loading, setLoading] = useState(false);

  const quickPreferences = [
    { label: 'Concise answers', content: 'I prefer concise, brief answers. Get straight to the point.', type: 'preference' as const },
    { label: 'Detailed explanations', content: 'I prefer detailed explanations with examples and context.', type: 'preference' as const },
    { label: 'I\'m a developer', content: 'I am a software developer. Use technical terms appropriately.', type: 'fact' as const },
    { label: 'Use code examples', content: 'Always include code examples when explaining programming concepts.', type: 'instruction' as const },
    { label: 'Friendly tone', content: 'Use a friendly, conversational tone in responses.', type: 'preference' as const },
    { label: 'No fluff', content: 'Skip pleasantries and filler text. Direct answers only.', type: 'preference' as const },
  ];

  const handleQuickPref = async (pref: typeof quickPreferences[0]) => {
    setLoading(true);
    try {
      const res = await fetch('/api/teach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'memory',
          data: { type: pref.type, content: pref.content, importance: 7 },
        }),
      });
      if (res.ok) {
        onSuccess(`Preference saved: "${pref.label}"`);
      }
    } catch {
      toast.error('Failed to save preference');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim()) return;
    setLoading(true);

    try {
      const res = await fetch('/api/teach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'memory',
          data: { type, content, importance },
        }),
      });
      if (res.ok) {
        onSuccess('Memory saved successfully!');
        setContent('');
        setImportance(5);
      }
    } catch {
      toast.error('Failed to save memory');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Quick Preferences */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-xl border border-border/50 bg-card p-6"
      >
        <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold">
          <Lightbulb className="h-4 w-4 text-primary" />
          Quick Preferences
        </h3>
        <p className="mb-4 text-xs text-muted-foreground">
          One-click preferences to shape Nova&apos;s behavior instantly.
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {quickPreferences.map((pref) => (
            <button
              key={pref.label}
              onClick={() => handleQuickPref(pref)}
              disabled={loading}
              className="flex items-center gap-2 rounded-lg border border-border/50 bg-secondary/30 px-3 py-2.5 text-left text-sm hover:border-primary/30 hover:bg-primary/5 transition-all disabled:opacity-50"
            >
              <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
              {pref.label}
            </button>
          ))}
        </div>
      </motion.div>

      {/* Custom Memory */}
      <motion.form
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        onSubmit={handleSubmit}
        className="space-y-5 rounded-xl border border-border/50 bg-card p-6"
      >
        <div className="flex items-start gap-3 rounded-lg bg-primary/5 border border-primary/10 p-3">
          <Info className="h-5 w-5 text-primary mt-0.5 shrink-0" />
          <p className="text-xs text-muted-foreground">
            Memories help Nova remember important things about you. Preferences, facts, instructions, and context all help personalize responses.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Type</Label>
            <Select value={type} onValueChange={(v) => setType(v as typeof type)}>
              <SelectTrigger className="border-border/50 bg-secondary/30">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="preference">Preference</SelectItem>
                <SelectItem value="fact">Fact about me</SelectItem>
                <SelectItem value="instruction">Instruction</SelectItem>
                <SelectItem value="context">Context</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Importance: {importance}/10</Label>
            <input
              type="range"
              min="1"
              max="10"
              value={importance}
              onChange={(e) => setImportance(Number(e.target.value))}
              className="w-full accent-primary h-2 bg-secondary rounded-lg cursor-pointer"
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="teach-memory">Memory Content</Label>
          <Textarea
            id="teach-memory"
            placeholder="e.g., I work at a startup, I prefer Python over Java, My name is Alex..."
            value={content}
            onChange={(e) => setContent(e.target.value)}
            className="min-h-[100px] resize-none border-border/50 bg-secondary/30"
          />
        </div>

        <Button
          type="submit"
          disabled={!content.trim() || loading}
          className="w-full bg-primary hover:bg-primary/90 gap-2"
        >
          {loading ? (
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ repeat: Infinity, duration: 1 }}
              className="h-4 w-4 rounded-full border-2 border-primary-foreground border-t-transparent"
            />
          ) : (
            <Brain className="h-4 w-4" />
          )}
          {loading ? 'Saving...' : 'Save Memory'}
        </Button>
      </motion.form>
    </div>
  );
}
