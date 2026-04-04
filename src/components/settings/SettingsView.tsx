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
  RefreshCw,
  Download,
  Trash2,
  CheckCircle2,
  XCircle,
  Loader2,
  Info,
  Sparkles,
  Zap,
} from 'lucide-react';
import { toast } from 'sonner';
import type { LLMConfig } from '@/lib/llm/types';

type ProviderType = LLMConfig['provider'];

interface ProviderInfo {
  id: ProviderType;
  label: string;
  description: string;
  icon: React.ReactNode;
  needsApiKey: boolean;
  defaultBaseUrl?: string;
  defaultModel?: string;
  supportsTemperature: boolean;
  supportsMaxTokens: boolean;
}

const PROVIDERS: ProviderInfo[] = [
  {
    id: 'z-ai',
    label: 'Z-AI (Built-in)',
    description: 'Default built-in AI provider. No configuration needed. Works out of the box.',
    icon: <Brain className="h-4 w-4" />,
    needsApiKey: false,
    supportsTemperature: false,
    supportsMaxTokens: false,
  },
  {
    id: 'openai',
    label: 'OpenAI Compatible',
    description: 'Connect to OpenAI, Azure OpenAI, Groq, Together AI, or any OpenAI-compatible API.',
    icon: <Globe className="h-4 w-4" />,
    needsApiKey: true,
    defaultBaseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4',
    supportsTemperature: true,
    supportsMaxTokens: true,
  },
  {
    id: 'ollama',
    label: 'Ollama (Local)',
    description: 'Run local models via Ollama. Make sure Ollama is running on your machine.',
    icon: <Server className="h-4 w-4" />,
    needsApiKey: false,
    defaultBaseUrl: 'http://localhost:11434',
    defaultModel: 'llama3',
    supportsTemperature: true,
    supportsMaxTokens: false,
  },
  {
    id: 'lmstudio',
    label: 'LM Studio (Local)',
    description: 'Run local models via LM Studio. Make sure LM Studio server is running.',
    icon: <Cpu className="h-4 w-4" />,
    needsApiKey: false,
    defaultBaseUrl: 'http://localhost:1234/v1',
    defaultModel: 'default',
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
    supportsTemperature: true,
    supportsMaxTokens: true,
  },
];

export function SettingsView() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [exporting, setExporting] = useState(false);

  // LLM Config
  const [provider, setProvider] = useState<ProviderType>('z-ai');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [temperature, setTemperature] = useState(0.7);
  const [maxTokens, setMaxTokens] = useState(2048);

  // Agent Settings
  const [agentName, setAgentName] = useState('Nova');
  const [agentPersonality, setAgentPersonality] = useState('');

  const currentProviderInfo = PROVIDERS.find((p) => p.id === provider) || PROVIDERS[0];

  const loadSettings = useCallback(async () => {
    try {
      const res = await fetch('/api/settings');
      if (res.ok) {
        const settings = await res.json();
        setProvider(settings.llm_provider || 'z-ai');
        setApiKey(settings.llm_api_key || '');
        setBaseUrl(settings.llm_base_url || '');
        setModel(settings.llm_model || '');
        setTemperature(settings.llm_temperature ? parseFloat(settings.llm_temperature) : 0.7);
        setMaxTokens(settings.llm_max_tokens ? parseInt(settings.llm_max_tokens, 10) : 2048);
        setAgentName(settings.agent_name || 'Nova');
        setAgentPersonality(settings.agent_personality || '');
      }
    } catch (err) {
      console.error('Failed to load settings:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const handleProviderChange = (newProvider: ProviderType) => {
    setProvider(newProvider);
    setTestResult(null);
    const pInfo = PROVIDERS.find((p) => p.id === newProvider);
    if (pInfo) {
      setBaseUrl(pInfo.defaultBaseUrl || '');
      setModel(pInfo.defaultModel || '');
      setApiKey('');
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          llm_provider: provider,
          llm_api_key: apiKey,
          llm_base_url: baseUrl,
          llm_model: model,
          llm_temperature: String(temperature),
          llm_max_tokens: String(maxTokens),
          agent_name: agentName,
          agent_personality: agentPersonality,
        }),
      });
      if (res.ok) {
        toast.success('Settings saved successfully');
      } else {
        toast.error('Failed to save settings');
      }
    } catch {
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
      await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          llm_provider: provider,
          llm_api_key: apiKey,
          llm_base_url: baseUrl,
          llm_model: model,
          llm_temperature: String(temperature),
          llm_max_tokens: String(maxTokens),
        }),
      });

      const res = await fetch('/api/settings/test-llm', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setTestResult({ success: true, message: `Connected to ${data.provider}` });
        toast.success('LLM connection successful!');
      } else {
        setTestResult({ success: false, message: data.error || 'Connection failed' });
        toast.error('LLM connection failed');
      }
    } catch (err) {
      setTestResult({ success: false, message: 'Failed to test connection' });
      toast.error('Failed to test connection');
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
      await Promise.all([
        fetch('/api/skills', { method: 'DELETE' }),
        fetch('/api/knowledge', { method: 'DELETE' }),
        fetch('/api/memory', { method: 'DELETE' }),
        fetch('/api/conversations', { method: 'DELETE' }),
      ]);
      toast.success('All data cleared successfully');
      // Reset store state
      const { useAppStore } = await import('@/store/app-store');
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
                      <Label htmlFor="apiKey">API Key</Label>
                      <Input
                        id="apiKey"
                        type="password"
                        placeholder="sk-..."
                        value={apiKey}
                        onChange={(e) => setApiKey(e.target.value)}
                      />
                    </div>
                  )}

                  <div className="space-y-2">
                    <Label htmlFor="baseUrl">Base URL</Label>
                    <Input
                      id="baseUrl"
                      placeholder={currentProviderInfo.defaultBaseUrl}
                      value={baseUrl}
                      onChange={(e) => setBaseUrl(e.target.value)}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="model">Model</Label>
                    <Input
                      id="model"
                      placeholder={currentProviderInfo.defaultModel}
                      value={model}
                      onChange={(e) => setModel(e.target.value)}
                    />
                  </div>
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
                  <div className="space-y-2">
                    <Label htmlFor="maxTokens">Max Tokens</Label>
                    <Input
                      id="maxTokens"
                      type="number"
                      min={1}
                      max={128000}
                      value={maxTokens}
                      onChange={(e) => setMaxTokens(parseInt(e.target.value, 10) || 2048)}
                    />
                    <p className="text-xs text-muted-foreground">
                      Maximum number of tokens in the response.
                    </p>
                  </div>
                )}
              </div>
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
                      <span className="text-green-400">{testResult.message}</span>
                    </>
                  ) : (
                    <>
                      <XCircle className="h-4 w-4 text-red-400" />
                      <span className="text-red-400">{testResult.message}</span>
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
                  The name Nova will respond to and use to refer to itself.
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

      {/* Danger Zone Section */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
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
  );
}
