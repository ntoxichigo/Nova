'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import { Brain, User, Copy, Check, Sparkles, GraduationCap } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Message } from '@/store/app-store';

interface MessageBubbleProps {
  message: Message;
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === 'user';
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Handle skillsUsed being a JSON string (from DB) or array (from live chat)
  let skillsUsed: string[] = [];
  if (Array.isArray(message.skillsUsed)) {
    skillsUsed = message.skillsUsed;
  } else if (typeof message.skillsUsed === 'string') {
    try {
      const parsed = JSON.parse(message.skillsUsed);
      skillsUsed = Array.isArray(parsed) ? parsed : [];
    } catch {
      skillsUsed = [];
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className={cn('flex gap-3 px-4 py-3', isUser ? 'flex-row-reverse' : 'flex-row')}
    >
      {/* Avatar */}
      <div
        className={cn(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
          isUser
            ? 'bg-primary/20'
            : 'bg-primary/15 nova-glow'
        )}
      >
        {isUser ? (
          <User className="h-4 w-4 text-primary" />
        ) : (
          <Brain className="h-4 w-4 text-primary" />
        )}
      </div>

      {/* Bubble */}
      <div className={cn('flex max-w-[80%] flex-col gap-1.5', isUser ? 'items-end' : 'items-start')}>
        <div
          className={cn(
            'relative rounded-2xl px-4 py-2.5 text-sm leading-relaxed',
            isUser
              ? 'rounded-tr-md bg-primary text-primary-foreground'
              : 'rounded-tl-md bg-secondary border border-border/50'
          )}
        >
          {isUser ? (
            <p className="whitespace-pre-wrap">{message.content}</p>
          ) : (
            <div className="markdown-content">
              <ReactMarkdown>{message.content}</ReactMarkdown>
            </div>
          )}
        </div>

        {/* Skills used badges */}
        {!isUser && skillsUsed.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {skillsUsed.map((skill, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary"
              >
                <Sparkles className="h-3 w-3" />
                {skill}
              </span>
            ))}
          </div>
        )}

        {/* Actions */}
        {!isUser && message.content && (
          <div className="flex items-center gap-1">
            <button
              onClick={handleCopy}
              className="rounded-md p-1 text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-green-400" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
          </div>
        )}
      </div>
    </motion.div>
  );
}

interface LearningSuggestionProps {
  suggestions: string[];
  onTeach: (suggestion: string) => void;
}

export function LearningSuggestions({ suggestions, onTeach }: LearningSuggestionProps) {
  if (suggestions.length === 0) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col gap-2 px-4 py-2"
    >
      <p className="text-xs text-muted-foreground flex items-center gap-1">
        <GraduationCap className="h-3.5 w-3.5" />
        Nova wants to learn more
      </p>
      <div className="flex flex-wrap gap-2">
        {suggestions.map((suggestion, i) => (
          <button
            key={i}
            onClick={() => onTeach(suggestion)}
            className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/5 px-3 py-1.5 text-xs text-primary hover:bg-primary/10 transition-colors"
          >
            <Sparkles className="h-3 w-3" />
            Teach this
            <span className="text-muted-foreground">{suggestion.length > 40 ? suggestion.slice(0, 40) + '...' : suggestion}</span>
          </button>
        ))}
      </div>
    </motion.div>
  );
}

interface TypingIndicatorProps {
  visible: boolean;
}

export function TypingIndicator({ visible }: TypingIndicatorProps) {
  if (!visible) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      className="flex gap-3 px-4 py-3"
    >
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/15 nova-glow">
        <Brain className="h-4 w-4 text-primary" />
      </div>
      <div className="flex items-center gap-1 rounded-2xl rounded-tl-md bg-secondary border border-border/50 px-4 py-3">
        <motion.div
          animate={{ opacity: [0.3, 1, 0.3] }}
          transition={{ repeat: Infinity, duration: 1.2, delay: 0 }}
          className="h-2 w-2 rounded-full bg-primary"
        />
        <motion.div
          animate={{ opacity: [0.3, 1, 0.3] }}
          transition={{ repeat: Infinity, duration: 1.2, delay: 0.2 }}
          className="h-2 w-2 rounded-full bg-primary"
        />
        <motion.div
          animate={{ opacity: [0.3, 1, 0.3] }}
          transition={{ repeat: Infinity, duration: 1.2, delay: 0.4 }}
          className="h-2 w-2 rounded-full bg-primary"
        />
      </div>
    </motion.div>
  );
}

interface WelcomeScreenProps {
  onSuggestionClick: (text: string) => void;
}

export function WelcomeScreen({ onSuggestionClick }: WelcomeScreenProps) {
  const suggestions = [
    'What skills do you have?',
    'Help me write a Python script',
    'Teach me about machine learning',
    'What can you help me with?',
  ];

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="flex flex-1 flex-col items-center justify-center gap-6 p-8"
    >
      <div className="flex flex-col items-center gap-3">
        <motion.div
          animate={{ scale: [1, 1.05, 1] }}
          transition={{ repeat: Infinity, duration: 3 }}
          className="flex h-20 w-20 items-center justify-center rounded-2xl bg-primary/10 nova-glow"
        >
          <Brain className="h-10 w-10 text-primary" />
        </motion.div>
        <h1 className="text-2xl font-bold nova-glow-text">Hello, I&apos;m Nova</h1>
        <p className="max-w-md text-center text-sm text-muted-foreground">
          Your AI assistant that learns and grows with you. Teach me skills, share knowledge, and watch me become smarter over time.
        </p>
      </div>

      <div className="grid w-full max-w-lg gap-2">
        {suggestions.map((s, i) => (
          <motion.button
            key={s}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.1 }}
            onClick={() => onSuggestionClick(s)}
            className="rounded-xl border border-border/50 bg-card px-4 py-3 text-left text-sm text-muted-foreground hover:border-primary/30 hover:bg-secondary/50 hover:text-foreground transition-all"
          >
            {s}
          </motion.button>
        ))}
      </div>
    </motion.div>
  );
}
