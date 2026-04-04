'use client';

import { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, MessageSquare, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useAppStore } from '@/store/app-store';
import { cn } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';

export function ConversationSidebar() {
  const {
    conversations,
    activeConversationId,
    setActiveConversationId,
    clearChat,
    sidebarOpen,
    setSidebarOpen,
  } = useAppStore();

  const loadConversations = async () => {
    try {
      const res = await fetch('/api/conversations');
      if (res.ok) {
        const data = await res.json();
        useAppStore.getState().setConversations(data);
      }
    } catch (err) {
      console.error('Failed to load conversations:', err);
    }
  };

  useEffect(() => {
    loadConversations();
  }, [activeConversationId]);

  const handleNewChat = () => {
    clearChat();
    setSidebarOpen(false);
  };

  const handleSelectConversation = async (id: string) => {
    setActiveConversationId(id);
    setSidebarOpen(false);
    try {
      const res = await fetch(`/api/conversations/${id}/messages`);
      if (res.ok) {
        const messages = await res.json();
        useAppStore.getState().setMessages(messages);
      }
    } catch (err) {
      console.error('Failed to load messages:', err);
    }
  };

  const handleDeleteConversation = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await fetch(`/api/conversations/${id}`, { method: 'DELETE' });
      if (activeConversationId === id) {
        clearChat();
      }
      loadConversations();
    } catch (err) {
      console.error('Failed to delete conversation:', err);
    }
  };

  const sidebarContent = (
    <div className="flex h-full flex-col bg-card border-r border-border/50">
      <div className="flex items-center justify-between p-3 border-b border-border/50">
        <h2 className="text-sm font-semibold">Conversations</h2>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="h-7 w-7 md:hidden" onClick={() => setSidebarOpen(false)}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <div className="p-2">
        <Button
          variant="outline"
          size="sm"
          className="w-full justify-start gap-2"
          onClick={handleNewChat}
        >
          <Plus className="h-4 w-4" />
          New Chat
        </Button>
      </div>
      <ScrollArea className="flex-1 px-2">
        <div className="flex flex-col gap-1 pb-4">
          <AnimatePresence>
            {conversations.map((conv) => (
              <motion.div
                key={conv.id}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
              >
                <button
                  onClick={() => handleSelectConversation(conv.id)}
                  className={cn(
                    'group flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm transition-all hover:bg-secondary/50',
                    activeConversationId === conv.id && 'bg-secondary border border-border/50'
                  )}
                >
                  <MessageSquare className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="flex-1 min-w-0">
                    <p className="truncate font-medium">{conv.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {conv.createdAt && formatDistanceToNow(new Date(conv.createdAt), { addSuffix: true })}
                      {conv._count && ` · ${conv._count.messages} msgs`}
                    </p>
                  </div>
                  <button
                    onClick={(e) => handleDeleteConversation(conv.id, e)}
                    className="shrink-0 rounded-md p-1 opacity-0 group-hover:opacity-100 hover:bg-destructive/20 hover:text-destructive transition-all"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </button>
              </motion.div>
            ))}
          </AnimatePresence>
          {conversations.length === 0 && (
            <p className="px-3 py-6 text-center text-xs text-muted-foreground">
              No conversations yet. Start chatting!
            </p>
          )}
        </div>
      </ScrollArea>
    </div>
  );

  return (
    <>
      {/* Mobile overlay */}
      <AnimatePresence>
        {sidebarOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-40 bg-black/50 md:hidden"
              onClick={() => setSidebarOpen(false)}
            />
            <motion.div
              initial={{ x: -280 }}
              animate={{ x: 0 }}
              exit={{ x: -280 }}
              transition={{ type: 'spring', bounce: 0.15, duration: 0.4 }}
              className="fixed left-0 top-14 z-50 h-[calc(100vh-3.5rem)] w-72 md:hidden"
            >
              {sidebarContent}
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Desktop sidebar */}
      <div className="hidden md:block w-64 shrink-0 h-full">
        {sidebarContent}
      </div>
    </>
  );
}
