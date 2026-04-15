'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { formatDistanceToNow, isThisWeek, isToday, isYesterday } from 'date-fns';
import { MessageSquare, MessagesSquare, Plus, Search, Trash2 } from 'lucide-react';
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
import { Badge } from '@/components/ui/badge';
import { useAppStore } from '@/store/app-store';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useShallow } from 'zustand/react/shallow';

type Conversation = {
  id: string;
  title: string;
  createdAt?: string | Date;
  _count?: { messages: number };
};

function groupConversations(conversations: Conversation[]) {
  const groups: { label: string; items: Conversation[] }[] = [
    { label: 'Today', items: [] },
    { label: 'Yesterday', items: [] },
    { label: 'This week', items: [] },
    { label: 'Older', items: [] },
  ];

  for (const conversation of conversations) {
    const date = conversation.createdAt ? new Date(conversation.createdAt) : new Date();
    if (isToday(date)) groups[0].items.push(conversation);
    else if (isYesterday(date)) groups[1].items.push(conversation);
    else if (isThisWeek(date)) groups[2].items.push(conversation);
    else groups[3].items.push(conversation);
  }

  return groups.filter((group) => group.items.length > 0);
}

export function ConversationSidebar({ variant = 'standalone' }: { variant?: 'standalone' | 'panel' }) {
  const {
    conversations,
    activeConversationId,
    clearChat,
    setActiveConversationId,
    setConversations,
    setMessages,
    sidebarOpen,
    setSidebarOpen,
  } = useAppStore(useShallow((state) => ({
    conversations: state.conversations,
    activeConversationId: state.activeConversationId,
    clearChat: state.clearChat,
    setActiveConversationId: state.setActiveConversationId,
    setConversations: state.setConversations,
    setMessages: state.setMessages,
    sidebarOpen: state.sidebarOpen,
    setSidebarOpen: state.setSidebarOpen,
  })));

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Array<{ conversationId: string; conversationTitle: string; snippet: string }>>([]);
  const [searching, setSearching] = useState(false);
  const searchAbortRef = useRef<AbortController | null>(null);
  const isPanel = variant === 'panel';

  const groups = useMemo(() => groupConversations(conversations), [conversations]);

  const loadConversations = async () => {
    try {
      const response = await fetch('/api/conversations');
      if (!response.ok) return;
      setConversations(await response.json());
    } catch {
      // Ignore sidebar refresh failures.
    }
  };

  useEffect(() => {
    void loadConversations();
  }, [activeConversationId]);

  useEffect(() => {
    const query = searchQuery.trim();
    if (!query) {
      searchAbortRef.current?.abort();
      setSearching(false);
      setSearchResults([]);
      return;
    }
    if (query.length < 2) {
      setSearching(false);
      setSearchResults([]);
      return;
    }

    const timer = window.setTimeout(async () => {
      searchAbortRef.current?.abort();
      const controller = new AbortController();
      searchAbortRef.current = controller;
      setSearching(true);
      try {
        const response = await fetch(`/api/conversations/search?q=${encodeURIComponent(query)}`, {
          signal: controller.signal,
        });
        if (!response.ok) return;
        const payload = await response.json();
        const results = Array.isArray(payload)
          ? payload
          : (Array.isArray(payload?.results) ? payload.results : []);
        setSearchResults(results);
      } catch {
        // Ignore cancelled/failed search requests.
      } finally {
        if (!controller.signal.aborted) {
          setSearching(false);
        }
      }
    }, 250);

    return () => {
      window.clearTimeout(timer);
    };
  }, [searchQuery]);

  useEffect(() => {
    return () => {
      searchAbortRef.current?.abort();
    };
  }, []);

  const handleNewChat = () => {
    clearChat();
    setSidebarOpen(false);
  };

  const handleSelectConversation = async (id: string) => {
    useAppStore.getState()._abortStream?.();
    useAppStore.getState().setAbortStream(null);
    useAppStore.getState().setLoading(false);
    setActiveConversationId(id);
    setSidebarOpen(false);

    try {
      const response = await fetch(`/api/conversations/${id}`);
      if (!response.ok) return;
      setMessages(await response.json());
    } catch {
      // Ignore message loading failures.
    }
  };

  const handleDeleteConversation = async (id: string, event: React.MouseEvent) => {
    event.stopPropagation();
    try {
      const response = await fetch(`/api/conversations/${id}`, { method: 'DELETE' });
      if (!response.ok) throw new Error('Failed to delete conversation');
      if (activeConversationId === id) clearChat();
      await loadConversations();
      toast.success('Conversation deleted');
    } catch {
      toast.error('Failed to delete conversation');
    }
  };

  const content = (
    <div className={cn(
      'flex h-full min-h-0 flex-col bg-[#e8ecdf]',
      isPanel ? '' : 'rounded-[20px] border border-black/10',
    )}>
      <div className={cn('border-b border-black/10', isPanel ? 'px-3 py-3' : 'px-4 py-4')}>
        {isPanel ? (
          <div className="flex items-center justify-between gap-3">
            <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Chats</p>
            <Badge variant="outline" className="border-black/10 bg-black/[0.02] text-slate-600">
              {conversations.length}
            </Badge>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-[16px] border border-black/10 bg-black/[0.04] text-slate-700">
                <MessagesSquare className="h-5 w-5" />
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Conversation history</p>
                <h2 className="mt-1 text-sm font-semibold text-slate-800">Recent chats</h2>
              </div>
            </div>
            <Badge variant="outline" className="border-black/10 bg-black/[0.02] text-slate-600">
              {conversations.length}
            </Badge>
          </div>
        )}

        <button
          type="button"
          onClick={handleNewChat}
          className={cn(
            'mt-3 flex w-full items-center justify-center gap-2 border px-4 py-2.5 text-sm font-medium text-slate-800 transition-all',
            isPanel
              ? 'rounded-xl border-black/10 bg-black/[0.03] hover:border-black/20 hover:bg-black/[0.05]'
              : 'rounded-[16px] border-black/10 bg-black/[0.045] hover:border-black/20 hover:bg-black/[0.06]',
          )}
        >
          <Plus className="h-4 w-4" />
          New chat
        </button>

        <div className="relative mt-3">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search conversations"
            className={cn(
              'h-10 w-full border pl-10 pr-3 text-sm text-slate-700 outline-none transition placeholder:text-slate-500',
              isPanel
                ? 'rounded-xl border-black/10 bg-[#f7f8f3] focus:border-black/20'
                : 'rounded-[14px] border-black/10 bg-[#f7f8f3] focus:border-black/20',
            )}
          />
        </div>
        {searching ? <p className="mt-2 text-xs text-slate-500">Searching conversations...</p> : null}
      </div>

      <div className={cn('scroll-container min-h-0 flex-1', isPanel ? 'px-2.5 py-3' : 'px-3 py-3')}>
        {searchQuery.trim() && searchResults.length > 0 ? (
          <div className="space-y-2">
            {searchResults.map((result, index) => (
              <button
                key={`${result.conversationId}-${index}`}
                type="button"
                onClick={() => {
                  void handleSelectConversation(result.conversationId);
                  setSearchQuery('');
                  setSearchResults([]);
                }}
                className="flex w-full flex-col gap-1 rounded-[16px] border border-black/10 bg-[#f7f8f3] px-3 py-3 text-left transition hover:border-black/15 hover:bg-black/[0.04]"
              >
                <span className="truncate text-sm font-medium text-slate-800">{result.conversationTitle}</span>
                <span className="line-clamp-2 text-xs leading-5 text-slate-400">{result.snippet}</span>
              </button>
            ))}
          </div>
        ) : groups.length === 0 ? (
          <div className="flex h-full min-h-[280px] flex-col items-center justify-center gap-3 rounded-[18px] border border-dashed border-black/10 bg-[#f7f8f3] px-6 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full border border-black/10 bg-black/[0.03] text-slate-600">
              <MessageSquare className="h-6 w-6" />
            </div>
            <div>
              <p className="text-sm font-medium text-slate-800">No chats yet</p>
              <p className="mt-1 text-xs leading-5 text-slate-400">Start a conversation to build up searchable history here.</p>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {groups.map((group) => (
              <div key={group.label}>
                <p className="px-2 text-[11px] uppercase tracking-[0.22em] text-slate-500">{group.label}</p>
                <AnimatePresence initial={false}>
                  <div className="mt-2 space-y-1.5">
                    {group.items.map((conversation) => {
                      const isActive = conversation.id === activeConversationId;
                      return (
                        <motion.div
                          key={conversation.id}
                          initial={{ opacity: 0, y: 6 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -6 }}
                          transition={{ duration: 0.14 }}
                        >
                          <div
                            role="button"
                            tabIndex={0}
                            onClick={() => void handleSelectConversation(conversation.id)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') {
                                void handleSelectConversation(conversation.id);
                              }
                            }}
                            className={cn(
                              'group relative flex items-center gap-3 border px-3 py-3 outline-none transition-all',
                              isActive
                                ? 'rounded-xl border-black/15 bg-[#d8dfd0]'
                                : 'rounded-xl border-black/10 bg-[#f7f8f3] hover:border-black/15 hover:bg-black/[0.04]',
                            )}
                          >
                            <div className={cn(
                              'flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border',
                              isActive ? 'border-black/15 bg-black/[0.045] text-slate-800' : 'border-black/10 bg-black/[0.03] text-slate-600',
                            )}>
                              <MessageSquare className="h-4 w-4" />
                            </div>

                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium text-slate-800">{conversation.title}</p>
                              <p className="mt-1 truncate text-xs text-slate-400">
                                {conversation.createdAt ? formatDistanceToNow(new Date(conversation.createdAt), { addSuffix: true }) : ''}
                                {conversation._count?.messages ? ` - ${conversation._count.messages} messages` : ''}
                              </p>
                            </div>

                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <button
                                  type="button"
                                  onClick={(event) => event.stopPropagation()}
                                  className="rounded-xl border border-transparent p-2 text-slate-500 opacity-0 transition group-hover:opacity-100 hover:border-black/10 hover:bg-black/[0.04] hover:text-slate-700"
                                  aria-label={`Delete ${conversation.title}`}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Delete conversation</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    Delete &quot;{conversation.title}&quot;? This removes the entire thread.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                                  <AlertDialogAction
                                    onClick={(event) => handleDeleteConversation(conversation.id, event as unknown as React.MouseEvent)}
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
                    })}
                  </div>
                </AnimatePresence>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  if (variant === 'panel') {
    return content;
  }

  return (
    <>
      <AnimatePresence>
        {sidebarOpen ? (
          <motion.div
            initial={{ opacity: 0, x: -24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -24 }}
            transition={{ duration: 0.18 }}
            className="fixed inset-y-4 left-4 z-50 w-[min(360px,calc(100vw-32px))] lg:hidden"
          >
            {content}
          </motion.div>
        ) : null}
      </AnimatePresence>

      <div className="hidden h-full min-h-0 w-[340px] shrink-0 lg:block">
        {content}
      </div>
    </>
  );
}


