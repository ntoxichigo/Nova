'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Slider } from '@/components/ui/slider';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
  Settings,
  Brain,
  Globe,
  Server,
  Cpu,
  Plug,
  Cloud,
  RefreshCw,
  Download,
  Trash2,
  CheckCircle2,
  XCircle,
  Loader2,
  Info,
  Sparkles,
  Zap,
  Link2,
  Unlink,
  Github,
  FolderOpen,
  BookOpen,
  Clock,
  Rss,
  Network,
  FileText,
  Plus,
  Search,
  Star,
  ChevronDown,
  ChevronRight,
  X,
  Check,
  Filter,
} from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import type { OpenRouterModel } from '@/lib/llm/openrouter-models';
import { formatCostPer1M, formatContextLength } from '@/lib/llm/openrouter-models';
import { FEATURED_OPENROUTER_MODELS } from '@/lib/llm/featured-models';
import { XIAOMI_MODELS } from '@/lib/llm/xiaomi-models';
import { toast } from 'sonner';
import type { LLMConfig } from '@/lib/llm/types';
import { MASKED_SECRET_VALUE } from '@/lib/settings-schema';
import { useAppStore } from '@/store/app-store';

type ProviderType = LLMConfig['provider'];

interface ProviderInfo {
  id: ProviderType;
  label: string;
  description: string;
  icon: React.ReactNode;
  needsApiKey: boolean;
  defaultBaseUrl?: string;
  defaultModel?: string;
  defaultContextWindow?: number;
  defaultHistoryBudget?: number;
  defaultCompressionThreshold?: number;
  defaultRetryAttempts?: number;
  defaultQualityMode?: NonNullable<LLMConfig['qualityMode']>;
  defaultMaxTokens?: number;
  supportsTemperature: boolean;
  supportsMaxTokens: boolean;
}

const PROVIDERS: ProviderInfo[] = [
  {
    id: 'ollama',
    label: 'Ollama (Local) ★ Recommended',
    description: 'Run local models via Ollama. Free, private, no API key. Install Ollama and pull a model to get started.',
    icon: <Server className="h-4 w-4" />,
    needsApiKey: false,
    defaultBaseUrl: 'http://localhost:11434',
    defaultModel: 'llama3',
    defaultContextWindow: 32768,
    defaultHistoryBudget: 16,
    defaultCompressionThreshold: 18,
    defaultRetryAttempts: 0,
    defaultQualityMode: 'balanced',
    defaultMaxTokens: 4096,
    supportsTemperature: true,
    supportsMaxTokens: true,
  },
  {
    id: 'ollama-cloud',
    label: 'Ollama Cloud',
    description: 'Run larger models via Ollama\'s cloud service (no GPU needed). Sign in at ollama.com to get an API key, then run cloud-suffixed models like gpt-oss:120b-cloud.',
    icon: <Cloud className="h-4 w-4" />,
    needsApiKey: true,
    defaultBaseUrl: 'https://ollama.com',
    defaultModel: 'gpt-oss:120b-cloud',
    defaultContextWindow: 65536,
    defaultHistoryBudget: 20,
    defaultCompressionThreshold: 24,
    defaultRetryAttempts: 1,
    defaultQualityMode: 'high-context',
    defaultMaxTokens: 8192,
    supportsTemperature: true,
    supportsMaxTokens: true,
  },
  {
    id: 'lmstudio',
    label: 'LM Studio (Local)',
    description: 'Run local models via LM Studio. Make sure the LM Studio server is running.',
    icon: <Cpu className="h-4 w-4" />,
    needsApiKey: false,
    defaultBaseUrl: 'http://localhost:1234/v1',
    defaultModel: 'default',
    defaultContextWindow: 32768,
    defaultHistoryBudget: 14,
    defaultCompressionThreshold: 18,
    defaultRetryAttempts: 0,
    defaultQualityMode: 'local-safe',
    defaultMaxTokens: 4096,
    supportsTemperature: true,
    supportsMaxTokens: true,
  },
  {
    id: 'openai',
    label: 'OpenAI Compatible',
    description: 'Connect to OpenAI, Azure OpenAI, Groq, Together AI, or any OpenAI-compatible API.',
    icon: <Globe className="h-4 w-4" />,
    needsApiKey: true,
    defaultBaseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4.1-mini',
    defaultContextWindow: 128000,
    defaultHistoryBudget: 28,
    defaultCompressionThreshold: 32,
    defaultRetryAttempts: 1,
    defaultQualityMode: 'high-quality',
    defaultMaxTokens: 8192,
    supportsTemperature: true,
    supportsMaxTokens: true,
  },
  {
    id: 'xiaomi',
    label: 'Xiaomi MiMo',
    description: 'Official Xiaomi MiMo API. Supports MiMo V2 Pro, Flash, Omni, and TTS via an OpenAI-compatible endpoint.',
    icon: <Sparkles className="h-4 w-4" />,
    needsApiKey: true,
    defaultBaseUrl: 'https://api.xiaomimimo.com/v1',
    defaultModel: 'mimo-v2-pro',
    defaultContextWindow: 262144,
    defaultHistoryBudget: 28,
    defaultCompressionThreshold: 32,
    defaultRetryAttempts: 1,
    defaultQualityMode: 'high-context',
    defaultMaxTokens: 16384,
    supportsTemperature: true,
    supportsMaxTokens: true,
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    description: 'Access 300+ models (Claude, GPT-4, Gemini, Llama, Mistral, etc.) through one API key. Pay-per-token pricing. Get your key at openrouter.ai/keys.',
    icon: <Network className="h-4 w-4" />,
    needsApiKey: true,
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'openai/gpt-4.1-mini',
    defaultContextWindow: 128000,
    defaultHistoryBudget: 28,
    defaultCompressionThreshold: 32,
    defaultRetryAttempts: 1,
    defaultQualityMode: 'high-quality',
    defaultMaxTokens: 16384,
    supportsTemperature: true,
    supportsMaxTokens: true,
  },
  {
    id: 'custom',
    label: 'Custom Endpoint',
    description: 'Connect to any OpenAI-compatible custom endpoint with optional API key.',
    icon: <Plug className="h-4 w-4" />,
    needsApiKey: false,
    defaultBaseUrl: 'http://localhost:8080',
    defaultModel: 'default',
    defaultContextWindow: 65536,
    defaultHistoryBudget: 18,
    defaultCompressionThreshold: 22,
    defaultRetryAttempts: 1,
    defaultQualityMode: 'balanced',
    defaultMaxTokens: 4096,
    supportsTemperature: true,
    supportsMaxTokens: true,
  },
  {
    id: 'z-ai',
    label: 'Z-AI (Built-in)',
    description: 'Default built-in AI provider. No configuration needed. Works out of the box.',
    icon: <Brain className="h-4 w-4" />,
    needsApiKey: false,
    defaultContextWindow: 128000,
    defaultHistoryBudget: 28,
    defaultCompressionThreshold: 32,
    defaultRetryAttempts: 1,
    defaultQualityMode: 'high-quality',
    defaultMaxTokens: 8192,
    supportsTemperature: false,
    supportsMaxTokens: false,
  },
];

interface ConnectionInfo {
  id: string;
  service: string;
  meta?: { login?: string; name?: string; email?: string; avatar?: string; picture?: string };
}

const OPERATING_PROFILES = [
  {
    id: 'complete',
    label: 'Complete',
    description: 'Balanced default: strong IDE flow, guarded runtime, routed specialists, and assisted automation.',
  },
  {
    id: 'studio',
    label: 'Studio',
    description: 'Best for building inside the IDE while keeping automation conservative.',
  },
  {
    id: 'guarded',
    label: 'Guarded',
    description: 'Best for trust-first operation with tighter approvals and more conservative power.',
  },
  {
    id: 'autonomous',
    label: 'Autonomous',
    description: 'Best for operators who want stronger follow-through and recurring background work.',
  },
] as const;

export function SettingsView() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string; details?: string } | null>(null);
  const [exporting, setExporting] = useState(false);
  const [ollamaModels, setOllamaModels] = useState<{ name: string; size?: string; paramSize?: string }[]>([]);
  const [ollamaConnected, setOllamaConnected] = useState(false);

  // LLM Config
  const [provider, setProvider] = useState<ProviderType>('z-ai');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [temperature, setTemperature] = useState(0.7);
  const [maxTokens, setMaxTokens] = useState(2048);
  const [contextWindow, setContextWindow] = useState(32768);
  const [historyBudget, setHistoryBudget] = useState(16);
  const [compressionThreshold, setCompressionThreshold] = useState(18);
  const [retryAttempts, setRetryAttempts] = useState(1);
  const [qualityMode, setQualityMode] = useState<NonNullable<LLMConfig['qualityMode']>>('balanced');
  const [chatPowerMode, setChatPowerMode] = useState<'safe' | 'builder' | 'power'>('builder');
  const [chatPermissionMode, setChatPermissionMode] = useState<'always_ask' | 'ask_risky' | 'autopilot'>('always_ask');
  const [chatMcpAllowlist, setChatMcpAllowlist] = useState('');
  const [autonomyProfile, setAutonomyProfile] = useState<'safe' | 'builder' | 'hands-free' | 'reviewer' | 'research'>('builder');
  const [routerEnabled, setRouterEnabled] = useState(true);
  const [scopedAgentsEnabled, setScopedAgentsEnabled] = useState(true);
  const [tokenTelemetryEnabled, setTokenTelemetryEnabled] = useState(true);
  const [plannerModel, setPlannerModel] = useState('');
  const [coderModel, setCoderModel] = useState('');
  const [verifierModel, setVerifierModel] = useState('');
  const [researchModel, setResearchModel] = useState('');

  // Agent Settings
  const [agentName, setAgentName] = useState('Nova');
  const [agentPersonality, setAgentPersonality] = useState('');

  // Workspace
  const [workspaceRoot, setWorkspaceRoot] = useState('');
  const [operatingProfile, setOperatingProfile] = useState<'complete' | 'studio' | 'guarded' | 'autonomous'>('complete');
  const [automationMode, setAutomationMode] = useState<'manual' | 'assisted' | 'always_on'>('assisted');
  const [applyingOperatingPreset, setApplyingOperatingPreset] = useState<string | null>(null);

  // Connections
  const [connections, setConnections] = useState<ConnectionInfo[]>([]);
  const [githubToken, setGithubToken] = useState('');
  const [googleToken, setGoogleToken] = useState('');
  const [connectingService, setConnectingService] = useState<string | null>(null);
  const [disconnectingService, setDisconnectingService] = useState<string | null>(null);

  // Telegram
  const [telegramBotToken, setTelegramBotToken] = useState('');
  const [telegramPublicUrl, setTelegramPublicUrl] = useState('');
  const [registeringWebhook, setRegisteringWebhook] = useState(false);

  // Ollama model management
  const [pullModelName, setPullModelName] = useState('');
  const [pullingModel, setPullingModel] = useState(false);
  const [pullStatus, setPullStatus] = useState('');
  const [deletingModel, setDeletingModel] = useState<string | null>(null);

  // ── Prompt Library ──────────────────────────────────────────────────────
  const [prompts, setPrompts] = useState<Array<{ id: string; name: string; content: string; category: string; isDefault: boolean; usageCount: number }>>([]);
  const [newPromptName, setNewPromptName] = useState('');
  const [newPromptContent, setNewPromptContent] = useState('');
  const [newPromptCategory, setNewPromptCategory] = useState('');

  // ── Scheduled Tasks ─────────────────────────────────────────────────────
  const [tasks, setTasks] = useState<Array<{ id: string; name: string; prompt: string; cronExpr: string; enabled: boolean; channel: string; lastRunAt?: string; lastResult?: string }>>([]);
  const [newTaskName, setNewTaskName] = useState('');
  const [newTaskPrompt, setNewTaskPrompt] = useState('');
  const [newTaskCron, setNewTaskCron] = useState('0 9 * * *');
  const [runningTask, setRunningTask] = useState<string | null>(null);

  // ── MCP Servers ─────────────────────────────────────────────────────────
  const [mcpServers, setMcpServers] = useState<Array<{ id: string; name: string; transport: string; command: string; url: string; enabled: boolean; toolCount: number }>>([]);
  const [newMcpName, setNewMcpName] = useState('');
  const [newMcpTransport, setNewMcpTransport] = useState<'stdio' | 'sse'>('stdio');
  const [newMcpCommand, setNewMcpCommand] = useState('');
  const [newMcpUrl, setNewMcpUrl] = useState('');

  // ── RSS Feeds ───────────────────────────────────────────────────────────
  const [rssFeeds, setRssFeeds] = useState<Array<{ id: string; name: string; url: string; enabled: boolean; itemCount: number; lastFetchAt?: string }>>([]);
  const [newRssName, setNewRssName] = useState('');
  const [newRssUrl, setNewRssUrl] = useState('');
  const [fetchingRss, setFetchingRss] = useState(false);

  // ── Fine-tune export ────────────────────────────────────────────────────
  const [exportingFinetune, setExportingFinetune] = useState(false);

  // ── OpenRouter Model Browser ─────────────────────────────────────────────
  const [orBrowserOpen, setOrBrowserOpen] = useState(false);
  const [orModels, setOrModels] = useState<OpenRouterModel[]>([]);
  const [orLoading, setOrLoading] = useState(false);
  const [orError, setOrError] = useState<string | null>(null);
  const [orSearch, setOrSearch] = useState('');
  const [orActiveTab, setOrActiveTab] = useState('search');
  const [orCapabilities, setOrCapabilities] = useState<Set<string>>(new Set());
  const [orExpandedProviders, setOrExpandedProviders] = useState<Set<string>>(new Set());

  const currentProviderInfo = PROVIDERS.find((p) => p.id === provider) || PROVIDERS[0];

  const fetchOllamaModels = useCallback(async (customBaseUrl?: string, customApiKey?: string) => {
    try {
      const params = new URLSearchParams();
      if (customBaseUrl) params.set('baseUrl', customBaseUrl);
      if (customApiKey) params.set('apiKey', customApiKey);
      const qs = params.toString();
      const url = qs ? `/api/ollama/models?${qs}` : '/api/ollama/models';
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        setOllamaModels(data.models || []);
        setOllamaConnected(data.connected || false);
      }
    } catch { /* ignore */ }
  }, []);

  const handlePullModel = async () => {
    if (!pullModelName.trim() || pullingModel) return;
    setPullingModel(true);
    setPullStatus('Starting pull…');
    try {
      const res = await fetch('/api/ollama/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: pullModelName.trim() }),
      });
      if (!res.ok || !res.body) throw new Error('Pull failed');
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          const t = line.replace(/^data:\s*/, '').trim();
          if (!t) continue;
          try {
            const obj = JSON.parse(t) as { status?: string; total?: number; completed?: number };
            const pct = obj.total && obj.completed ? ` ${Math.round((obj.completed / obj.total) * 100)}%` : '';
            setPullStatus((obj.status || '') + pct);
            if (obj.status === 'success') {
              toast.success(`Model "${pullModelName}" pulled`);
              setPullModelName('');
              fetchOllamaModels();
            }
          } catch { /* */ }
        }
      }
    } catch (e) {
      toast.error('Pull failed: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setPullingModel(false);
      setPullStatus('');
    }
  };

  const handleDeleteModel = async (name: string) => {
    if (!confirm(`Delete model "${name}"? This cannot be undone.`)) return;
    setDeletingModel(name);
    try {
      const res = await fetch('/api/ollama/models', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error('Delete failed');
      toast.success(`Model "${name}" deleted`);
      setOllamaModels((prev) => prev.filter((m) => m.name !== name));
    } catch (e) {
      toast.error('Delete failed: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setDeletingModel(null);
    }
  };

  const loadSettings = useCallback(async () => {
    try {
      const res = await fetch('/api/settings');
      if (res.ok) {
        const settings = await res.json();
        setProvider(settings.llm_provider || 'z-ai');
        // Set to masked sentinel when a key exists — save logic skips it (preserves DB value)
        // Only update if the field actually changed (new value vs current masked state)
        setApiKey(settings.llm_api_key || '');
        setBaseUrl(settings.llm_base_url || '');
        setModel(settings.llm_model || '');
        setTemperature(settings.llm_temperature ? parseFloat(settings.llm_temperature) : 0.7);
        setMaxTokens(settings.llm_max_tokens ? parseInt(settings.llm_max_tokens, 10) : 2048);
        setContextWindow(settings.llm_context_window ? parseInt(settings.llm_context_window, 10) : 32768);
        setHistoryBudget(settings.llm_history_budget ? parseInt(settings.llm_history_budget, 10) : 16);
        setCompressionThreshold(settings.llm_compression_threshold ? parseInt(settings.llm_compression_threshold, 10) : 18);
        setRetryAttempts(settings.llm_retry_attempts ? parseInt(settings.llm_retry_attempts, 10) : 1);
        setQualityMode((settings.llm_quality_mode as NonNullable<LLMConfig['qualityMode']>) || 'balanced');
        setChatPowerMode((settings.chat_power_mode as 'safe' | 'builder' | 'power') || 'builder');
        setChatPermissionMode((settings.chat_permission_mode as 'always_ask' | 'ask_risky' | 'autopilot') || 'always_ask');
        setChatMcpAllowlist(settings.chat_mcp_allowlist || '');
        setOperatingProfile(
          ((settings.nova_operating_profile ?? settings.ntox_operating_profile) as 'complete' | 'studio' | 'guarded' | 'autonomous') ||
            'complete'
        );
        setAutomationMode(
          ((settings.nova_automation_mode ?? settings.ntox_automation_mode) as 'manual' | 'assisted' | 'always_on') || 'assisted'
        );
        setAutonomyProfile((settings.agent_autonomy_profile as 'safe' | 'builder' | 'hands-free' | 'reviewer' | 'research') || 'builder');
        setRouterEnabled(String(settings.llm_router_enabled || 'true').toLowerCase() !== 'false');
        setScopedAgentsEnabled(String(settings.llm_scoped_agents_enabled || 'true').toLowerCase() !== 'false');
        setTokenTelemetryEnabled(String(settings.llm_token_telemetry_enabled || 'true').toLowerCase() !== 'false');
        setPlannerModel(settings.llm_planner_model || '');
        setCoderModel(settings.llm_coder_model || '');
        setVerifierModel(settings.llm_verifier_model || '');
        setResearchModel(settings.llm_research_model || '');
        setAgentName(settings.agent_name || 'Nova');
        setAgentPersonality(settings.agent_personality || '');
        setWorkspaceRoot(settings.workspace_root || '');
        setTelegramBotToken(settings.telegram_bot_token || '');
        setTelegramPublicUrl(settings.telegram_public_url || '');
      }
    } catch (err) {
      console.error('Failed to load settings:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchConnections = useCallback(async () => {
    try {
      const res = await fetch('/api/connections');
      if (res.ok) {
        const data: ConnectionInfo[] = await res.json();
        setConnections(data);
      }
    } catch { /* ignore */ }
  }, []);

  const fetchPrompts = useCallback(async () => {
    try {
      const res = await fetch('/api/prompts');
      if (res.ok) setPrompts(await res.json());
    } catch { /* ignore */ }
  }, []);

  const fetchTasks = useCallback(async () => {
    try {
      const res = await fetch('/api/scheduled-tasks');
      if (res.ok) setTasks(await res.json());
    } catch { /* ignore */ }
  }, []);

  const fetchMcpServers = useCallback(async () => {
    try {
      const res = await fetch('/api/mcp/servers');
      if (res.ok) setMcpServers(await res.json());
    } catch { /* ignore */ }
  }, []);

  const fetchRssFeeds = useCallback(async () => {
    try {
      const res = await fetch('/api/rss/feeds');
      if (res.ok) setRssFeeds(await res.json());
    } catch { /* ignore */ }
  }, []);

  const handleConnect = async (service: 'github' | 'google') => {
    const token = service === 'github' ? githubToken.trim() : googleToken.trim();
    if (!token) { toast.error('Please enter an access token'); return; }
    setConnectingService(service);
    try {
      const res = await fetch('/api/connections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ service, accessToken: token }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to connect');
      toast.success(`${service === 'github' ? 'GitHub' : 'Google'} connected!`);
      if (service === 'github') setGithubToken('');
      else setGoogleToken('');
      await fetchConnections();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setConnectingService(null);
    }
  };

  const handleDisconnect = async (service: string) => {
    setDisconnectingService(service);
    try {
      const res = await fetch(`/api/connections?service=${service}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to disconnect');
      toast.success(`${service} disconnected`);
      await fetchConnections();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Disconnect failed');
    } finally {
      setDisconnectingService(null);
    }
  };

  const handleRegisterWebhook = async () => {
    if (!telegramBotToken.trim() || !telegramPublicUrl.trim()) {
      toast.error('Enter both a bot token and your public URL');
      return;
    }
    setRegisteringWebhook(true);
    try {
      const secret = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
      await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          telegram_bot_token: telegramBotToken,
          telegram_public_url: telegramPublicUrl,
          telegram_webhook_secret: secret,
        }),
      });
      const webhookUrl = `${telegramPublicUrl.replace(/\/$/, '')}/api/telegram/webhook`;
      const res = await fetch(`https://api.telegram.org/bot${telegramBotToken}/setWebhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: webhookUrl, secret_token: secret, allowed_updates: ['message', 'edited_message'] }),
      });
      const data = await res.json();
      if (data.ok) {
        toast.success('Telegram webhook registered! Message your bot to test.');
      } else {
        toast.error(`Telegram: ${data.description || 'Failed to register webhook'}`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setRegisteringWebhook(false);
    }
  };

  // ── Prompt Library handlers ─────────────────────────────────────────────
  const handleAddPrompt = async () => {
    if (!newPromptName.trim() || !newPromptContent.trim()) return;
    try {
      const res = await fetch('/api/prompts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newPromptName, content: newPromptContent, category: newPromptCategory || 'general' }),
      });
      if (res.ok) {
        setNewPromptName(''); setNewPromptContent(''); setNewPromptCategory('');
        fetchPrompts();
        toast.success('Prompt saved');
      }
    } catch { toast.error('Failed to save prompt'); }
  };
  const handleDeletePrompt = async (id: string) => {
    await fetch(`/api/prompts?id=${id}`, { method: 'DELETE' });
    fetchPrompts();
  };

  // ── Scheduled Tasks handlers ────────────────────────────────────────────
  const handleAddTask = async () => {
    if (!newTaskName.trim() || !newTaskPrompt.trim()) return;
    try {
      const res = await fetch('/api/scheduled-tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newTaskName, prompt: newTaskPrompt, cronExpr: newTaskCron }),
      });
      if (res.ok) {
        setNewTaskName(''); setNewTaskPrompt(''); setNewTaskCron('0 9 * * *');
        fetchTasks();
        toast.success('Task created');
      }
    } catch { toast.error('Failed to create task'); }
  };
  const handleRunTask = async (id: string) => {
    setRunningTask(id);
    try {
      const res = await fetch('/api/scheduled-tasks/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
      const data = await res.json();
      toast.success(data.result ? 'Task ran: ' + data.result.slice(0, 80) : 'Task executed');
      fetchTasks();
    } catch { toast.error('Task failed'); }
    finally { setRunningTask(null); }
  };
  const handleDeleteTask = async (id: string) => {
    await fetch(`/api/scheduled-tasks?id=${id}`, { method: 'DELETE' });
    fetchTasks();
  };

  // ── MCP Server handlers ────────────────────────────────────────────────
  const handleAddMcp = async () => {
    if (!newMcpName.trim()) return;
    try {
      const res = await fetch('/api/mcp/servers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newMcpName, transport: newMcpTransport, command: newMcpCommand, url: newMcpUrl }),
      });
      if (res.ok) {
        setNewMcpName(''); setNewMcpCommand(''); setNewMcpUrl('');
        fetchMcpServers();
        toast.success('MCP server added');
      }
    } catch { toast.error('Failed to add MCP server'); }
  };
  const handleDeleteMcp = async (id: string) => {
    await fetch(`/api/mcp/servers?id=${id}`, { method: 'DELETE' });
    fetchMcpServers();
  };

  // ── RSS Feed handlers ──────────────────────────────────────────────────
  const handleAddRss = async () => {
    if (!newRssName.trim() || !newRssUrl.trim()) return;
    try {
      const res = await fetch('/api/rss/feeds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newRssName, url: newRssUrl }),
      });
      if (res.ok) {
        setNewRssName(''); setNewRssUrl('');
        fetchRssFeeds();
        toast.success('RSS feed added');
      } else {
        const data = await res.json();
        toast.error(data.error || 'Failed');
      }
    } catch { toast.error('Failed to add feed'); }
  };
  const handleFetchRss = async () => {
    setFetchingRss(true);
    try {
      const res = await fetch('/api/rss/feeds/fetch', { method: 'POST' });
      const data = await res.json();
      const total = data.results?.reduce((s: number, r: { newItems: number }) => s + r.newItems, 0) || 0;
      toast.success(`Fetched ${total} new items`);
      fetchRssFeeds();
    } catch { toast.error('Fetch failed'); }
    finally { setFetchingRss(false); }
  };
  const handleDeleteRss = async (id: string) => {
    await fetch(`/api/rss/feeds?id=${id}`, { method: 'DELETE' });
    fetchRssFeeds();
  };

  // ── OpenRouter model browser fetch ────────────────────────────────────
  const fetchOrModels = useCallback(async (force = false) => {
    if ((orLoading || orModels.length > 0) && !force) return;
    setOrLoading(true);
    setOrError(null);
    try {
      const res = await fetch('/api/llm/openrouter-models');
      const data = await res.json() as { models?: OpenRouterModel[]; error?: { message: string } };
      if (data.error) {
        setOrError(data.error.message);
      } else {
        setOrModels(data.models ?? []);
      }
    } catch {
      setOrError('Network error loading OpenRouter models. Check your connection.');
    } finally {
      setOrLoading(false);
    }
  }, [orLoading, orModels.length]);

  // ── Fine-tune export handler ───────────────────────────────────────────
  const handleFinetuneExport = async () => {
    setExportingFinetune(true);
    try {
      const res = await fetch('/api/export/finetune');
      if (!res.ok) throw new Error('Export failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `nova-finetune-${new Date().toISOString().slice(0, 10)}.jsonl`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Fine-tune JSONL exported');
    } catch { toast.error('Export failed'); }
    finally { setExportingFinetune(false); }
  };

  useEffect(() => {
    loadSettings();
    fetchConnections();
    fetchPrompts();
    fetchTasks();
    fetchMcpServers();
    fetchRssFeeds();
  }, [loadSettings, fetchConnections, fetchPrompts, fetchTasks, fetchMcpServers, fetchRssFeeds]);

  // Auto-probe Ollama on mount
  useEffect(() => {
    fetchOllamaModels();
  }, [fetchOllamaModels]);

  const handleProviderChange = (newProvider: ProviderType) => {
    setProvider(newProvider);
    setTestResult(null);
    const pInfo = PROVIDERS.find((p) => p.id === newProvider);
    if (pInfo) {
      setBaseUrl(pInfo.defaultBaseUrl || '');
      setModel(pInfo.defaultModel || '');
      setContextWindow(pInfo.defaultContextWindow || 32768);
      setHistoryBudget(pInfo.defaultHistoryBudget || 16);
      setCompressionThreshold(pInfo.defaultCompressionThreshold || 18);
      setRetryAttempts(pInfo.defaultRetryAttempts ?? 1);
      setQualityMode(pInfo.defaultQualityMode || 'balanced');
      setMaxTokens(pInfo.defaultMaxTokens ?? 2048);
      // Don't clear API key unless switching TO z-ai (which doesn't need one)
      if (newProvider === 'z-ai') {
        setApiKey('');
      }
    }
    if (newProvider === 'ollama') {
      fetchOllamaModels(pInfo?.defaultBaseUrl);
    }
    if (newProvider === 'ollama-cloud') {
      fetchOllamaModels('https://ollama.com', apiKey);
    }
  };

  const handleApplyOperatingPreset = async (presetId: 'complete' | 'studio' | 'guarded' | 'autonomous') => {
    setApplyingOperatingPreset(presetId);
    try {
      const res = await fetch('/api/operating-system', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ presetId }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.error || 'Failed to apply operating profile');
      }
      toast.success(`Applied ${presetId} operating profile`);
      await loadSettings();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to apply operating profile');
    } finally {
      setApplyingOperatingPreset(null);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    // Don't send masked sentinel values back to the server
    const safeApiKey = apiKey === MASKED_SECRET_VALUE ? undefined : apiKey;
    const safeTelegramToken = telegramBotToken === MASKED_SECRET_VALUE ? undefined : telegramBotToken;
    try {
      const payload = {
        llm_provider: provider,
        ...(safeApiKey !== undefined && { llm_api_key: safeApiKey }),
        llm_base_url: baseUrl,
        llm_model: model,
        llm_temperature: String(temperature),
        llm_max_tokens: String(maxTokens),
        llm_context_window: String(contextWindow),
        llm_history_budget: String(historyBudget),
        llm_compression_threshold: String(compressionThreshold),
        llm_retry_attempts: String(retryAttempts),
        llm_quality_mode: qualityMode,
        chat_power_mode: chatPowerMode,
        chat_permission_mode: chatPermissionMode,
        chat_mcp_allowlist: chatMcpAllowlist,
        nova_operating_profile: operatingProfile,
        nova_automation_mode: automationMode,
        agent_autonomy_profile: autonomyProfile,
        llm_router_enabled: String(routerEnabled),
        llm_scoped_agents_enabled: String(scopedAgentsEnabled),
        llm_token_telemetry_enabled: String(tokenTelemetryEnabled),
        llm_planner_model: plannerModel,
        llm_coder_model: coderModel,
        llm_verifier_model: verifierModel,
        llm_research_model: researchModel,
        agent_name: agentName,
        agent_personality: agentPersonality,
        workspace_root: workspaceRoot,
        ...(safeTelegramToken !== undefined && { telegram_bot_token: safeTelegramToken }),
        telegram_public_url: telegramPublicUrl,
      };
      console.log('[Settings] Saving with payload:', { ...payload, llm_api_key: safeApiKey ? '***MASKED***' : undefined });
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        console.log('[Settings] Save successful');
        toast.success('Settings saved successfully');
      } else {
        const errBody = await res.json().catch(() => ({})) as { error?: string };
        const detail = errBody?.error || `HTTP ${res.status}`;
        console.error('[Settings] Save failed with status:', res.status, detail);
        toast.error(`Failed to save settings: ${detail}`);
      }
    } catch (err) {
      console.error('[Settings] Save error:', err);
      toast.error('Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const handleTestConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      // Save settings first, then test
      const safeApiKey = apiKey === MASKED_SECRET_VALUE ? undefined : apiKey;
      const savePayload = {
        llm_provider: provider,
        ...(safeApiKey !== undefined && { llm_api_key: safeApiKey }),
        llm_base_url: baseUrl,
        llm_model: model,
        llm_temperature: String(temperature),
        llm_max_tokens: String(maxTokens),
        llm_context_window: String(contextWindow),
        llm_history_budget: String(historyBudget),
        llm_compression_threshold: String(compressionThreshold),
        llm_retry_attempts: String(retryAttempts),
        llm_quality_mode: qualityMode,
        chat_power_mode: chatPowerMode,
        chat_permission_mode: chatPermissionMode,
        chat_mcp_allowlist: chatMcpAllowlist,
        nova_operating_profile: operatingProfile,
        nova_automation_mode: automationMode,
        agent_autonomy_profile: autonomyProfile,
        llm_router_enabled: String(routerEnabled),
        llm_scoped_agents_enabled: String(scopedAgentsEnabled),
        llm_token_telemetry_enabled: String(tokenTelemetryEnabled),
        llm_planner_model: plannerModel,
        llm_coder_model: coderModel,
        llm_verifier_model: verifierModel,
        llm_research_model: researchModel,
      };
      const saveRes = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(savePayload),
      });

      if (!saveRes.ok) {
        const errData = await saveRes.json().catch(() => null);
        throw new Error(errData?.error || 'Failed to save settings before testing');
      }

      const res = await fetch('/api/settings/test-llm', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        const resolvedModel = typeof data.resolvedModel === 'string' ? data.resolvedModel.trim() : '';
        if (resolvedModel && resolvedModel !== model) {
          setModel(resolvedModel);
        }
        const detailParts = [
          data.model ? `model ${data.model}` : null,
          data.latencyMs ? `${data.latencyMs} ms` : null,
          data.capabilities?.defaultContextWindow ? `${data.capabilities.defaultContextWindow.toLocaleString()} ctx` : null,
          data.modelProfile?.reliability ? `${data.modelProfile.reliability} profile` : null,
          data.appliedConfig?.maxTokens ? `${data.appliedConfig.maxTokens.toLocaleString()} max out` : null,
          data.modelAutoUpdated ? 'model auto-synced' : null,
        ].filter(Boolean);
        setTestResult({
          success: true,
          message: `Provider reachable: ${data.provider}`,
          details: detailParts.join(' · '),
        });
        toast.success('LLM connection successful!');
      } else {
        setTestResult({ success: false, message: data.message || data.error || 'Connection failed' });
        toast.error('LLM connection failed');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to test connection';
      setTestResult({ success: false, message });
      toast.error(message);
    } finally {
      setTesting(false);
    }
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const [skillsRes, knowledgeRes, memoryRes, conversationsRes] = await Promise.all([
        fetch('/api/skills'),
        fetch('/api/knowledge'),
        fetch('/api/memory'),
        fetch('/api/conversations'),
      ]);
      const data = {
        skills: skillsRes.ok ? await skillsRes.json() : [],
        knowledge: knowledgeRes.ok ? await knowledgeRes.json() : [],
        memories: memoryRes.ok ? await memoryRes.json() : [],
        conversations: conversationsRes.ok ? await conversationsRes.json() : [],
        exportedAt: new Date().toISOString(),
      };
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `nova-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Data exported successfully');
    } catch {
      toast.error('Failed to export data');
    } finally {
      setExporting(false);
    }
  };

  const handleClearAll = async () => {
    try {
      const res = await fetch('/api/data/reset', { method: 'POST' });
      if (!res.ok) throw new Error('Failed to clear data');
      toast.success('All data cleared successfully');
      // Reset store state
      const store = useAppStore.getState();
      store.setSkills([]);
      store.setKnowledge([]);
      store.setMemories([]);
      store.setConversations([]);
      store.clearChat();
    } catch {
      toast.error('Failed to clear all data');
    }
  };

  const handleResetMemory = async () => {
    try {
      const res = await fetch('/api/memory?scope=all', { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to reset memory');
      toast.success('Memory reset successfully');
      const store = useAppStore.getState();
      store.setMemories([]);
    } catch {
      toast.error('Failed to reset memory');
    }
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-4xl p-6 space-y-6">
        <div className="animate-pulse space-y-6">
          <div className="h-10 w-48 rounded-lg bg-secondary/30" />
          <div className="h-64 rounded-xl bg-secondary/30" />
          <div className="h-48 rounded-xl bg-secondary/30" />
        </div>
      </div>
    );
  }

  return (
    <>
    <div className="h-full min-h-0 overflow-y-auto overflow-x-hidden" style={{ WebkitOverflowScrolling: 'touch' }}>
    <div className="mx-auto max-w-4xl p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <Settings className="h-6 w-6 text-primary" />
            Settings
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Configure Nova&apos;s LLM provider, agent behavior, and manage data.
          </p>
        </div>
          <Button onClick={handleSave} disabled={saving} className="gap-2 nova-glow">
          {saving ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <CheckCircle2 className="h-4 w-4" />
          )}
          Save Settings
        </Button>
      </div>

      {/* LLM Provider Section */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
      >
        <Card className="border-border/50 bg-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Brain className="h-4 w-4 text-primary" />
              LLM Provider
            </CardTitle>
            <CardDescription>
              Choose the AI provider that powers Nova. The built-in provider works out of the box.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Provider selector */}
            <div className="space-y-2">
              <Label>Provider</Label>
              <Select value={provider} onValueChange={(v) => handleProviderChange(v as ProviderType)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROVIDERS.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      <span className="flex items-center gap-2">
                        {p.icon}
                        {p.label}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Provider info */}
            <div className="flex items-start gap-3 rounded-lg border border-primary/20 bg-primary/5 p-4">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <div>
                <p className="text-sm font-medium">{currentProviderInfo.label}</p>
                <p className="mt-1 text-xs text-muted-foreground">{currentProviderInfo.description}</p>
              </div>
            </div>

            {/* Provider-specific fields */}
            {provider !== 'z-ai' && (
              <div className="space-y-4 rounded-lg border border-border/50 bg-secondary/20 p-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  {currentProviderInfo.needsApiKey && (
                    <div className="space-y-2 sm:col-span-2">
                      <div className="flex items-center justify-between">
                        <Label htmlFor="apiKey">API Key</Label>
                        {apiKey === MASKED_SECRET_VALUE && (
                          <span className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1">
                            <CheckCircle2 className="h-3 w-3" /> Set
                          </span>
                        )}
                      </div>
                      <Input
                        id="apiKey"
                        type="password"
                        placeholder={provider === 'ollama-cloud' ? 'ollama_...' : provider === 'xiaomi' ? 'mimo_...' : 'sk-...'}
                        value={apiKey}
                        onChange={(e) => {
                          setApiKey(e.target.value);
                          if (provider === 'ollama-cloud' && e.target.value.length > 10) {
                            fetchOllamaModels('https://ollama.com', e.target.value);
                          }
                        }}
                      />
                    </div>
                  )}

                  {provider !== 'ollama-cloud' && (
                  <div className="space-y-2">
                    <Label htmlFor="baseUrl">Base URL</Label>
                    <Input
                      id="baseUrl"
                      placeholder={currentProviderInfo.defaultBaseUrl}
                      value={baseUrl}
                      onChange={(e) => {
                        setBaseUrl(e.target.value);
                        if (provider === 'ollama') fetchOllamaModels(e.target.value);
                      }}
                    />
                  </div>
                  )}

                  <div className="space-y-2">
                    <Label htmlFor="model">Model</Label>
                    {(provider === 'ollama' || provider === 'ollama-cloud') && ollamaModels.length > 0 ? (
                      <Select value={model} onValueChange={setModel}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select a model" />
                        </SelectTrigger>
                        <SelectContent>
                          {ollamaModels.map((m) => (
                            <SelectItem key={m.name} value={m.name}>
                              <span className="flex items-center gap-2">
                                <span>{m.name}</span>
                                {m.paramSize && <Badge variant="outline" className="text-xs">{m.paramSize}</Badge>}
                                {m.size && <span className="text-xs text-muted-foreground">{m.size}</span>}
                              </span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : provider === 'xiaomi' ? (
                      <Select value={model} onValueChange={setModel}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select a MiMo model" />
                        </SelectTrigger>
                        <SelectContent>
                          {XIAOMI_MODELS.map((m) => (
                            <SelectItem key={m.id} value={m.id}>
                              <span className="flex items-center gap-2">
                                <span>{m.name}</span>
                                <Badge variant="outline" className="text-xs">
                                  {m.contextLength >= 1000000 ? '1M ctx' : `${Math.round(m.contextLength / 1024)}K ctx`}
                                </Badge>
                              </span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : provider === 'openrouter' ? (
                      <div className="space-y-2">
                        {model && (
                          <div className="flex items-center gap-2 rounded-md border border-border/50 bg-secondary/30 px-3 py-2 text-sm">
                            <Network className="h-3.5 w-3.5 text-primary shrink-0" />
                            <span className="truncate font-mono text-xs flex-1">{model}</span>
                            <button
                              onClick={() => setModel('')}
                              className="text-muted-foreground hover:text-foreground transition-colors"
                              title="Clear model selection"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        )}
                        <Button
                          variant="outline"
                          size="sm"
                          className="w-full gap-2"
                          onClick={() => {
                            setOrBrowserOpen(true);
                            fetchOrModels();
                          }}
                        >
                          <Search className="h-3.5 w-3.5" />
                          Browse 500+ Models
                        </Button>
                        {!model && (
                          <p className="text-xs text-muted-foreground">
                            Click above to search models by name, provider, cost, or capability.
                          </p>
                        )}
                      </div>
                    ) : (
                      <Input
                        id="model"
                        placeholder={currentProviderInfo.defaultModel}
                        value={model}
                        onChange={(e) => setModel(e.target.value)}
                      />
                    )}
                    {provider === 'ollama' && !ollamaConnected && (
                      <p className="text-xs text-amber-400">
                        Ollama not detected — make sure it is running: <code className="bg-secondary px-1 rounded">ollama serve</code>
                      </p>
                    )}
                    {provider === 'ollama' && ollamaConnected && ollamaModels.length === 0 && (
                      <p className="text-xs text-amber-400">
                        Ollama is running but no models found. Pull one: <code className="bg-secondary px-1 rounded">ollama pull llama3</code>
                      </p>
                    )}
                    {provider === 'ollama-cloud' && !ollamaConnected && apiKey && (
                      <p className="text-xs text-amber-400">
                        Could not reach Ollama Cloud — check your API key is correct.
                      </p>
                    )}
                    {provider === 'ollama-cloud' && !apiKey && (
                      <p className="text-xs text-muted-foreground">
                        Enter your Ollama API key above to load available cloud models.
                      </p>
                    )}
                    {provider === 'xiaomi' && (
                      <p className="text-xs text-muted-foreground">
                        Official MiMo models: Pro for long-context reasoning, Flash for fast coding, Omni for multimodal input, and TTS for speech.
                      </p>
                    )}
                    {provider === 'xiaomi' && apiKey.trim().startsWith('tp-') && baseUrl.includes('api.xiaomimimo.com') && (
                      <p className="text-xs text-amber-400">
                        Your Xiaomi key looks like a Token Plan key (`tp-...`). Set Base URL to your token-plan endpoint (e.g. `https://token-plan-ams.xiaomimimo.com/v1`) or requests may be denied.
                      </p>
                    )}
                  </div>

                  {/* Ollama model management — pull & delete */}
                  {provider === 'ollama' && ollamaConnected && (
                    <div className="space-y-3 rounded-lg border border-border/30 bg-secondary/20 p-3">
                      <p className="text-xs font-medium text-muted-foreground">Model Management</p>

                      {/* Pull */}
                      <div className="flex gap-2">
                        <Input
                          placeholder="e.g. llama3:8b"
                          value={pullModelName}
                          onChange={(e) => setPullModelName(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && handlePullModel()}
                          className="text-xs h-8"
                          disabled={pullingModel}
                        />
                        <Button size="sm" onClick={handlePullModel} disabled={pullingModel || !pullModelName.trim()} className="h-8 shrink-0">
                          {pullingModel ? 'Pulling…' : 'Pull'}
                        </Button>
                      </div>
                      {pullStatus && <p className="text-[11px] text-muted-foreground font-mono">{pullStatus}</p>}

                      {/* Installed models list */}
                      {ollamaModels.length > 0 && (
                        <div className="space-y-1 max-h-40 overflow-y-auto">
                          {ollamaModels.map((m) => (
                            <div key={m.name} className="flex items-center justify-between gap-2 rounded px-2 py-1 hover:bg-secondary/60 text-xs">
                              <span className="font-mono truncate">{m.name}</span>
                              <div className="flex items-center gap-1.5 shrink-0">
                                {m.paramSize && <Badge variant="outline" className="text-[10px] py-0">{m.paramSize}</Badge>}
                                {m.size && <span className="text-muted-foreground">{m.size}</span>}
                                <button
                                  onClick={() => handleDeleteModel(m.name)}
                                  disabled={deletingModel === m.name}
                                  className="rounded p-0.5 text-muted-foreground hover:text-red-400 transition-colors disabled:opacity-40"
                                  title={`Delete ${m.name}`}
                                >
                                  <Trash2 className="h-3 w-3" />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {currentProviderInfo.supportsTemperature && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label>Temperature</Label>
                      <Badge variant="outline" className="text-xs">
                        {temperature.toFixed(1)}
                      </Badge>
                    </div>
                    <Slider
                      value={[temperature]}
                      onValueChange={([v]) => setTemperature(v)}
                      min={0}
                      max={2}
                      step={0.1}
                      className="w-full"
                    />
                    <p className="text-xs text-muted-foreground">
                      Lower values make responses more focused. Higher values make them more creative.
                    </p>
                  </div>
                )}

                {currentProviderInfo.supportsMaxTokens && (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="maxTokens">Max Output Tokens</Label>
                      <Input
                        id="maxTokens"
                        type="number"
                        min={256}
                        max={200000}
                        value={maxTokens}
                        onChange={(e) => setMaxTokens(parseInt(e.target.value, 10) || 2048)}
                      />
                      <p className="text-xs text-muted-foreground">
                        Maximum response size. Raise this for longer answers, lower it to reduce crashes.
                      </p>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="contextWindow">Context Window</Label>
                      <Input
                        id="contextWindow"
                        type="number"
                        min={2048}
                        max={1000000}
                        value={contextWindow}
                        onChange={(e) => setContextWindow(parseInt(e.target.value, 10) || 32768)}
                      />
                      <p className="text-xs text-muted-foreground">
                        Target prompt window for long chats. Local models often need this tuned explicitly.
                      </p>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="historyBudget">History Messages</Label>
                      <Input
                        id="historyBudget"
                        type="number"
                        min={4}
                        max={120}
                        value={historyBudget}
                        onChange={(e) => setHistoryBudget(parseInt(e.target.value, 10) || 16)}
                      />
                      <p className="text-xs text-muted-foreground">
                        How many recent messages stay verbatim before older turns are compacted.
                      </p>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="compressionThreshold">Compression Threshold</Label>
                      <Input
                        id="compressionThreshold"
                        type="number"
                        min={6}
                        max={96}
                        value={compressionThreshold}
                        onChange={(e) => setCompressionThreshold(parseInt(e.target.value, 10) || 18)}
                      />
                      <p className="text-xs text-muted-foreground">
                        Start compacting the conversation once it reaches this many messages.
                      </p>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="retryAttempts">Retry Attempts</Label>
                      <Input
                        id="retryAttempts"
                        type="number"
                        min={0}
                        max={3}
                        value={retryAttempts}
                        onChange={(e) => setRetryAttempts(parseInt(e.target.value, 10) || 0)}
                      />
                      <p className="text-xs text-muted-foreground">
                        Automatic retry count for transient stream failures before surfacing an error.
                      </p>
                    </div>
                    <div className="space-y-2">
                      <Label>Quality Mode</Label>
                      <Select value={qualityMode} onValueChange={(value) => setQualityMode(value as NonNullable<LLMConfig['qualityMode']>)}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="balanced">Balanced</SelectItem>
                          <SelectItem value="high-context">High Context</SelectItem>
                          <SelectItem value="high-quality">High Quality</SelectItem>
                          <SelectItem value="local-safe">Local Safe</SelectItem>
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">
                        Controls how aggressively Nova uses context, side reasoning passes, and recovery behavior.
                      </p>
                    </div>
                  </div>
                )}

                <div className="space-y-4 rounded-lg border border-primary/20 bg-primary/5 p-4">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <Label>Nova Operating System</Label>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Unify the app around one posture: agentic workspace, trustworthy runtime controls, reliable model orchestration, and optional always-on automation.
                      </p>
                    </div>
                    <Badge variant="outline">High-level control</Badge>
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
                    {OPERATING_PROFILES.map((preset) => (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => setOperatingProfile(preset.id)}
                        className={`rounded-xl border p-4 text-left transition-colors ${
                          operatingProfile === preset.id
                            ? 'border-primary bg-background/70'
                            : 'border-border/60 bg-background/30 hover:border-primary/40'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-sm font-medium">{preset.label}</span>
                          {operatingProfile === preset.id ? <Check className="h-4 w-4 text-primary" /> : null}
                        </div>
                        <p className="mt-2 text-xs text-muted-foreground">{preset.description}</p>
                      </button>
                    ))}
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Selected profile</Label>
                      <Select value={operatingProfile} onValueChange={(value) => setOperatingProfile(value as 'complete' | 'studio' | 'guarded' | 'autonomous')}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="complete">Complete</SelectItem>
                          <SelectItem value="studio">Studio</SelectItem>
                          <SelectItem value="guarded">Guarded</SelectItem>
                          <SelectItem value="autonomous">Autonomous</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Automation posture</Label>
                      <Select value={automationMode} onValueChange={(value) => setAutomationMode(value as 'manual' | 'assisted' | 'always_on')}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="manual">Manual</SelectItem>
                          <SelectItem value="assisted">Assisted</SelectItem>
                          <SelectItem value="always_on">Always On</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-3">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => void handleApplyOperatingPreset(operatingProfile)}
                      disabled={applyingOperatingPreset === operatingProfile}
                    >
                      {applyingOperatingPreset === operatingProfile ? 'Applying profile...' : `Apply ${operatingProfile} preset`}
                    </Button>
                    <p className="text-xs text-muted-foreground">
                      Presets coordinate chat power, permissions, routing, telemetry, and Mission Control in one move.
                    </p>
                  </div>
                </div>

                <div className="space-y-4 rounded-lg border border-border/50 bg-secondary/10 p-4">
                  <div>
                    <Label>Execution System</Label>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Control how Nova plans, routes specialist models, and records token telemetry across chat and the IDE.
                    </p>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Autonomy Profile</Label>
                      <Select value={autonomyProfile} onValueChange={(value) => setAutonomyProfile(value as 'safe' | 'builder' | 'hands-free' | 'reviewer' | 'research')}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="safe">Safe</SelectItem>
                          <SelectItem value="builder">Builder</SelectItem>
                          <SelectItem value="hands-free">Hands-Free</SelectItem>
                          <SelectItem value="reviewer">Reviewer</SelectItem>
                          <SelectItem value="research">Research</SelectItem>
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">
                        Builder is the balanced default. Hands-Free pushes harder, Reviewer stays conservative, and Research favors synthesis over action.
                      </p>
                    </div>

                    <div className="space-y-2">
                      <Label>Normal Chat Power</Label>
                      <Select value={chatPowerMode} onValueChange={(value) => setChatPowerMode(value as 'safe' | 'builder' | 'power')}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="safe">Safe (read + search)</SelectItem>
                          <SelectItem value="builder">Builder (file edits)</SelectItem>
                          <SelectItem value="power">Power (projects + commands + integrations)</SelectItem>
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">
                        Controls what normal chat can execute. IDE stays fully workspace-native regardless of this setting.
                      </p>
                    </div>

                    <div className="space-y-2">
                      <Label>Chat Permission Guardrail</Label>
                      <Select value={chatPermissionMode} onValueChange={(value) => setChatPermissionMode(value as 'always_ask' | 'ask_risky' | 'autopilot')}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="always_ask">Always Ask (every tool call)</SelectItem>
                          <SelectItem value="ask_risky">Ask Risky Only</SelectItem>
                          <SelectItem value="autopilot">Autopilot (no chat prompts)</SelectItem>
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">
                        Controls permission prompts in normal chat. Always Ask is the strictest mode.
                      </p>
                    </div>

                    <div className="space-y-3 rounded-lg border border-border/50 bg-background/40 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium">Model Router</p>
                          <p className="text-xs text-muted-foreground">Route planning, coding, verification, and research to different models.</p>
                        </div>
                        <Switch checked={routerEnabled} onCheckedChange={setRouterEnabled} />
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium">Scoped Specialists</p>
                          <p className="text-xs text-muted-foreground">Enable planner and verifier passes with tighter context packs.</p>
                        </div>
                        <Switch checked={scopedAgentsEnabled} onCheckedChange={setScopedAgentsEnabled} />
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium">Token Telemetry</p>
                          <p className="text-xs text-muted-foreground">Record orchestration traces in Doctor and audit logs.</p>
                        </div>
                        <Switch checked={tokenTelemetryEnabled} onCheckedChange={setTokenTelemetryEnabled} />
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="plannerModel">Planner Model Override</Label>
                      <Input id="plannerModel" value={plannerModel} onChange={(e) => setPlannerModel(e.target.value)} placeholder="Optional model ID for planning passes" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="coderModel">Coder Model Override</Label>
                      <Input id="coderModel" value={coderModel} onChange={(e) => setCoderModel(e.target.value)} placeholder="Optional model ID for build/debug/code turns" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="verifierModel">Verifier Model Override</Label>
                      <Input id="verifierModel" value={verifierModel} onChange={(e) => setVerifierModel(e.target.value)} placeholder="Optional model ID for review passes" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="researchModel">Research Model Override</Label>
                      <Input id="researchModel" value={researchModel} onChange={(e) => setResearchModel(e.target.value)} placeholder="Optional model ID for retrieval/synthesis turns" />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {provider === 'z-ai' && (
              <>
                <div className="space-y-4 rounded-lg border border-primary/20 bg-primary/5 p-4">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <Label>Nova Operating System</Label>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Unify the app around one posture: agentic workspace, trustworthy runtime controls, reliable model orchestration, and optional always-on automation.
                      </p>
                    </div>
                    <Badge variant="outline">High-level control</Badge>
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
                    {OPERATING_PROFILES.map((preset) => (
                      <button
                        key={`z-${preset.id}`}
                        type="button"
                        onClick={() => setOperatingProfile(preset.id)}
                        className={`rounded-xl border p-4 text-left transition-colors ${
                          operatingProfile === preset.id
                            ? 'border-primary bg-background/70'
                            : 'border-border/60 bg-background/30 hover:border-primary/40'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-sm font-medium">{preset.label}</span>
                          {operatingProfile === preset.id ? <Check className="h-4 w-4 text-primary" /> : null}
                        </div>
                        <p className="mt-2 text-xs text-muted-foreground">{preset.description}</p>
                      </button>
                    ))}
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Selected profile</Label>
                      <Select value={operatingProfile} onValueChange={(value) => setOperatingProfile(value as 'complete' | 'studio' | 'guarded' | 'autonomous')}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="complete">Complete</SelectItem>
                          <SelectItem value="studio">Studio</SelectItem>
                          <SelectItem value="guarded">Guarded</SelectItem>
                          <SelectItem value="autonomous">Autonomous</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Automation posture</Label>
                      <Select value={automationMode} onValueChange={(value) => setAutomationMode(value as 'manual' | 'assisted' | 'always_on')}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="manual">Manual</SelectItem>
                          <SelectItem value="assisted">Assisted</SelectItem>
                          <SelectItem value="always_on">Always On</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-3">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => void handleApplyOperatingPreset(operatingProfile)}
                      disabled={applyingOperatingPreset === operatingProfile}
                    >
                      {applyingOperatingPreset === operatingProfile ? 'Applying profile...' : `Apply ${operatingProfile} preset`}
                    </Button>
                    <p className="text-xs text-muted-foreground">
                      Presets coordinate chat power, permissions, routing, telemetry, and Mission Control in one move.
                    </p>
                  </div>
                </div>

                <div className="space-y-4 rounded-lg border border-border/50 bg-secondary/10 p-4">
                  <div>
                    <Label>Execution System</Label>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Control how Nova plans, routes specialist models, and records token telemetry across chat and the IDE.
                    </p>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Autonomy Profile</Label>
                      <Select value={autonomyProfile} onValueChange={(value) => setAutonomyProfile(value as 'safe' | 'builder' | 'hands-free' | 'reviewer' | 'research')}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="safe">Safe</SelectItem>
                          <SelectItem value="builder">Builder</SelectItem>
                          <SelectItem value="hands-free">Hands-Free</SelectItem>
                          <SelectItem value="reviewer">Reviewer</SelectItem>
                          <SelectItem value="research">Research</SelectItem>
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">
                        Builder is the balanced default. Hands-Free pushes harder, Reviewer stays conservative, and Research favors synthesis over action.
                      </p>
                    </div>

                    <div className="space-y-2">
                      <Label>Normal Chat Power</Label>
                      <Select value={chatPowerMode} onValueChange={(value) => setChatPowerMode(value as 'safe' | 'builder' | 'power')}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="safe">Safe (read + search)</SelectItem>
                          <SelectItem value="builder">Builder (file edits)</SelectItem>
                          <SelectItem value="power">Power (projects + commands + integrations)</SelectItem>
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">
                        Controls what normal chat can execute. IDE stays fully workspace-native regardless of this setting.
                      </p>
                    </div>

                    <div className="space-y-2">
                      <Label>Chat Permission Guardrail</Label>
                      <Select value={chatPermissionMode} onValueChange={(value) => setChatPermissionMode(value as 'always_ask' | 'ask_risky' | 'autopilot')}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="always_ask">Always Ask (every tool call)</SelectItem>
                          <SelectItem value="ask_risky">Ask Risky Only</SelectItem>
                          <SelectItem value="autopilot">Autopilot (no chat prompts)</SelectItem>
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">
                        Controls permission prompts in normal chat. Always Ask is the strictest mode.
                      </p>
                    </div>

                    <div className="space-y-3 rounded-lg border border-border/50 bg-background/40 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium">Model Router</p>
                          <p className="text-xs text-muted-foreground">Route planning, coding, verification, and research to different models.</p>
                        </div>
                        <Switch checked={routerEnabled} onCheckedChange={setRouterEnabled} />
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium">Scoped Specialists</p>
                          <p className="text-xs text-muted-foreground">Enable planner and verifier passes with tighter context packs.</p>
                        </div>
                        <Switch checked={scopedAgentsEnabled} onCheckedChange={setScopedAgentsEnabled} />
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium">Token Telemetry</p>
                          <p className="text-xs text-muted-foreground">Record orchestration traces in Doctor and audit logs.</p>
                        </div>
                        <Switch checked={tokenTelemetryEnabled} onCheckedChange={setTokenTelemetryEnabled} />
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="plannerModelZ">Planner Model Override</Label>
                      <Input id="plannerModelZ" value={plannerModel} onChange={(e) => setPlannerModel(e.target.value)} placeholder="Optional model ID for planning passes" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="coderModelZ">Coder Model Override</Label>
                      <Input id="coderModelZ" value={coderModel} onChange={(e) => setCoderModel(e.target.value)} placeholder="Optional model ID for build/debug/code turns" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="verifierModelZ">Verifier Model Override</Label>
                      <Input id="verifierModelZ" value={verifierModel} onChange={(e) => setVerifierModel(e.target.value)} placeholder="Optional model ID for review passes" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="researchModelZ">Research Model Override</Label>
                      <Input id="researchModelZ" value={researchModel} onChange={(e) => setResearchModel(e.target.value)} placeholder="Optional model ID for retrieval/synthesis turns" />
                    </div>
                  </div>
                </div>
              </>
            )}

            {/* Test Connection */}
            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                onClick={handleTestConnection}
                disabled={testing}
                className="gap-2"
              >
                {testing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
                Test Connection
              </Button>
              {testResult && (
                <motion.div
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="flex items-center gap-1.5 text-sm"
                >
                  {testResult.success ? (
                    <>
                      <CheckCircle2 className="h-4 w-4 text-green-400" />
                      <div className="min-w-0">
                        <p className="text-green-400">{testResult.message}</p>
                        {testResult.details && <p className="text-xs text-muted-foreground">{testResult.details}</p>}
                      </div>
                    </>
                  ) : (
                    <>
                      <XCircle className="h-4 w-4 text-red-400" />
                      <div className="min-w-0">
                        <p className="text-red-400">{testResult.message}</p>
                        {testResult.details && <p className="text-xs text-muted-foreground">{testResult.details}</p>}
                      </div>
                    </>
                  )}
                </motion.div>
              )}
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Agent Settings Section */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
      >
        <Card className="border-border/50 bg-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles className="h-4 w-4 text-primary" />
              Agent Settings
            </CardTitle>
            <CardDescription>
              Customize Nova&apos;s name and personality to match your preferences.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="agentName">Agent Name</Label>
                <Input
                  id="agentName"
                  placeholder="Nova"
                  value={agentName}
                  onChange={(e) => setAgentName(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  The name your agent responds to and uses to refer to itself.
                </p>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="agentPersonality">Custom Personality</Label>
              <Textarea
                id="agentPersonality"
                placeholder="e.g., You are a sarcastic but helpful coding assistant who loves making puns..."
                value={agentPersonality}
                onChange={(e) => setAgentPersonality(e.target.value)}
                rows={4}
                className="resize-none"
              />
              <p className="text-xs text-muted-foreground">
                Define how Nova should behave and respond. This is appended to the system prompt.
              </p>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Workspace Path Section */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
      >
        <Card className="border-border/50 bg-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <FolderOpen className="h-4 w-4 text-primary" />
              Workspace Path
            </CardTitle>
            <CardDescription>
              Point Nova at a local folder so it can read, edit, and create files for you as a coding agent.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="workspaceRoot">Folder path</Label>
              <Input
                id="workspaceRoot"
                placeholder="C:\\Users\\you\\projects\\my-app"
                value={workspaceRoot}
                onChange={(e) => setWorkspaceRoot(e.target.value)}
                className="font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground">
                Absolute path to your project root. Once set, ask Nova to &quot;read src/app/page.tsx&quot; or &quot;create a utils/helper.ts file&quot;.
                All file operations are sandboxed to this folder.
              </p>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Connections Section */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4 }}
      >
        <Card className="border-border/50 bg-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Link2 className="h-4 w-4 text-primary" />
              Connections
            </CardTitle>
            <CardDescription>
              Connect external services so Nova can access GitHub repos, Google Calendar, and Gmail on your behalf.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* GitHub */}
            {(() => {
              const ghConn = connections.find((c) => c.service === 'github');
              const ghConnected = !!ghConn;
              return (
                <div className="rounded-lg border border-border/50 bg-secondary/20 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#24292e]">
                        <Github className="h-4 w-4 text-white" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold">GitHub</p>
                        {ghConnected && ghConn?.meta?.login ? (
                          <p className="text-xs text-muted-foreground">@{ghConn?.meta?.login}{ghConn?.meta?.name ? ` · ${ghConn.meta.name}` : ''}</p>
                        ) : (
                          <p className="text-xs text-muted-foreground">Not connected</p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {ghConnected ? (
                        <>
                          <Badge className="bg-green-500/15 text-green-400 border-green-500/30">
                            <CheckCircle2 className="mr-1 h-3 w-3" />Connected
                          </Badge>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive hover:text-destructive hover:bg-destructive/10"
                            onClick={() => handleDisconnect('github')}
                            disabled={disconnectingService === 'github'}
                          >
                            {disconnectingService === 'github' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Unlink className="h-3 w-3" />}
                          </Button>
                        </>
                      ) : (
                        <Badge variant="outline" className="text-muted-foreground">
                          <XCircle className="mr-1 h-3 w-3" />Disconnected
                        </Badge>
                      )}
                    </div>
                  </div>
                  {!ghConnected && (
                    <div className="flex gap-2">
                      <Input
                        type="password"
                        placeholder="GitHub personal access token (ghp_...)"
                        value={githubToken}
                        onChange={(e) => setGithubToken(e.target.value)}
                        className="flex-1 text-sm"
                        onKeyDown={(e) => e.key === 'Enter' && handleConnect('github')}
                      />
                      <Button
                        size="sm"
                        onClick={() => handleConnect('github')}
                        disabled={connectingService === 'github' || !githubToken.trim()}
                        className="gap-1.5 shrink-0"
                      >
                        {connectingService === 'github' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Link2 className="h-3 w-3" />}
                        Connect
                      </Button>
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground">
                    Generate a token at <a href="https://github.com/settings/tokens" target="_blank" rel="noreferrer" className="text-primary underline-offset-2 hover:underline">github.com/settings/tokens</a>. Needs <code className="bg-secondary px-1 rounded">repo</code> scope for private repos.
                  </p>
                </div>
              );
            })()}

            {/* Google */}
            {(() => {
              const gConn = connections.find((c) => c.service === 'google');
              const gConnected = !!gConn;
              return (
                <div className="rounded-lg border border-border/50 bg-secondary/20 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white">
                        <svg viewBox="0 0 24 24" className="h-4 w-4" xmlns="http://www.w3.org/2000/svg">
                          <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
                          <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                          <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                          <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                        </svg>
                      </div>
                      <div>
                        <p className="text-sm font-semibold">Google</p>
                        {gConnected && (gConn?.meta?.email || gConn?.meta?.name) ? (
                          <p className="text-xs text-muted-foreground">{gConn.meta.name || gConn.meta.email}</p>
                        ) : (
                          <p className="text-xs text-muted-foreground">Not connected</p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {gConnected ? (
                        <>
                          <Badge className="bg-green-500/15 text-green-400 border-green-500/30">
                            <CheckCircle2 className="mr-1 h-3 w-3" />Connected
                          </Badge>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive hover:text-destructive hover:bg-destructive/10"
                            onClick={() => handleDisconnect('google')}
                            disabled={disconnectingService === 'google'}
                          >
                            {disconnectingService === 'google' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Unlink className="h-3 w-3" />}
                          </Button>
                        </>
                      ) : (
                        <Badge variant="outline" className="text-muted-foreground">
                          <XCircle className="mr-1 h-3 w-3" />Disconnected
                        </Badge>
                      )}
                    </div>
                  </div>
                  {!gConnected && (
                    <div className="flex gap-2">
                      <Input
                        type="password"
                        placeholder="Google OAuth access token (ya29...)"
                        value={googleToken}
                        onChange={(e) => setGoogleToken(e.target.value)}
                        className="flex-1 text-sm"
                        onKeyDown={(e) => e.key === 'Enter' && handleConnect('google')}
                      />
                      <Button
                        size="sm"
                        onClick={() => handleConnect('google')}
                        disabled={connectingService === 'google' || !googleToken.trim()}
                        className="gap-1.5 shrink-0"
                      >
                        {connectingService === 'google' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Link2 className="h-3 w-3" />}
                        Connect
                      </Button>
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground">
                    Use the <a href="https://developers.google.com/oauthplayground" target="_blank" rel="noreferrer" className="text-primary underline-offset-2 hover:underline">OAuth Playground</a> to get a token. Scopes needed: <code className="bg-secondary px-1 rounded">gmail.readonly calendar.readonly drive.readonly</code>.
                  </p>
                </div>
              );
            })()}

            {/* Telegram Bot */}
            <div className="rounded-lg border border-border/50 bg-secondary/20 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#2AABEE]">
                    <svg viewBox="0 0 24 24" className="h-4 w-4 fill-white" xmlns="http://www.w3.org/2000/svg">
                      <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.221-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12l-6.871 4.326-2.962-.924c-.643-.204-.657-.643.136-.953l11.57-4.461c.537-.194 1.006.131.833.941z" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-sm font-semibold">Telegram Bot</p>
                    <p className="text-xs text-muted-foreground">{telegramBotToken ? 'Bot token configured' : 'Not configured'}</p>
                  </div>
                </div>
                {telegramBotToken ? (
                  <Badge className="bg-green-500/15 text-green-400 border-green-500/30">
                    <CheckCircle2 className="mr-1 h-3 w-3" />Configured
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-muted-foreground">
                    <XCircle className="mr-1 h-3 w-3" />Not set
                  </Badge>
                )}
              </div>
              <div className="space-y-2">
                <Input
                  type="password"
                  placeholder="Bot token from @BotFather (123456:ABC...)"
                  value={telegramBotToken}
                  onChange={(e) => setTelegramBotToken(e.target.value)}
                  className="text-sm"
                />
                <div className="flex gap-2">
                  <Input
                    placeholder="Your public URL (https://yourdomain.com)"
                    value={telegramPublicUrl}
                    onChange={(e) => setTelegramPublicUrl(e.target.value)}
                    className="flex-1 text-sm"
                  />
                  <Button
                    size="sm"
                    onClick={handleRegisterWebhook}
                    disabled={registeringWebhook || !telegramBotToken.trim() || !telegramPublicUrl.trim()}
                    className="gap-1.5 shrink-0"
                  >
                    {registeringWebhook ? <Loader2 className="h-3 w-3 animate-spin" /> : <Link2 className="h-3 w-3" />}
                    Register Webhook
                  </Button>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Create a bot via <a href="https://t.me/BotFather" target="_blank" rel="noreferrer" className="text-primary underline-offset-2 hover:underline">@BotFather</a>. For the public URL, use ngrok, Cloudflare Tunnel, or a deployed domain. After registering, message your bot to test.
              </p>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* ── Prompt Library ──────────────────────────────────────────────── */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.45 }}>
        <Card className="border-border/50 bg-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <BookOpen className="h-4 w-4 text-primary" />
              Prompt Library
            </CardTitle>
            <CardDescription>Save and reuse system prompts / templates.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Add prompt form */}
            <div className="grid gap-2 sm:grid-cols-2">
              <Input placeholder="Prompt name" value={newPromptName} onChange={(e) => setNewPromptName(e.target.value)} className="text-sm" />
              <Input placeholder="Category (e.g. coding, writing)" value={newPromptCategory} onChange={(e) => setNewPromptCategory(e.target.value)} className="text-sm" />
            </div>
            <Textarea placeholder="Prompt content…" value={newPromptContent} onChange={(e) => setNewPromptContent(e.target.value)} rows={3} className="resize-none text-sm" />
            <Button size="sm" onClick={handleAddPrompt} disabled={!newPromptName.trim() || !newPromptContent.trim()} className="gap-1.5">
              <Plus className="h-3 w-3" /> Save Prompt
            </Button>
            {/* List */}
            {prompts.length > 0 && (
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {prompts.map((p) => (
                  <div key={p.id} className="flex items-center justify-between rounded-lg border border-border/30 bg-secondary/20 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{p.name} {p.isDefault && <Badge variant="outline" className="ml-1 text-[10px] py-0">default</Badge>}</p>
                      <p className="text-[11px] text-muted-foreground truncate">{p.category} · used {p.usageCount}x</p>
                    </div>
                    <button onClick={() => handleDeletePrompt(p.id)} className="shrink-0 rounded p-1 text-muted-foreground hover:text-red-400"><Trash2 className="h-3 w-3" /></button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>

      {/* ── Scheduled Tasks ─────────────────────────────────────────────── */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }}>
        <Card className="border-border/50 bg-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Clock className="h-4 w-4 text-primary" />
              Scheduled Tasks
            </CardTitle>
            <CardDescription>Agent tasks that run on a schedule (cron). Deliver results to log or Telegram.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-2 sm:grid-cols-3">
              <Input placeholder="Task name" value={newTaskName} onChange={(e) => setNewTaskName(e.target.value)} className="text-sm" />
              <Input placeholder="Cron (e.g. 0 9 * * *)" value={newTaskCron} onChange={(e) => setNewTaskCron(e.target.value)} className="text-sm font-mono" />
              <Button size="sm" onClick={handleAddTask} disabled={!newTaskName.trim() || !newTaskPrompt.trim()} className="gap-1.5 h-9">
                <Plus className="h-3 w-3" /> Add Task
              </Button>
            </div>
            <Textarea placeholder="Prompt to run on schedule…" value={newTaskPrompt} onChange={(e) => setNewTaskPrompt(e.target.value)} rows={2} className="resize-none text-sm" />
            {tasks.length > 0 && (
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {tasks.map((t) => (
                  <div key={t.id} className="flex items-center justify-between rounded-lg border border-border/30 bg-secondary/20 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{t.name} <span className="text-[10px] font-mono text-muted-foreground ml-1">{t.cronExpr}</span></p>
                      <p className="text-[11px] text-muted-foreground truncate">{t.lastResult ? t.lastResult.slice(0, 80) : 'Never run'}</p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button size="sm" variant="ghost" onClick={() => handleRunTask(t.id)} disabled={runningTask === t.id} className="h-7 px-2 text-xs">
                        {runningTask === t.id ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Run'}
                      </Button>
                      <button onClick={() => handleDeleteTask(t.id)} className="rounded p-1 text-muted-foreground hover:text-red-400"><Trash2 className="h-3 w-3" /></button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>

      {/* ── MCP Servers ─────────────────────────────────────────────────── */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.55 }}>
        <Card className="border-border/50 bg-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Network className="h-4 w-4 text-primary" />
              MCP Servers
            </CardTitle>
            <CardDescription>Connect Model Context Protocol servers to extend Nova&apos;s tools.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-2 sm:grid-cols-4">
              <Input placeholder="Server name" value={newMcpName} onChange={(e) => setNewMcpName(e.target.value)} className="text-sm" />
              <Select value={newMcpTransport} onValueChange={(v) => setNewMcpTransport(v as 'stdio' | 'sse')}>
                <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="stdio">stdio</SelectItem>
                  <SelectItem value="sse">SSE</SelectItem>
                </SelectContent>
              </Select>
              {newMcpTransport === 'stdio' ? (
                <Input placeholder="Command (e.g. npx @model/server)" value={newMcpCommand} onChange={(e) => setNewMcpCommand(e.target.value)} className="text-sm font-mono" />
              ) : (
                <Input placeholder="Server URL" value={newMcpUrl} onChange={(e) => setNewMcpUrl(e.target.value)} className="text-sm font-mono" />
              )}
              <Button size="sm" onClick={handleAddMcp} disabled={!newMcpName.trim()} className="gap-1.5 h-9">
                <Plus className="h-3 w-3" /> Add
              </Button>
            </div>
            <div className="space-y-2 rounded-lg border border-border/40 bg-secondary/10 p-3">
              <Label htmlFor="chatMcpAllowlist">Chat MCP allowlist</Label>
              <Textarea
                id="chatMcpAllowlist"
                placeholder={'One exact tool name per line\nmcp__github__create_pr\nmcp__browser__navigate'}
                value={chatMcpAllowlist}
                onChange={(e) => setChatMcpAllowlist(e.target.value)}
                rows={4}
                className="resize-none font-mono text-xs"
              />
              <p className="text-xs text-muted-foreground">
                These MCP tools stay available in normal chat outside full Power mode. Use exact tool names, one per line.
              </p>
            </div>
            {mcpServers.length > 0 && (
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {mcpServers.map((s) => (
                  <div key={s.id} className="flex items-center justify-between rounded-lg border border-border/30 bg-secondary/20 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{s.name} <Badge variant="outline" className="ml-1 text-[10px] py-0">{s.transport}</Badge></p>
                      <p className="text-[11px] text-muted-foreground truncate font-mono">{s.command || s.url} · {s.toolCount} tools</p>
                    </div>
                    <button onClick={() => handleDeleteMcp(s.id)} className="shrink-0 rounded p-1 text-muted-foreground hover:text-red-400"><Trash2 className="h-3 w-3" /></button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>

      {/* ── RSS Feeds ───────────────────────────────────────────────────── */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.6 }}>
        <Card className="border-border/50 bg-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Rss className="h-4 w-4 text-primary" />
              RSS Knowledge Import
            </CardTitle>
            <CardDescription>Auto-import RSS/Atom feed items into the Knowledge Base.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-2 sm:grid-cols-3">
              <Input placeholder="Feed name" value={newRssName} onChange={(e) => setNewRssName(e.target.value)} className="text-sm" />
              <Input placeholder="Feed URL" value={newRssUrl} onChange={(e) => setNewRssUrl(e.target.value)} className="text-sm font-mono" />
              <div className="flex gap-2">
                <Button size="sm" onClick={handleAddRss} disabled={!newRssName.trim() || !newRssUrl.trim()} className="gap-1.5 h-9">
                  <Plus className="h-3 w-3" /> Add
                </Button>
                <Button size="sm" variant="outline" onClick={handleFetchRss} disabled={fetchingRss || rssFeeds.length === 0} className="h-9">
                  {fetchingRss ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                  <span className="ml-1">Fetch All</span>
                </Button>
              </div>
            </div>
            {rssFeeds.length > 0 && (
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {rssFeeds.map((f) => (
                  <div key={f.id} className="flex items-center justify-between rounded-lg border border-border/30 bg-secondary/20 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{f.name}</p>
                      <p className="text-[11px] text-muted-foreground truncate font-mono">{f.url} · {f.itemCount} items{f.lastFetchAt ? ` · ${new Date(f.lastFetchAt).toLocaleDateString()}` : ''}</p>
                    </div>
                    <button onClick={() => handleDeleteRss(f.id)} className="shrink-0 rounded p-1 text-muted-foreground hover:text-red-400"><Trash2 className="h-3 w-3" /></button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>

      {/* ── Fine-tune / Training Export ──────────────────────────────────── */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.65 }}>
        <Card className="border-border/50 bg-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <FileText className="h-4 w-4 text-primary" />
              Fine-tune Export
            </CardTitle>
            <CardDescription>Export conversation pairs as OpenAI-compatible JSONL for fine-tuning.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-3">
              <Button onClick={handleFinetuneExport} disabled={exportingFinetune} className="gap-2">
                {exportingFinetune ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                Export JSONL
              </Button>
              <p className="text-xs text-muted-foreground">Downloads all user↔assistant message pairs in OpenAI fine-tuning format.</p>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Danger Zone Section */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4 }}
      >
        <Card className="border-destructive/30 bg-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base text-destructive">
              <Zap className="h-4 w-4" />
              Danger Zone
            </CardTitle>
            <CardDescription>
              Irreversible and destructive actions. Proceed with caution.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between rounded-lg border border-border/50 bg-secondary/20 p-4">
              <div>
                <p className="text-sm font-medium">Export All Data</p>
                <p className="text-xs text-muted-foreground">
                  Download all skills, knowledge, and memories as a JSON file.
                </p>
              </div>
              <Button
                variant="outline"
                onClick={handleExport}
                disabled={exporting}
                className="gap-2 shrink-0"
              >
                {exporting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
                Export
              </Button>
            </div>

            <AlertDialog>
              <AlertDialogTrigger asChild>
                <div className="flex items-center justify-between rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 cursor-pointer hover:bg-amber-500/10 transition-colors">
                  <div>
                    <p className="text-sm font-medium text-amber-200">Reset Memory Only</p>
                    <p className="text-xs text-muted-foreground">
                      Delete long-term memories and user facts without touching projects, skills, or conversations.
                    </p>
                  </div>
                  <Button variant="outline" className="gap-2 shrink-0 border-amber-500/30 text-amber-200 hover:bg-amber-500/10 hover:text-amber-100">
                    <Trash2 className="h-4 w-4" />
                    Reset Memory
                  </Button>
                </div>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Reset memory only?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This clears saved long-term memories and extracted user facts. Conversations, projects, settings, and skills will remain intact.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleResetMemory}
                    className="bg-amber-600 text-white hover:bg-amber-600/90"
                  >
                    Yes, reset memory
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

            <AlertDialog>
              <AlertDialogTrigger asChild>
                <div className="flex items-center justify-between rounded-lg border border-destructive/30 bg-destructive/5 p-4 cursor-pointer hover:bg-destructive/10 transition-colors">
                  <div>
                    <p className="text-sm font-medium text-destructive">Clear All Data</p>
                    <p className="text-xs text-muted-foreground">
                      Permanently delete all skills, knowledge, memories, and conversations.
                    </p>
                  </div>
                  <Button variant="outline" className="gap-2 shrink-0 border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive">
                    <Trash2 className="h-4 w-4" />
                    Clear All
                  </Button>
                </div>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This action cannot be undone. This will permanently delete all your skills,
                    knowledge entries, memories, and conversations. Nova will start fresh.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleClearAll}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    Yes, delete everything
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </CardContent>
        </Card>
      </motion.div>
    </div>
    </div>

    {/* ── OpenRouter Model Browser Dialog ─────────────────────────────── */}
    <Dialog open={orBrowserOpen} onOpenChange={setOrBrowserOpen}>
      <DialogContent className="max-w-3xl w-full max-h-[85vh] flex flex-col gap-0 p-0 overflow-hidden">
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-border/50 shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <Network className="h-5 w-5 text-primary" />
            OpenRouter Model Browser
            {orModels.length > 0 && (
              <Badge variant="secondary" className="ml-1 text-xs">{orModels.length} models</Badge>
            )}
          </DialogTitle>
        </DialogHeader>

        {/* Loading */}
        {orLoading && (
          <div className="flex flex-col items-center justify-center flex-1 py-16 gap-3">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Loading models from OpenRouter…</p>
          </div>
        )}

        {/* Error */}
        {orError && !orLoading && (
          <div className="flex flex-col items-center justify-center flex-1 py-16 gap-4 px-6">
            <XCircle className="h-8 w-8 text-red-400" />
            <p className="text-sm text-muted-foreground text-center max-w-sm">{orError}</p>
            <Button size="sm" variant="outline" onClick={() => fetchOrModels(true)} className="gap-2">
              <RefreshCw className="h-3.5 w-3.5" />
              Retry
            </Button>
          </div>
        )}

        {/* Main Tabs */}
        {!orLoading && !orError && orModels.length > 0 && (
          <Tabs value={orActiveTab} onValueChange={setOrActiveTab} className="flex-1 flex flex-col min-h-0 overflow-hidden">
            <div className="px-6 pt-4 pb-0 shrink-0">
              <TabsList className="w-full grid grid-cols-4">
                <TabsTrigger value="search" className="gap-1.5 text-xs">
                  <Search className="h-3.5 w-3.5" />
                  Search
                </TabsTrigger>
                <TabsTrigger value="providers" className="gap-1.5 text-xs">
                  <Network className="h-3.5 w-3.5" />
                  By Provider
                </TabsTrigger>
                <TabsTrigger value="featured" className="gap-1.5 text-xs">
                  <Star className="h-3.5 w-3.5" />
                  Featured
                </TabsTrigger>
                <TabsTrigger value="capabilities" className="gap-1.5 text-xs">
                  <Filter className="h-3.5 w-3.5" />
                  Capabilities
                </TabsTrigger>
              </TabsList>
            </div>

            {/* ── Search Tab ─────────────────────────────────────────────── */}
            <TabsContent value="search" className="flex-1 flex flex-col min-h-0 overflow-hidden px-6 pb-4 mt-3">
              <div className="relative mb-3 shrink-0">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by name, provider, or model ID…"
                  value={orSearch}
                  onChange={(e) => setOrSearch(e.target.value)}
                  className="pl-9 pr-9"
                  autoFocus
                />
                {orSearch && (
                  <button
                    onClick={() => setOrSearch('')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
              <ScrollArea className="flex-1 min-h-0">
                <div className="space-y-0.5 pr-2">
                  {(() => {
                    const q = orSearch.toLowerCase();
                    const hits = orModels.filter((m) =>
                      !q || m.name.toLowerCase().includes(q) || m.provider.toLowerCase().includes(q) || m.id.toLowerCase().includes(q),
                    );
                    if (hits.length === 0)
                      return <p className="text-center text-sm text-muted-foreground py-8">No models match &quot;{orSearch}&quot;</p>;
                    return hits.map((m) => (
                      <button
                        key={m.id}
                        onClick={() => { setModel(m.id); setOrBrowserOpen(false); }}
                        className={`w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-secondary/60 ${model === m.id ? 'bg-primary/10 border border-primary/30' : 'border border-transparent'}`}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-sm font-medium truncate">{m.name}</span>
                            {m.isFree && <Badge className="text-[10px] py-0 px-1.5 bg-green-500/20 text-green-400 border-green-500/30">Free</Badge>}
                            {m.deprecated && <Badge variant="outline" className="text-[10px] py-0 px-1.5 text-amber-400 border-amber-400/30">Deprecated</Badge>}
                            {m.inputModalities.length > 1 && <Badge variant="secondary" className="text-[10px] py-0 px-1.5">{m.inputModalities.join('+')}</Badge>}
                          </div>
                          <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
                            <span>{m.provider}</span>
                            <span>·</span>
                            <span>{formatContextLength(m.contextLength)} ctx</span>
                            <span>·</span>
                            <span>{formatCostPer1M(m.pricing.prompt)}/M in</span>
                          </div>
                        </div>
                        {model === m.id && <Check className="h-4 w-4 text-primary shrink-0" />}
                      </button>
                    ));
                  })()}
                </div>
              </ScrollArea>
            </TabsContent>

            {/* ── By Provider Tab ──────────────────────────────────────── */}
            <TabsContent value="providers" className="flex-1 min-h-0 overflow-hidden px-6 pb-4 mt-3">
              <ScrollArea className="h-full">
                <div className="space-y-1.5 pr-2">
                  {(() => {
                    const grouped: Record<string, OpenRouterModel[]> = {};
                    for (const m of orModels) (grouped[m.provider] ??= []).push(m);
                    return Object.entries(grouped)
                      .sort((a, b) => a[0].localeCompare(b[0]))
                      .map(([prov, models]) => {
                        const expanded = orExpandedProviders.has(prov);
                        return (
                          <div key={prov} className="rounded-lg border border-border/50 overflow-hidden">
                            <button
                              onClick={() =>
                                setOrExpandedProviders((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(prov)) next.delete(prov);
                                  else next.add(prov);
                                  return next;
                                })
                              }
                              className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-secondary/40 transition-colors"
                            >
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-medium">{prov}</span>
                                <Badge variant="secondary" className="text-[10px] py-0">{models.length}</Badge>
                              </div>
                              {expanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                            </button>
                            {expanded && (
                              <div className="border-t border-border/30 divide-y divide-border/20">
                                {models.map((m) => (
                                  <button
                                    key={m.id}
                                    onClick={() => { setModel(m.id); setOrBrowserOpen(false); }}
                                    className={`w-full flex items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-secondary/60 ${model === m.id ? 'bg-primary/10' : ''}`}
                                  >
                                    <div className="flex-1 min-w-0">
                                      <div className="flex items-center gap-2">
                                        <span className="text-xs font-medium truncate">{m.name}</span>
                                        {m.isFree && <Badge className="text-[10px] py-0 px-1 bg-green-500/20 text-green-400 border-green-500/30">Free</Badge>}
                                      </div>
                                      <div className="flex gap-2 mt-0.5 text-[11px] text-muted-foreground">
                                        <span>{formatContextLength(m.contextLength)} ctx</span>
                                        <span>·</span>
                                        <span>{formatCostPer1M(m.pricing.prompt)}/M in</span>
                                      </div>
                                    </div>
                                    {model === m.id && <Check className="h-3.5 w-3.5 text-primary shrink-0" />}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      });
                  })()}
                </div>
              </ScrollArea>
            </TabsContent>

            {/* ── Featured Tab ─────────────────────────────────────────── */}
            <TabsContent value="featured" className="flex-1 min-h-0 overflow-hidden px-6 pb-4 mt-3">
              <ScrollArea className="h-full">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pr-2">
                  {FEATURED_OPENROUTER_MODELS.map((fm) => {
                    const live = orModels.find((m) => m.id === fm.id);
                    return (
                      <button
                        key={fm.id}
                        onClick={() => { setModel(fm.id); setOrBrowserOpen(false); }}
                        className={`flex items-start gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-secondary/60 ${model === fm.id ? 'border-primary/50 bg-primary/5' : 'border-border/50'}`}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-sm font-medium">{fm.name}</span>
                            <Badge
                              className={`text-[10px] py-0 px-1.5 ${
                                fm.badge === 'Free' || fm.badgeColor === 'green' ? 'bg-green-500/20 text-green-400 border-green-500/30' :
                                fm.badgeColor === 'blue' ? 'bg-primary/20 text-primary border-primary/30' :
                                fm.badgeColor === 'purple' ? 'bg-purple-500/20 text-purple-400 border-purple-500/30' :
                                fm.badgeColor === 'orange' ? 'bg-orange-500/20 text-orange-400 border-orange-500/30' :
                                'bg-secondary text-secondary-foreground'
                              }`}
                            >
                              {fm.badge}
                            </Badge>
                          </div>
                          <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                            <span>{fm.provider}</span>
                            <span>·</span>
                            <span>{fm.contextK}k ctx</span>
                            {live && <><span>·</span><span>{formatCostPer1M(live.pricing.prompt)}/M</span></>}
                          </div>
                        </div>
                        {model === fm.id && <Check className="h-4 w-4 text-primary shrink-0 mt-0.5" />}
                      </button>
                    );
                  })}
                </div>
              </ScrollArea>
            </TabsContent>

            {/* ── Capabilities Tab ─────────────────────────────────────── */}
            <TabsContent value="capabilities" className="flex-1 flex flex-col min-h-0 overflow-hidden px-6 pb-4 mt-3">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-4 shrink-0">
                {([
                  { id: 'free', label: 'Free only' },
                  { id: 'multimodal', label: 'Vision / Images' },
                  { id: 'audio', label: 'Audio input' },
                  { id: 'video', label: 'Video input' },
                  { id: 'reasoning', label: 'Reasoning / Think' },
                  { id: 'text', label: 'Text only' },
                ] as const).map(({ id, label }) => (
                  <label
                    key={id}
                    className="flex items-center gap-2 rounded-lg border border-border/50 px-3 py-2.5 cursor-pointer hover:bg-secondary/40 transition-colors"
                  >
                    <Checkbox
                      checked={orCapabilities.has(id)}
                      onCheckedChange={(checked) =>
                        setOrCapabilities((prev) => {
                          const next = new Set(prev);
                          if (checked) next.add(id);
                          else next.delete(id);
                          return next;
                        })
                      }
                    />
                    <span className="text-sm">{label}</span>
                  </label>
                ))}
              </div>
              <ScrollArea className="flex-1 min-h-0">
                <div className="space-y-0.5 pr-2">
                  {(() => {
                    const caps = [...orCapabilities];
                    const filtered =
                      caps.length === 0
                        ? orModels
                        : orModels.filter((m) =>
                            caps.every((cap) => {
                              switch (cap) {
                                case 'free': return m.isFree;
                                case 'multimodal': return m.inputModalities.includes('image');
                                case 'audio': return m.inputModalities.includes('audio');
                                case 'video': return m.inputModalities.includes('video');
                                case 'reasoning': {
                                  const lc = m.name.toLowerCase() + ' ' + m.id.toLowerCase();
                                  return lc.includes('think') || lc.includes('r1') || lc.includes('o1') || lc.includes('o3') || lc.includes('o4') || lc.includes('qwq');
                                }
                                case 'text': return m.inputModalities.length === 1 && m.inputModalities[0] === 'text';
                                default: return true;
                              }
                            }),
                          );
                    if (filtered.length === 0)
                      return <p className="text-center text-sm text-muted-foreground py-8">No models match these filters.</p>;
                    return filtered.map((m) => (
                      <button
                        key={m.id}
                        onClick={() => { setModel(m.id); setOrBrowserOpen(false); }}
                        className={`w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-secondary/60 ${model === m.id ? 'bg-primary/10 border border-primary/30' : 'border border-transparent'}`}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-sm font-medium truncate">{m.name}</span>
                            {m.isFree && <Badge className="text-[10px] py-0 px-1.5 bg-green-500/20 text-green-400 border-green-500/30">Free</Badge>}
                            {m.inputModalities.length > 1 && <Badge variant="secondary" className="text-[10px] py-0 px-1.5">{m.inputModalities.join('+')}</Badge>}
                          </div>
                          <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
                            <span>{m.provider}</span>
                            <span>·</span>
                            <span>{formatContextLength(m.contextLength)} ctx</span>
                            <span>·</span>
                            <span>{formatCostPer1M(m.pricing.prompt)}/M</span>
                          </div>
                        </div>
                        {model === m.id && <Check className="h-4 w-4 text-primary shrink-0" />}
                      </button>
                    ));
                  })()}
                </div>
              </ScrollArea>
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
    </>
  );
}

