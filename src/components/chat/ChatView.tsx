'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Send, GraduationCap, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { MessageBubble, TypingIndicator, WelcomeScreen, LearningSuggestions } from './MessageBubble';
import { ConversationSidebar } from './ConversationSidebar';
import { useAppStore } from '@/store/app-store';
import { toast } from 'sonner';

export function ChatView() {
  const {
    messages,
    activeConversationId,
    isLoading,
    learningSuggestions,
    addMessage,
    setActiveConversationId,
    setLoading,
    setLearningSuggestions,
    setMessages,
  } = useAppStore();

  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = useCallback(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, isTyping, scrollToBottom]);

  useEffect(() => {
    if (!isLoading) {
      textareaRef.current?.focus();
    }
  }, [isLoading]);

  const sendMessage = async (text?: string) => {
    const messageText = text || input.trim();
    if (!messageText || isLoading) return;

    setInput('');
    setLoading(true);
    setIsTyping(true);

    // Add user message optimistically
    const userMessage = {
      id: `temp-${Date.now()}`,
      role: 'user' as const,
      content: messageText,
      skillsUsed: [] as string[],
      createdAt: new Date().toISOString(),
    };
    addMessage(userMessage);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: messageText,
          conversationId: activeConversationId,
        }),
      });

      if (!res.ok) {
        throw new Error('Failed to send message');
      }

      const data = await res.json();

      // Update conversation ID if this was a new conversation
      if (!activeConversationId && data.conversationId) {
        setActiveConversationId(data.conversationId);
      }

      // Remove optimistic user message and replace with real ones
      // Use setState callback to avoid stale closure race condition
      useAppStore.setState((state) => ({
        messages: [
          ...state.messages.filter((m) => m.id !== userMessage.id),
          userMessage,
          {
            id: `assistant-${Date.now()}`,
            role: 'assistant',
            content: data.message,
            skillsUsed: data.skillsUsed || [],
            createdAt: new Date().toISOString(),
          },
        ],
      }));

      setLearningSuggestions(data.learningSuggestions || []);
      setIsTyping(false);

      // Refresh conversations
      try {
        const convRes = await fetch('/api/conversations');
        if (convRes.ok) {
          useAppStore.getState().setConversations(await convRes.json());
        }
      } catch {
        // ignore
      }
    } catch (error) {
      console.error('Chat error:', error);
      toast.error('Failed to send message. Please try again.');
      setIsTyping(false);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const handleSuggestionClick = (text: string) => {
    sendMessage(text);
  };

  const handleTeach = (suggestion: string) => {
    useAppStore.getState().setActiveView('teach');
    toast.info('Navigate to Teach tab to teach Nova about this topic.');
  };

  return (
    <div className="flex h-[calc(100vh-3.5rem)] overflow-hidden">
      <ConversationSidebar />

      <div className="flex flex-1 flex-col min-w-0">
        {/* Messages Area */}
        <ScrollArea className="flex-1">
          <div ref={scrollRef} className="mx-auto max-w-3xl">
            {messages.length === 0 ? (
              <WelcomeScreen onSuggestionClick={handleSuggestionClick} />
            ) : (
              <div className="py-4">
                <AnimatePresence mode="popLayout">
                  {messages.map((message) => (
                    <MessageBubble
                      key={message.id}
                      message={message}
                      isStreaming={false}
                    />
                  ))}
                </AnimatePresence>
                <TypingIndicator visible={isTyping} />
                <AnimatePresence>
                  <LearningSuggestions
                    suggestions={learningSuggestions}
                    onTeach={handleTeach}
                  />
                </AnimatePresence>
              </div>
            )}
          </div>
        </ScrollArea>

        {/* Input Area */}
        <div className="border-t border-border/50 bg-card/50 backdrop-blur-sm p-4">
          <div className="mx-auto flex max-w-3xl items-end gap-2">
            <div className="relative flex-1">
              <Textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Message Nova..."
                disabled={isLoading}
                className="min-h-[44px] max-h-[200px] resize-none rounded-xl bg-secondary/50 border-border/50 pr-12 text-sm focus-visible:ring-primary/50"
                rows={1}
              />
            </div>
            <Button
              onClick={() => sendMessage()}
              disabled={!input.trim() || isLoading}
              size="icon"
              className="h-10 w-10 shrink-0 rounded-xl bg-primary hover:bg-primary/90 nova-glow"
            >
              <Send className="h-4 w-4" />
            </Button>
            <Button
              onClick={() => useAppStore.getState().setActiveView('teach')}
              variant="outline"
              size="icon"
              className="h-10 w-10 shrink-0 rounded-xl"
              title="Teach Nova"
            >
              <GraduationCap className="h-4 w-4" />
            </Button>
          </div>
          <p className="mx-auto mt-2 max-w-3xl text-center text-xs text-muted-foreground">
            Nova learns from your teachings. Use the Teach button to add skills and knowledge.
          </p>
        </div>
      </div>
    </div>
  );
}
