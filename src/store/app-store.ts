import { create } from 'zustand';

export type AppView = 'chat' | 'scripts' | 'skills' | 'teach' | 'dashboard' | 'ops' | 'doctor' | 'settings';

export interface ScriptProject {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  files: ScriptFileInfo[];
  folders?: ScriptFolderInfo[];
  executions?: ScriptExecutionInfo[];
  commands?: ScriptCommandInfo[];
  messages?: ScriptIDEMessage[];
}

export interface ScriptFileInfo {
  id: string;
  path: string;
  language: string;
  content?: string;
}

export interface ScriptFolderInfo {
  id: string;
  path: string;
}

export interface ScriptExecutionInfo {
  id: string;
  fileId?: string | null;
  status: string;
  output: string;
  error: string;
  duration?: number | null;
  createdAt: string;
}

export interface ScriptCommandInfo {
  id: string;
  command: string;
  status: string;
  output: string;
  error: string;
  exitCode?: number | null;
  duration?: number | null;
  createdAt: string;
}

export interface ScriptIDEMessage {
  id: string;
  role: string;
  content: string;
  toolCalls: string;
  createdAt: string;
}

export interface AgentStep {
  id: number;
  name: string;
  skill?: string | null;
  output?: string;
  done: boolean;
}

export interface Message {
  id: string;
  role: string;
  content: string;
  skillsUsed: string[];
  toolsUsed?: string[];
  createdAt: string;
  feedback?: 1 | -1 | null;  // thumbs up/down
  dbId?: string;              // real DB id (set after stream done event)
  agentSteps?: AgentStep[];
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: string;
  _count?: { messages: number };
}

export interface Skill {
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

export interface Knowledge {
  id: string;
  topic: string;
  content: string;
  tags: string;
  source: string;
  createdAt: string;
}

export interface AgentMemory {
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
  _abortStream: (() => void) | null;
  
  setConversations: (conversations: Conversation[]) => void;
  setActiveConversationId: (id: string | null) => void;
  setMessages: (messages: Message[]) => void;
  addMessage: (message: Message) => void;
  setLoading: (loading: boolean) => void;
  setLearningSuggestions: (suggestions: string[]) => void;
  clearChat: () => void;
  deleteMessage: (id: string) => void;
  /** Register the abort function for the currently active stream. */
  setAbortStream: (fn: (() => void) | null) => void;
  
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

  // Script Editor / IDE
  projects: ScriptProject[];
  setProjects: (p: ScriptProject[]) => void;
  activeProjectId: string | null;
  setActiveProjectId: (id: string | null) => void;
  activeFileId: string | null;
  setActiveFileId: (id: string | null) => void;
  editorCode: string;
  setEditorCode: (code: string) => void;
  isExecuting: boolean;
  setIsExecuting: (v: boolean) => void;
  executionOutput: string;
  setExecutionOutput: (v: string) => void;
  appendExecutionOutput: (v: string) => void;
  clearExecutionOutput: () => void;
  projectRefreshKey: number;
  bumpProjectRefreshKey: () => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  // Navigation
  activeView: 'chat',
  setActiveView: (view) => set({ activeView: view }),
  
  // Chat
  conversations: [],
  activeConversationId: null,
  messages: [],
  isLoading: false,
  learningSuggestions: [],
  _abortStream: null,
  
  setConversations: (conversations) => set({ conversations }),
  setActiveConversationId: (id) => set({ activeConversationId: id }),
  setMessages: (messages) => set({ messages }),
  addMessage: (message) => set((state) => ({ messages: [...state.messages, message] })),
  setLoading: (isLoading) => set({ isLoading }),
  setLearningSuggestions: (learningSuggestions) => set({ learningSuggestions }),
  deleteMessage: (id) => set((state) => ({ messages: state.messages.filter((m) => m.id !== id) })),
  clearChat: () => {
    // Abort any in-flight stream before clearing
    get()._abortStream?.();
    set({ messages: [], activeConversationId: null, learningSuggestions: [], isLoading: false, _abortStream: null });
  },
  setAbortStream: (fn) => set({ _abortStream: fn }),
  
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

  // Script Editor / IDE
  projects: [],
  setProjects: (projects) => set({ projects }),
  activeProjectId: null,
  setActiveProjectId: (activeProjectId) => set({ activeProjectId }),
  activeFileId: null,
  setActiveFileId: (activeFileId) => set({ activeFileId }),
  editorCode: '',
  setEditorCode: (editorCode) => set({ editorCode }),
  isExecuting: false,
  setIsExecuting: (isExecuting) => set({ isExecuting }),
  executionOutput: '',
  setExecutionOutput: (executionOutput) => set({ executionOutput }),
  appendExecutionOutput: (line) => set((s) => ({ executionOutput: s.executionOutput + line })),
  clearExecutionOutput: () => set({ executionOutput: '' }),
  projectRefreshKey: 0,
  bumpProjectRefreshKey: () => set((state) => ({ projectRefreshKey: state.projectRefreshKey + 1 })),
}));
