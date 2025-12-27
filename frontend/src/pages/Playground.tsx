import { useState, useRef, useEffect } from 'react';
import React from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '@/services/api';
import ReactMarkdown from 'react-markdown';
import {
  Send,
  Loader2,
  Settings,
  Terminal,
  Download,
  Trash2,
  Copy,
  CheckCheck,
  RefreshCw,
  Zap,
  Database,
  Clock,
  DollarSign,
  Activity,
  Eye,
  EyeOff,
} from 'lucide-react';

interface Message {
  role: 'user' | 'assistant' | 'system' | 'typing';
  content: string;
  timestamp: string;
  metadata?: {
    llmProvider?: string;
    llmModel?: string;
    flowUsed?: string; // Orchestration flow name used
    tokensUsed?: {
      input: number;
      output: number;
      total: number;
    };
    cost?: number;
    toolsExecuted?: Array<{
      toolName: string;
      status: string;
      result?: any;
    }>;
    latency?: number;
  };
  rawRequest?: any;
  rawResponse?: any;
}

export function Playground() {
  // Configuration State
  const [channelType, setChannelType] = useState('webchat');
  const [userId, setUserId] = useState(`test-user-${Date.now()}`);
  const [selectedFlowId, setSelectedFlowId] = useState<string>('');

  // UI State
  const [message, setMessage] = useState('');
  const [history, setHistory] = useState<Message[]>([]);
  const [showConfig, setShowConfig] = useState(true); // Abierto por defecto para mostrar canales y agentes
  const [showDebug, setShowDebug] = useState(false);
  const [showContext, setShowContext] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [selectedMessageDebug, setSelectedMessageDebug] = useState<number | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Fetch orchestration flows
  const { data: flowsData } = useQuery({
    queryKey: ['flows'],
    queryFn: () => api.getFlows(),
  });

  // Filter flows by selected channel - now flows have multiple channels via channels array
  const channelFlows = flowsData?.filter((flow: any) => 
    flow.active && 
    flow.channels && 
    flow.channels.some((ch: any) => ch.channel_type === channelType)
  ) || [];

  // Get selected flow details
  const selectedFlow = channelFlows.find((flow: any) => flow.id === selectedFlowId) || channelFlows[0];

  // Asegurar que el panel de configuración esté abierto por defecto
  React.useEffect(() => {
    setShowConfig(true);
  }, []);

  // Auto-select first flow when channel changes
  React.useEffect(() => {
    if (channelFlows.length > 0 && !selectedFlowId) {
      setSelectedFlowId(channelFlows[0].id);
    }
  }, [channelFlows, selectedFlowId]);

  // Send message mutation
  const sendMutation = useMutation({
    mutationFn: async (payload: any) => {
      const startTime = Date.now();
      const response = await api.sendMessage(payload);
      const latency = Date.now() - startTime;
      return { ...response, latency };
    },
    onSuccess: (data) => {
      // Reemplazar el mensaje de typing con la respuesta del asistente
      setHistory((prevHistory) => {
        const newHistory = [...prevHistory];
        // Encontrar y reemplazar el último mensaje de typing (iterar desde el final)
        let typingIndex = -1;
        for (let i = newHistory.length - 1; i >= 0; i--) {
          if (newHistory[i].role === 'typing') {
            typingIndex = i;
            break;
          }
        }
        if (typingIndex !== -1) {
          const assistantMessage: Message = {
            role: 'assistant',
            content: data.response,
            timestamp: new Date().toISOString(),
            metadata: {
              llmProvider: data.llmProvider,
              llmModel: data.llmModel,
              flowUsed: data.flowUsed, // Include agent information
              tokensUsed: data.tokensUsed,
              cost: data.cost,
              toolsExecuted: data.toolsExecuted,
              latency: data.latency,
            },
            rawRequest: {
              channelType,
              userId,
              content: newHistory[typingIndex - 1]?.content || '', // Obtener el mensaje del usuario anterior
              note: 'El agente determina el LLM y tools automáticamente',
            },
            rawResponse: data,
          };
          newHistory[typingIndex] = assistantMessage;
        }
        return newHistory;
      });
      setMessage('');
      inputRef.current?.focus();
    },
    onError: (error: any) => {
      // Reemplazar el mensaje de typing con el error
      setHistory((prevHistory) => {
        const newHistory = [...prevHistory];
        // Encontrar y reemplazar el último mensaje de typing (iterar desde el final)
        let typingIndex = -1;
        for (let i = newHistory.length - 1; i >= 0; i--) {
          if (newHistory[i].role === 'typing') {
            typingIndex = i;
            break;
          }
        }
        if (typingIndex !== -1) {
          const errorMessage: Message = {
            role: 'system',
            content: `Error: ${error.message || 'Failed to send message'}`,
            timestamp: new Date().toISOString(),
          };
          newHistory[typingIndex] = errorMessage;
        }
        return newHistory;
      });
    },
  });

  const handleSend = () => {
    if (!message.trim() || sendMutation.isPending) return;

    const messageContent = message.trim();

    // Agregar el mensaje del usuario inmediatamente
    const userMessage: Message = {
      role: 'user',
      content: messageContent,
      timestamp: new Date().toISOString(),
    };

    // Agregar mensaje de typing (tres puntos animados)
    const typingMessage: Message = {
      role: 'typing',
      content: '',
      timestamp: new Date().toISOString(),
    };

    setHistory((prevHistory) => [...prevHistory, userMessage, typingMessage]);
    setMessage('');

    // Get the matching channel for the selected flow and channelType
    const matchingChannel = selectedFlow?.channels?.find((ch: any) => ch.channel_type === channelType);
    const channelId = matchingChannel?.id;

    // Los agentes determinan toda la configuración automáticamente
    sendMutation.mutate({
      channelType,
      userId,
      content: messageContent,
      metadata: {
        flowId: selectedFlowId, // Enviar el agente seleccionado explícitamente
        channelId: channelId, // Include channelId (UUID) for routing
        channel_config_id: channelId, // Alias for compatibility
      },
    });
  };

  const handleCopy = (content: string, index: number) => {
    navigator.clipboard.writeText(content);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  const handleClearHistory = () => {
    if (confirm('Clear all conversation history?')) {
      setHistory([]);
    }
  };

  const handleExport = () => {
    const exportData = {
      userId,
      channelType,
      timestamp: new Date().toISOString(),
      note: 'La configuración es determinada automáticamente por el Agente seleccionado',
      messages: history,
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `conversation-${userId}-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleRegenerate = () => {
    if (history.length < 2) return;
    const lastUserMessage = [...history]
      .reverse()
      .find((msg) => msg.role === 'user');
    if (lastUserMessage) {
      setMessage(lastUserMessage.content);
      handleSend();
    }
  };

  // Ya no se usa - los flows determinan qué tools usar
  // const toggleTool = (toolName: string) => {
  //   if (enabledTools.includes(toolName)) {
  //     setEnabledTools(enabledTools.filter((t) => t !== toolName));
  //   } else {
  //     setEnabledTools([...enabledTools, toolName]);
  //   }
  // };

  // Ya no se inicializa - los flows determinan todo automáticamente
  // useEffect(() => {
  //   if (llmsData && llmsData.length > 0 && !llmProvider) {
  //     const firstProvider = llmsData[0].provider;
  //     const firstModel = llmsData[0].model_name;
  //     setLlmProvider(firstProvider);
  //     setModel(firstModel);
  //   }
  // }, [llmsData, llmProvider]);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [history]);

  // Regresar foco al input después de que la IA responde
  useEffect(() => {
    // Si el último mensaje es del asistente, regresar el foco al input
    if (history.length > 0 && history[history.length - 1].role === 'assistant') {
      // Usar setTimeout para asegurar que el DOM se haya actualizado
      setTimeout(() => {
        inputRef.current?.focus();
      }, 100);
    }
  }, [history]);

  // Calculate total stats
  const totalTokens = history.reduce(
    (sum, msg) => sum + (msg.metadata?.tokensUsed?.total || 0),
    0
  );
  const totalCost = history.reduce((sum, msg) => sum + (msg.metadata?.cost || 0), 0);
  const avgLatency =
    history.filter((msg) => msg.metadata?.latency).length > 0
      ? history.reduce((sum, msg) => sum + (msg.metadata?.latency || 0), 0) /
        history.filter((msg) => msg.metadata?.latency).length
      : 0;

  return (
    <div className="h-[calc(100vh-8.5rem)] flex flex-col border border-gray-300 rounded-lg overflow-hidden shadow-sm">
      {/* Header - Compacto */}
      <div className="bg-white border-b border-gray-200 px-4 py-2 flex-shrink-0">
        <div className="flex items-center justify-between gap-4">
          {/* Title + Stats en una línea */}
          <div className="flex items-center gap-6">
            <div>
              <h1 className="text-xl font-bold text-gray-900">Playground</h1>
            </div>
            
            {/* Stats compactas */}
            <div className="flex items-center gap-4 text-xs">
              <div className="flex items-center gap-1">
                <Zap className="w-3 h-3 text-blue-600" />
                <span className="font-medium">{totalTokens.toLocaleString()}</span>
              </div>
              <div className="flex items-center gap-1">
                <DollarSign className="w-3 h-3 text-green-600" />
                <span className="font-medium">${totalCost.toFixed(4)}</span>
              </div>
              <div className="flex items-center gap-1">
                <Clock className="w-3 h-3 text-purple-600" />
                <span className="font-medium">{avgLatency.toFixed(0)}ms</span>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1">
            <button
              onClick={() => setShowConfig(!showConfig)}
              className={`p-2 rounded-lg transition-colors ${
                showConfig
                  ? 'bg-blue-100 text-blue-600'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
              title="Toggle Configuration"
            >
              <Settings className="w-5 h-5" />
            </button>
            <button
              onClick={() => setShowDebug(!showDebug)}
              className={`p-2 rounded-lg transition-colors ${
                showDebug
                  ? 'bg-purple-100 text-purple-600'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
              title="Toggle Debug Panel"
            >
              <Terminal className="w-5 h-5" />
            </button>
            <button
              onClick={() => setShowContext(!showContext)}
              className={`p-2 rounded-lg transition-colors ${
                showContext
                  ? 'bg-green-100 text-green-600'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
              title="Toggle Context"
            >
              <Database className="w-5 h-5" />
            </button>
            <button
              onClick={handleExport}
              className="p-2 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 transition-colors"
              title="Export Conversation"
            >
              <Download className="w-5 h-5" />
            </button>
            <button
              onClick={handleClearHistory}
              className="p-2 bg-red-100 text-red-600 rounded-lg hover:bg-red-200 transition-colors"
              title="Clear History"
            >
              <Trash2 className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden bg-white">
        {/* Configuration Panel - Más compacto */}
        {showConfig && (
          <div className="w-64 bg-gray-50 border-r border-gray-200 overflow-y-auto">
            <div className="p-4 space-y-4">
              {/* Canal */}
              <div>
                <label className="block text-sm font-semibold text-gray-900 mb-2">
                  📡 Canal
                </label>
                <select
                  value={channelType}
                  onChange={(e) => {
                    setChannelType(e.target.value);
                    setSelectedFlowId(''); // Reset flow selection
                  }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="webchat">WebChat</option>
                  <option value="whatsapp">WhatsApp</option>
                  <option value="telegram">Telegram</option>
                  <option value="email">Email</option>
                </select>
              </div>

              {/* Agent Selection */}
              <div>
                <label className="block text-sm font-semibold text-gray-900 mb-2">
                  🤖 Agente
                </label>
                {channelFlows.length === 0 ? (
                  <div className="p-3 bg-yellow-50 border border-yellow-200 rounded text-xs text-yellow-800">
                    No hay agentes configurados para {channelType}
                  </div>
                ) : (
                  <select
                    value={selectedFlowId}
                    onChange={(e) => setSelectedFlowId(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  >
                    {channelFlows.map((flow: any) => {
                      const channelCount = flow.channels?.length || 0;
                      const channelLabel = channelCount > 1 ? ` [${channelCount} canales]` : '';
                      
                      return (
                        <option key={flow.id} value={flow.id}>
                          {flow.name}{channelLabel}
                        </option>
                      );
                    })}
                  </select>
                )}
              </div>

              {/* Agent Information */}
              {selectedFlow && (
                <div className="border-t pt-4 space-y-3">
                  <h3 className="text-sm font-semibold text-gray-900">
                    ℹ️ Información del Agente
                  </h3>
                  
                  {/* Channels Info */}
                  {selectedFlow.channels && selectedFlow.channels.length > 0 && (
                    <div className="bg-blue-50 p-3 rounded-lg border border-blue-200">
                      <div className="text-xs font-semibold text-blue-700 mb-2">
                        📡 Canales ({selectedFlow.channels.length})
                      </div>
                      <div className="space-y-1">
                        {selectedFlow.channels.map((ch: any, idx: number) => {
                          const isSelectedChannel = ch.channel_type === channelType;
                          return (
                            <div 
                              key={idx} 
                              className={`text-xs p-2 rounded ${isSelectedChannel ? 'bg-blue-100 border border-blue-300' : 'bg-white'}`}
                            >
                              <div className="font-semibold text-blue-900">
                                {ch.channel_type.toUpperCase()} - {ch.channel_name || ch.id}
                              </div>
                              {isSelectedChannel && channelType === 'webchat' && (
                                <div className="text-blue-600 mt-1 text-xs">
                                  Channel ID: {ch.id}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  
                  {/* LLM */}
                  <div className="bg-white p-3 rounded-lg border">
                    <div className="text-xs font-semibold text-gray-700 mb-1">LLM</div>
                    <div className="text-sm text-gray-900">
                      {selectedFlow.llm_provider}/{selectedFlow.llm_model}
                    </div>
                  </div>

                  {/* Tools */}
                  <div className="bg-white p-3 rounded-lg border">
                    <div className="text-xs font-semibold text-gray-700 mb-2">Tools Habilitados</div>
                    {selectedFlow.enabled_tools && selectedFlow.enabled_tools.length > 0 ? (
                      <div className="space-y-1">
                        {selectedFlow.enabled_tools.map((tool: string) => (
                          <div key={tool} className="text-sm text-gray-900 flex items-center gap-2">
                            <span className="text-green-600">✓</span>
                            {tool}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-xs text-gray-500 italic">Sin tools configurados</div>
                    )}
                  </div>

                  {/* Priority */}
                  <div className="bg-white p-3 rounded-lg border">
                    <div className="text-xs font-semibold text-gray-700 mb-1">Prioridad</div>
                    <div className="text-sm text-gray-900">{selectedFlow.priority}</div>
                  </div>
                </div>
              )}

              {/* User ID */}
              <div className="border-t pt-4">
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  User ID (testing)
                </label>
                <input
                  type="text"
                  value={userId}
                  onChange={(e) => setUserId(e.target.value)}
                  className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
            </div>
          </div>
        )}

        {/* Chat Area */}
        <div className="flex-1 flex flex-col bg-white min-w-0 min-h-0">
          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0">
            {history.length === 0 ? (
              <div className="h-full flex items-center justify-center">
                <div className="text-center">
                  <Activity className="w-12 h-12 text-gray-400 mx-auto mb-3" />
                  <h3 className="text-lg font-semibold text-gray-900 mb-1">
                    Start a Conversation
                  </h3>
                  <p className="text-gray-600">
                    Send a message to test your AI configuration
                  </p>
                </div>
              </div>
            ) : (
              history.map((msg, index) => (
                <div
                  key={index}
                  className={`flex ${
                    msg.role === 'user' ? 'justify-end' : 'justify-start'
                  }`}
                >
                  <div
                    className={`max-w-[85%] rounded-lg p-3 ${
                      msg.role === 'user'
                        ? 'bg-blue-600 text-white'
                        : msg.role === 'system'
                        ? 'bg-red-50 text-red-900 border border-red-200'
                        : msg.role === 'typing'
                        ? 'bg-gray-100 text-gray-900'
                        : 'bg-gray-100 text-gray-900'
                    }`}
                  >
                    {msg.role === 'typing' ? (
                      // Indicador de typing con tres puntos animados
                      <div className="flex items-center gap-1">
                        <span className="text-xs font-semibold opacity-70 mr-2">
                          ASSISTANT
                        </span>
                        <div className="flex gap-1">
                          <div className="w-2 h-2 bg-gray-600 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                          <div className="w-2 h-2 bg-gray-600 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                          <div className="w-2 h-2 bg-gray-600 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="flex items-start justify-between gap-2 mb-1">
                          <span className="text-xs font-semibold opacity-70">
                            {msg.role.toUpperCase()}
                          </span>
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => handleCopy(msg.content, index)}
                              className="p-1 rounded hover:bg-black/10 transition-colors"
                              title="Copy"
                            >
                              {copiedIndex === index ? (
                                <CheckCheck className="w-3 h-3" />
                              ) : (
                                <Copy className="w-3 h-3" />
                              )}
                            </button>
                            {msg.rawResponse && (
                              <button
                                onClick={() =>
                                  setSelectedMessageDebug(
                                    selectedMessageDebug === index ? null : index
                                  )
                                }
                                className="p-1 rounded hover:bg-black/10 transition-colors"
                                title="Toggle Debug"
                              >
                                {selectedMessageDebug === index ? (
                                  <EyeOff className="w-3 h-3" />
                                ) : (
                                  <Eye className="w-3 h-3" />
                                )}
                              </button>
                            )}
                          </div>
                        </div>

                        <div className="text-sm leading-relaxed markdown-content">
                          <ReactMarkdown
                            components={{
                              code: ({ node, inline, className, children, ...props }: any) => {
                                const match = /language-(\w+)/.exec(className || '');
                                return !inline && match ? (
                                  <pre className="bg-gray-900 text-gray-100 p-4 rounded-lg overflow-x-auto my-2 text-xs">
                                    <code className={className} {...props}>
                                      {String(children).replace(/\n$/, '')}
                                    </code>
                                  </pre>
                                ) : (
                                  <code className="bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded text-xs font-mono" {...props}>
                                    {children}
                                  </code>
                                );
                              },
                              p: ({ children }: any) => <p className="my-2">{children}</p>,
                              ul: ({ children }: any) => <ul className="my-2 ml-4 list-disc space-y-1">{children}</ul>,
                              ol: ({ children }: any) => <ol className="my-2 ml-4 list-decimal space-y-1">{children}</ol>,
                              li: ({ children }: any) => <li className="my-0.5">{children}</li>,
                              h1: ({ children }: any) => <h1 className="text-xl font-bold my-3 mt-4">{children}</h1>,
                              h2: ({ children }: any) => <h2 className="text-lg font-bold my-2 mt-3">{children}</h2>,
                              h3: ({ children }: any) => <h3 className="text-base font-bold my-2">{children}</h3>,
                              blockquote: ({ children }: any) => <blockquote className="border-l-4 border-gray-300 pl-4 italic my-2 text-gray-600">{children}</blockquote>,
                              table: ({ children }: any) => <div className="overflow-x-auto my-2"><table className="border-collapse border border-gray-300 w-full text-xs">{children}</table></div>,
                              thead: ({ children }: any) => <thead className="bg-gray-100">{children}</thead>,
                              tbody: ({ children }: any) => <tbody>{children}</tbody>,
                              tr: ({ children }: any) => <tr className="border-b border-gray-200">{children}</tr>,
                              th: ({ children }: any) => <th className="border border-gray-300 px-2 py-1 text-left font-semibold">{children}</th>,
                              td: ({ children }: any) => <td className="border border-gray-300 px-2 py-1">{children}</td>,
                              a: ({ children, href }: any) => <a href={href} className="text-blue-600 hover:underline" target="_blank" rel="noopener noreferrer">{children}</a>,
                              strong: ({ children }: any) => <strong className="font-semibold">{children}</strong>,
                              em: ({ children }: any) => <em className="italic">{children}</em>,
                              hr: () => <hr className="my-4 border-gray-300" />,
                            }}
                          >
                            {msg.content}
                          </ReactMarkdown>
                        </div>
                      </>
                    )}

                    {msg.role !== 'typing' && msg.metadata && (
                      <div className="mt-3 pt-3 border-t border-white/20 text-xs space-y-1">
                        {msg.metadata.flowUsed && (
                          <div className="mb-2 px-2 py-1 bg-blue-500/20 rounded text-blue-100 font-semibold">
                            🔀 Flow: {msg.metadata.flowUsed}
                          </div>
                        )}
                        <div className="flex items-center gap-4 flex-wrap">
                          {msg.metadata.llmProvider && (
                            <span className="flex items-center gap-1">
                              <Zap className="w-3 h-3" />
                              {msg.metadata.llmProvider}/{msg.metadata.llmModel}
                            </span>
                          )}
                          {msg.metadata.tokensUsed && (
                            <span>
                              {msg.metadata.tokensUsed.total} tokens (
                              {msg.metadata.tokensUsed.input}→
                              {msg.metadata.tokensUsed.output})
                            </span>
                          )}
                          {msg.metadata.cost !== undefined && (
                            <span className="flex items-center gap-1">
                              <DollarSign className="w-3 h-3" />
                              ${msg.metadata.cost.toFixed(4)}
                            </span>
                          )}
                          {msg.metadata.latency && (
                            <span className="flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              {msg.metadata.latency}ms
                            </span>
                          )}
                        </div>
                        {msg.metadata.toolsExecuted && msg.metadata.toolsExecuted.length > 0 && (
                          <div className="mt-2 space-y-1">
                            <div className="font-semibold">Tools Executed:</div>
                            {msg.metadata.toolsExecuted.map((t, idx) => (
                              <details key={idx} className="bg-white/10 rounded px-2 py-1">
                                <summary className="cursor-pointer hover:bg-white/10 px-1 py-1 rounded text-xs">
                                  🔧 {t.toolName} ({t.status})
                                </summary>
                                <div className="mt-2 p-2 bg-black/20 rounded text-xs font-mono overflow-x-auto">
                                  <div className="text-white/70">Tool Result:</div>
                                  <pre className="whitespace-pre-wrap mt-1">
                                    {JSON.stringify(t.result || t, null, 2)}
                                  </pre>
                                </div>
                              </details>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Debug Info */}
                    {selectedMessageDebug === index && msg.rawResponse && (
                      <div className="mt-3 pt-3 border-t border-white/20">
                        <details className="text-xs">
                          <summary className="cursor-pointer font-semibold mb-2">
                            Request/Response
                          </summary>
                          <div className="space-y-2 mt-2">
                            <div>
                              <div className="font-semibold mb-1">Request:</div>
                              <pre className="bg-black/10 p-2 rounded overflow-x-auto">
                                {JSON.stringify(msg.rawRequest, null, 2)}
                              </pre>
                            </div>
                            <div>
                              <div className="font-semibold mb-1">Response:</div>
                              <pre className="bg-black/10 p-2 rounded overflow-x-auto">
                                {JSON.stringify(msg.rawResponse, null, 2)}
                              </pre>
                            </div>
                          </div>
                        </details>
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input Area */}
          <div className="border-t border-gray-200 p-3 bg-gray-50 flex-shrink-0">
            <div className="flex gap-2">
              <input
                ref={inputRef}
                type="text"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
                placeholder="Type your message..."
                className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                disabled={sendMutation.isPending}
              />
              <button
                onClick={handleRegenerate}
                disabled={sendMutation.isPending || history.length === 0}
                className="px-3 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                title="Regenerate Last Response"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
              <button
                onClick={handleSend}
                disabled={sendMutation.isPending || !message.trim()}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
              >
                {sendMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span className="text-sm">Sending...</span>
                  </>
                ) : (
                  <>
                    <Send className="w-4 h-4" />
                    <span className="text-sm">Send</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Debug/Context Panel - Más compacto */}
        {(showDebug || showContext) && (
          <div className="w-72 bg-gray-50 border-l border-gray-200 overflow-y-auto">
            <div className="p-3">
              {showDebug && (
                <div className="mb-6">
                  <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                    <Terminal className="w-4 h-4" />
                    Debug Info
                  </h3>
                  <div className="space-y-3 text-sm">
                    <div className="bg-white p-3 rounded-lg border">
                      <div className="font-semibold mb-2">Session Stats</div>
                      <div className="space-y-1 text-xs">
                        <div className="flex justify-between">
                          <span className="text-gray-600">Messages:</span>
                          <span className="font-medium">{history.length}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-600">Total Tokens:</span>
                          <span className="font-medium">{totalTokens.toLocaleString()}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-600">Total Cost:</span>
                          <span className="font-medium">${totalCost.toFixed(4)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-600">Avg Latency:</span>
                          <span className="font-medium">{avgLatency.toFixed(0)}ms</span>
                        </div>
                      </div>
                    </div>

                    <div className="bg-white p-3 rounded-lg border">
                      <div className="font-semibold mb-2">Current Config</div>
                      <pre className="text-xs bg-gray-50 p-2 rounded overflow-x-auto">
                        {JSON.stringify(
                          {
                            channelType,
                            userId,
                            note: 'Flow determines LLM & tools automatically'
                          },
                          null,
                          2
                        )}
                      </pre>
                    </div>
                  </div>
                </div>
              )}

              {showContext && (
                <div>
                  <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                    <Database className="w-4 h-4" />
                    Context Info
                  </h3>
                  <div className="space-y-3 text-sm">
                    <div className="bg-white p-3 rounded-lg border">
                      <div className="font-semibold mb-2">Session</div>
                      <div className="space-y-1 text-xs">
                        <div>
                          <span className="text-gray-600">ID:</span>
                          <div className="font-mono bg-gray-50 p-1 rounded mt-1">
                            {channelType}:{userId}
                          </div>
                        </div>
                        <div>
                          <span className="text-gray-600">Messages in history:</span>
                          <div className="font-medium">{history.length}</div>
                        </div>
                      </div>
                    </div>

                    <div className="bg-white p-3 rounded-lg border">
                      <div className="font-semibold mb-2">Conversation History</div>
                      <div className="space-y-2 max-h-64 overflow-y-auto">
                        {history.slice(-10).map((msg, idx) => (
                          <div key={idx} className="text-xs border-l-2 border-gray-300 pl-2">
                            <div className="font-semibold text-gray-700">{msg.role}</div>
                            <div className="text-gray-600 truncate">{msg.content}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
