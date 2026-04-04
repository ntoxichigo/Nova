import { create } from 'zustand';

export type AppView = 'chat' | 'skills' | 'teach' | 'dashboard';

interface Message {
  id: string;
  role: string;
  content: string;
  skillsUsed: string[];
  createdAt: string;
}

interface Conversation {
  id: string;
  title: string;
  createdAt: string;
  _count?: { messages: number };
}

interface Skill {
  id: string;
  name: string;
  description: string;
  instructions: string;
  category: string;
  isActive: boolean;
  icon: string;
  createdAt: string;
  updatedAt: string;
}

interface Knowledge {
  id: string;
  topic: string;
  content: string;
  tags: string;
  source: string;
  createdAt: string;
}

interface AgentMemory {
  id: string;
  type: string;
  content: string;
  importance: number;
  accessCount: number;
  lastAccessed: string;
  createdAt: string;
}

interface AppState {
  // Navigation
  activeView: AppView;
  setActiveView: (view: AppView) => void;
  
  // Chat
  conversations: Conversation[];
  activeConversationId: string | null;
  messages: Message[];
  isLoading: boolean;
  learningSuggestions: string[];
  
  setConversations: (conversations: Conversation[]) => void;
  setActiveConversationId: (id: string | null) => void;
  setMessages: (messages: Message[]) => void;
  addMessage: (message: Message) => void;
  setLoading: (loading: boolean) => void;
  setLearningSuggestions: (suggestions: string[]) => void;
  clearChat: () => void;
  
  // Skills
  skills: Skill[];
  setSkills: (skills: Skill[]) => void;
  
  // Knowledge
  knowledge: Knowledge[];
  setKnowledge: (knowledge: Knowledge[]) => void;
  
  // Memory
  memories: AgentMemory[];
  setMemories: (memories: AgentMemory[]) => void;
  
  // Mobile sidebar
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
}

export const useAppStore = create<AppState>((set) => ({
  // Navigation
  activeView: 'chat',
  setActiveView: (view) => set({ activeView: view }),
  
  // Chat
  conversations: [],
  activeConversationId: null,
  messages: [],
  isLoading: false,
  learningSuggestions: [],
  
  setConversations: (conversations) => set({ conversations }),
  setActiveConversationId: (id) => set({ activeConversationId: id }),
  setMessages: (messages) => set({ messages }),
  addMessage: (message) => set((state) => ({ messages: [...state.messages, message] })),
  setLoading: (isLoading) => set({ isLoading }),
  setLearningSuggestions: (learningSuggestions) => set({ learningSuggestions }),
  clearChat: () => set({ messages: [], activeConversationId: null, learningSuggestions: [] }),
  
  // Skills
  skills: [],
  setSkills: (skills) => set({ skills }),
  
  // Knowledge
  knowledge: [],
  setKnowledge: (knowledge) => set({ knowledge }),
  
  // Memory
  memories: [],
  setMemories: (memories) => set({ memories }),
  
  // Mobile sidebar
  sidebarOpen: false,
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
}));
