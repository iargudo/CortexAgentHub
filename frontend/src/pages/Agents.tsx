import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api, getChatClientUrl } from '@/services/api';
import { AgentCanvas } from '@/components/AgentCanvas';
import { Agent, Tool, LLM, Channel } from '@/types/agent';
import {
  Plus,
  Edit,
  Trash2,
  X,
  Bot,
  Settings,
  AlertCircle,
  Wand2,
  Eye,
  Code,
  GitBranch,
  Check,
  Book,
  Unlink,
  Save,
  Link,
  Copy,
} from 'lucide-react';

export function Agents() {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);
  const [isCanvasOpen, setIsCanvasOpen] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [copiedChatUrl, setCopiedChatUrl] = useState<string | null>(null);
  const queryClient = useQueryClient();

  // Fetch agents (flows)
  const { data: agents, isLoading } = useQuery({
    queryKey: ['agents'],
    queryFn: () => api.getFlows(),
  });

  // Fetch tools
  const { data: tools } = useQuery({
    queryKey: ['tools'],
    queryFn: () => api.getTools(),
  });

  // Fetch LLMs
  const { data: llms } = useQuery({
    queryKey: ['llms'],
    queryFn: () => api.getLLMs(),
  });

  // Fetch channels
  const { data: channels } = useQuery({
    queryKey: ['channels'],
    queryFn: () => api.getChannels(),
  });

  // Delete agent mutation
  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deleteFlow(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agents'] });
      queryClient.invalidateQueries({ queryKey: ['flows'] });
    },
  });

  // Toggle flow active/inactive from card
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const toggleActiveMutation = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      api.updateFlow(id, { active }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agents'] });
      queryClient.invalidateQueries({ queryKey: ['flows'] });
      setTogglingId(null);
    },
    onError: () => setTogglingId(null),
  });

  const handleToggleActive = (agent: Agent) => {
    setTogglingId(agent.id);
    toggleActiveMutation.mutate({ id: agent.id, active: !agent.active });
  };

  const handleDelete = async (id: string) => {
    if (confirm('¿Estás seguro de eliminar este agente?')) {
      await deleteMutation.mutateAsync(id);
    }
  };

  const openCanvas = (agent: Agent) => {
    setSelectedAgent(agent);
    setIsCanvasOpen(true);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">Cargando agentes...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Agentes de IA</h2>
        <button
          onClick={() => setShowCreateModal(true)}
          className="btn-primary flex items-center gap-2"
        >
          <Plus size={18} />
          Nuevo Agente
        </button>
      </div>

      {/* Agents Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {agents?.map((agent: Agent) => (
          <AgentCard
            key={agent.id}
            agent={agent}
            onEdit={() => setEditingAgent(agent)}
            onDelete={() => handleDelete(agent.id)}
            onViewCanvas={() => openCanvas(agent)}
            onToggleActive={() => handleToggleActive(agent)}
            onCopyChatUrl={() => {
              const chatUrl = getChatClientUrl(agent.id);
              navigator.clipboard.writeText(chatUrl);
              setCopiedChatUrl(agent.id);
              setTimeout(() => setCopiedChatUrl(null), 2000);
            }}
            copiedChatUrl={copiedChatUrl}
            togglingId={togglingId}
          />
        ))}
      </div>

      {/* Empty State */}
      {agents?.length === 0 && (
        <div className="text-center py-12 bg-gray-50 rounded-lg border-2 border-dashed border-gray-300">
          <Bot className="w-16 h-16 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-gray-900 mb-2">
            No hay agentes configurados
          </h3>
          <p className="text-gray-600 mb-4">
            Crea tu primer agente especializado
          </p>
          <button
            onClick={() => setShowCreateModal(true)}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            <Plus className="w-5 h-5" />
            Crear Agente
          </button>
        </div>
      )}

      {/* Create/Edit Modal */}
      {(showCreateModal || editingAgent) && (
        <AgentModal
          agent={editingAgent}
          tools={tools || []}
          llms={llms || []}
          channels={channels || []}
          onClose={() => {
            setShowCreateModal(false);
            setEditingAgent(null);
          }}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ['agents'] });
            queryClient.invalidateQueries({ queryKey: ['flows'] });
            setShowCreateModal(false);
            setEditingAgent(null);
          }}
        />
      )}

      {/* Visual Canvas Modal */}
      {isCanvasOpen && selectedAgent && (
        <AgentCanvas
          agent={selectedAgent}
          tools={tools || []}
          llms={llms || []}
          channels={channels || []}
          onClose={() => {
            setIsCanvasOpen(false);
            setSelectedAgent(null);
          }}
        />
      )}
    </div>
  );
}

// Agent Card Component
// Component for editing assigned knowledge base settings
function AssignedKBItem({
  akb,
  kb,
  agentId,
  queryClient,
}: {
  akb: any;
  kb: any;
  agentId: string;
  queryClient: any;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValues, setEditValues] = useState({
    similarity_threshold: akb.similarity_threshold ?? 0.35,
    max_results: akb.max_results ?? 15,
    priority: akb.priority ?? 0,
  });

  // Update editValues when akb changes
  useEffect(() => {
    setEditValues({
      similarity_threshold: akb.similarity_threshold ?? 0.35,
      max_results: akb.max_results ?? 15,
      priority: akb.priority ?? 0,
    });
  }, [akb.similarity_threshold, akb.max_results, akb.priority]);

  const handleUpdate = async () => {
    try {
      // Ensure we send explicit values (not undefined)
      const payload = {
        priority: editValues.priority ?? 0,
        similarity_threshold: editValues.similarity_threshold ?? 0.35,
        max_results: editValues.max_results ?? 15,
      };
      
      await api.assignKnowledgeBaseToFlow(
        akb.knowledge_base_id,
        agentId,
        payload
      );
      queryClient.invalidateQueries({ queryKey: ['flow-knowledge-bases', agentId] });
      setIsEditing(false);
    } catch (error: any) {
      alert(`Error: ${error.message}`);
    }
  };

  return (
    <div className="p-3 border border-gray-200 rounded-lg hover:bg-gray-50">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-3">
          <Book className="text-blue-600" size={20} />
          <div className="font-medium text-gray-900">
            {kb?.name || 'Knowledge Base'}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!isEditing && (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setIsEditing(true);
              }}
              className="p-1.5 text-blue-600 hover:bg-blue-50 rounded transition-colors"
              title="Editar configuración"
            >
              <Edit size={14} />
            </button>
          )}
          <button
            onClick={async () => {
              if (confirm('¿Desasignar esta knowledge base?')) {
                try {
                  await api.unassignKnowledgeBaseFromFlow(
                    akb.knowledge_base_id,
                    agentId
                  );
                  queryClient.invalidateQueries({ queryKey: ['flow-knowledge-bases', agentId] });
                } catch (error: any) {
                  alert(`Error: ${error.message}`);
                }
              }
            }}
            className="p-1.5 text-red-600 hover:bg-red-50 rounded transition-colors"
            title="Desasignar"
          >
            <Unlink size={14} />
          </button>
        </div>
      </div>
      
      {isEditing ? (
        <div className="space-y-3 mt-3 pt-3 border-t border-gray-200">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Similarity Threshold (0.0 - 1.0)
            </label>
            <input
              type="number"
              min="0"
              max="1"
              step="0.05"
              value={editValues.similarity_threshold}
              onChange={(e) => setEditValues({
                ...editValues,
                similarity_threshold: parseFloat(e.target.value) || 0.35,
              })}
              className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-gray-500 mt-1">
              Más bajo = más resultados (recomendado: 0.35-0.50)
            </p>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Max Results
            </label>
            <input
              type="number"
              min="1"
              max="50"
              value={editValues.max_results}
              onChange={(e) => setEditValues({
                ...editValues,
                max_results: parseInt(e.target.value) || 15,
              })}
              className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-gray-500 mt-1">
              Número máximo de chunks a incluir en el contexto
            </p>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Prioridad
            </label>
            <input
              type="number"
              min="0"
              value={editValues.priority}
              onChange={(e) => setEditValues({
                ...editValues,
                priority: parseInt(e.target.value) || 0,
              })}
              className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-gray-500 mt-1">
              Menor número = mayor prioridad
            </p>
          </div>
          <div className="flex items-center gap-2 pt-2">
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                handleUpdate();
              }}
              className="flex-1 px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
            >
              Guardar
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setEditValues({
                  similarity_threshold: akb.similarity_threshold ?? 0.35,
                  max_results: akb.max_results ?? 15,
                  priority: akb.priority ?? 0,
                });
                setIsEditing(false);
              }}
              className="flex-1 px-3 py-1.5 text-sm bg-gray-200 text-gray-700 rounded hover:bg-gray-300 transition-colors"
            >
              Cancelar
            </button>
          </div>
        </div>
      ) : (
        <div className="text-xs text-gray-500 space-y-1 mt-2">
          <div className="flex items-center justify-between">
            <span>Prioridad:</span>
            <span className="font-medium">{akb.priority}</span>
          </div>
          <div className="flex items-center justify-between">
            <span>Similarity Threshold:</span>
            <span className="font-medium">{akb.similarity_threshold}</span>
          </div>
          <div className="flex items-center justify-between">
            <span>Max resultados:</span>
            <span className="font-medium">{akb.max_results}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function AgentCard({
  agent,
  onEdit,
  onDelete,
  onViewCanvas,
  onCopyChatUrl,
  onToggleActive,
  copiedChatUrl,
  togglingId,
}: {
  agent: Agent;
  onEdit: () => void;
  onDelete: () => void;
  onViewCanvas: () => void;
  onCopyChatUrl: () => void;
  onToggleActive: () => void;
  copiedChatUrl: string | null;
  togglingId: string | null;
}) {
  const hasWebchat = agent.channels?.some((ch) => ch.channel_type === 'webchat');
  const channelCount = agent.channel_count ?? agent.channels?.length ?? 0;
  const toolsCount = agent.enabled_tools?.length ?? 0;
  const isToggling = togglingId === agent.id;

  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-sm hover:shadow-md transition-all duration-200 flex flex-col overflow-hidden">
      {/* Header compacto */}
      <div className="p-4 border-b border-gray-100">
        <div className="flex items-center gap-3 mb-1">
          <div className="p-2 bg-blue-50 rounded-lg shrink-0">
            <Bot className="text-blue-600" size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="font-semibold text-gray-900 truncate">{agent.name}</h3>
            <p className="text-xs text-gray-500 truncate">
              {agent.description || 'Sin descripción'}
            </p>
          </div>
          {/* Switch Activo/Inactivo en la tarjeta */}
          <div className="shrink-0 flex items-center gap-2">
            <span className="text-xs text-gray-500 whitespace-nowrap">
              {agent.active ? 'Activo' : 'Inactivo'}
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={agent.active}
              aria-label={agent.active ? 'Desactivar agente' : 'Activar agente'}
              disabled={isToggling}
              onClick={(e) => {
                e.stopPropagation();
                onToggleActive();
              }}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 ${
                agent.active ? 'bg-green-500' : 'bg-gray-200'
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition ${
                  agent.active ? 'translate-x-5' : 'translate-x-0.5'
                }`}
                style={{ marginTop: 2 }}
              />
              {isToggling && (
                <span className="absolute inset-0 flex items-center justify-center">
                  <span className="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
                </span>
              )}
            </button>
          </div>
        </div>
        {agent.channels && agent.channels.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {agent.channels.slice(0, 3).map((ch) => (
              <span
                key={ch.id}
                className="inline-block px-1.5 py-0.5 bg-blue-50 text-blue-700 rounded text-[10px] font-medium"
                title={ch.channel_name}
              >
                {ch.channel_type.toUpperCase()}
              </span>
            ))}
            {agent.channels.length > 3 && (
              <span className="inline-block px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded text-[10px] font-medium">
                +{agent.channels.length - 3}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Stats en grid 2x2 */}
      <div className="p-4">
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="flex items-center justify-between px-3 py-2 bg-gray-50 rounded-lg">
            <span className="text-gray-500">Canales</span>
            <span className="font-semibold text-gray-900">{channelCount}</span>
          </div>
          <div className="flex items-center justify-between px-3 py-2 bg-gray-50 rounded-lg">
            <span className="text-gray-500">Tools</span>
            <span className="font-semibold text-gray-900">{toolsCount}</span>
          </div>
          <div className="col-span-2 flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-lg">
            <span className="text-gray-500">LLM</span>
            <span className="font-semibold text-gray-900 truncate" title={agent.llm_provider}>
              {agent.llm_provider || '—'}
            </span>
          </div>
        </div>
        {agent.id && (
          <div className="flex items-center gap-1 mt-2 text-[10px] text-gray-400">
            <span title={agent.id}>{agent.id.substring(0, 8)}…</span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                navigator.clipboard.writeText(agent.id);
                alert('Flow ID copiado al portapapeles');
              }}
              className="p-0.5 hover:bg-gray-200 rounded"
              title="Copiar ID"
            >
              <Copy size={10} />
            </button>
          </div>
        )}
      </div>

      {/* Acciones */}
      <div className="p-3 bg-gray-50 border-t border-gray-100 flex flex-wrap gap-2 mt-auto">
        <button
          onClick={onViewCanvas}
          className="flex-1 min-w-0 px-2 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-xs font-medium flex items-center justify-center gap-1"
          title="Ver orquestación"
        >
          <GitBranch size={14} />
          Ver
        </button>
        <button
          onClick={onEdit}
          className="flex-1 min-w-0 px-2 py-1.5 border border-gray-300 rounded-lg hover:bg-gray-100 transition-colors text-xs font-medium flex items-center justify-center gap-1"
          title="Editar"
        >
          <Edit size={14} className="text-gray-600" />
          Editar
        </button>
        {hasWebchat && (
          <button
            onClick={onCopyChatUrl}
            className="shrink-0 p-1.5 border border-green-300 text-green-600 rounded-lg hover:bg-green-50 transition-colors"
            title="Copiar URL del chat"
          >
            {copiedChatUrl === agent.id ? (
              <Check size={14} />
            ) : (
              <Link size={14} />
            )}
          </button>
        )}
        <button
          onClick={onDelete}
          className="shrink-0 p-1.5 border border-red-300 text-red-600 rounded-lg hover:bg-red-50 transition-colors"
          title="Eliminar"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}

// Agent Modal Component
function AgentModal({
  agent,
  tools,
  llms,
  channels,
  onClose,
  onSuccess,
}: {
  agent: Agent | null;
  tools: Tool[];
  llms: LLM[];
  channels: Channel[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const queryClient = useQueryClient();
  const [formData, setFormData] = useState({
    name: agent?.name || '',
    description: agent?.description || '',
    channel_ids: agent?.channels?.map(c => c.id) || [],
    llm_id: agent?.llm_provider ? 
      llms.find(l => l.provider === agent.llm_provider && l.model === agent.llm_model)?.id || '' 
      : '',
    enabled_tools: agent?.enabled_tools || [],
    // Routing conditions
    routing_pattern: agent?.routing_conditions?.messagePattern || agent?.routing_conditions?.pattern || '',
    routing_description: agent?.routing_conditions?.description || '',
    routing_phone_numbers: (agent?.routing_conditions?.phone_numbers || []).join(', '),
    routing_bot_username: agent?.routing_conditions?.bot_username || '',
    routing_email_address: agent?.routing_conditions?.email_address || '',
    routing_user_roles: (agent?.routing_conditions?.user_roles || []).join(', '),
    routing_time_start: agent?.routing_conditions?.time_ranges?.[0]?.start || '',
    routing_time_end: agent?.routing_conditions?.time_ranges?.[0]?.end || '',
    routing_time_days: (agent?.routing_conditions?.time_ranges?.[0]?.days || []).join(', '),
    routing_time_timezone: agent?.routing_conditions?.time_ranges?.[0]?.timezone || '',
    routing_metadata: JSON.stringify(agent?.routing_conditions?.metadata || {}, null, 2),
    system_prompt: agent?.flow_config?.systemPrompt || '',
    temperature: agent?.flow_config?.temperature || 0.7,
    max_tokens: agent?.flow_config?.maxTokens || 2000,
    priority: agent?.priority || 10,
    active: agent?.active ?? true,
    greeting_message: agent?.greeting_message || '',
  });

  const [currentTab, setCurrentTab] = useState<'basic' | 'prompt' | 'tools' | 'routing' | 'knowledge'>('basic');
  const [showPromptPreview, setShowPromptPreview] = useState(false);
  
  // Update form data when agent changes
  useEffect(() => {
    setFormData({
      name: agent?.name || '',
      description: agent?.description || '',
      channel_ids: agent?.channels?.map(c => c.id) || [],
      llm_id: agent?.llm_provider ? 
        llms.find(l => l.provider === agent.llm_provider && l.model === agent.llm_model)?.id || '' 
        : '',
      enabled_tools: agent?.enabled_tools || [],
      // Routing conditions
      routing_pattern: agent?.routing_conditions?.messagePattern || agent?.routing_conditions?.pattern || '',
      routing_description: agent?.routing_conditions?.description || '',
      routing_phone_numbers: (agent?.routing_conditions?.phone_numbers || []).join(', '),
      routing_bot_username: agent?.routing_conditions?.bot_username || '',
      routing_email_address: agent?.routing_conditions?.email_address || '',
      routing_user_roles: (agent?.routing_conditions?.user_roles || []).join(', '),
      routing_time_start: agent?.routing_conditions?.time_ranges?.[0]?.start || '',
      routing_time_end: agent?.routing_conditions?.time_ranges?.[0]?.end || '',
      routing_time_days: (agent?.routing_conditions?.time_ranges?.[0]?.days || []).join(', '),
      routing_time_timezone: agent?.routing_conditions?.time_ranges?.[0]?.timezone || '',
      routing_metadata: JSON.stringify(agent?.routing_conditions?.metadata || {}, null, 2),
      system_prompt: agent?.flow_config?.systemPrompt || '',
      temperature: agent?.flow_config?.temperature || 0.7,
      max_tokens: agent?.flow_config?.maxTokens || 2000,
      priority: agent?.priority || 10,
      active: agent?.active ?? true,
      greeting_message: agent?.greeting_message || '',
    });
  }, [agent, llms]);
  
  // Knowledge Bases
  const { data: knowledgeBases } = useQuery({
    queryKey: ['knowledge-bases'],
    queryFn: () => api.getKnowledgeBases(true), // Solo activas
    enabled: !!agent,
  });

  const { data: assignedKnowledgeBases } = useQuery({
    queryKey: ['flow-knowledge-bases', agent?.id],
    queryFn: () => api.getFlowKnowledgeBases(agent!.id),
    enabled: !!agent?.id,
  });

  const createMutation = useMutation({
    mutationFn: (data: any) => agent ? api.updateFlow(agent.id, data) : api.createFlow(data),
    onSuccess: () => {
      onSuccess();
    },
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.channel_ids || formData.channel_ids.length === 0) {
      alert('Por favor selecciona al menos un canal');
      return;
    }

    const payload = {
      name: formData.name,
      description: formData.description || null,
      channel_ids: formData.channel_ids, // Array de UUIDs de canales
      llm_id: formData.llm_id,
      enabled_tools: formData.enabled_tools,
      routing_conditions: (() => {
        const conditions: any = {};
        
        // Message pattern
        if (formData.routing_pattern) {
          conditions.messagePattern = formData.routing_pattern;
        }
        
        // Description
        if (formData.routing_description) {
          conditions.description = formData.routing_description;
        }
        
        // Phone numbers
        if (formData.routing_phone_numbers) {
          conditions.phone_numbers = formData.routing_phone_numbers
            .split(',')
            .map(p => p.trim())
            .filter(p => p.length > 0);
        }
        
        // Bot username
        if (formData.routing_bot_username) {
          conditions.bot_username = formData.routing_bot_username.trim();
        }
        
        // Email address
        if (formData.routing_email_address) {
          conditions.email_address = formData.routing_email_address.trim();
        }
        
        // User roles
        if (formData.routing_user_roles) {
          conditions.user_roles = formData.routing_user_roles
            .split(',')
            .map(r => r.trim())
            .filter(r => r.length > 0);
        }
        
        // Time ranges
        if (formData.routing_time_start && formData.routing_time_end) {
          const timeRange: any = {
            start: formData.routing_time_start,
            end: formData.routing_time_end,
          };
          
          if (formData.routing_time_days) {
            timeRange.days = formData.routing_time_days
              .split(',')
              .map(d => d.trim())
              .filter(d => d.length > 0);
          }
          
          if (formData.routing_time_timezone) {
            timeRange.timezone = formData.routing_time_timezone.trim();
          }
          
          conditions.time_ranges = [timeRange];
        }
        
        // Metadata
        if (formData.routing_metadata) {
          try {
            const metadata = JSON.parse(formData.routing_metadata);
            if (typeof metadata === 'object' && metadata !== null) {
              conditions.metadata = metadata;
            }
          } catch (e) {
            // Invalid JSON, skip
            console.warn('Invalid metadata JSON:', e);
          }
        }
        
        return conditions;
      })(),
      flow_config: {
        systemPrompt: formData.system_prompt,
        temperature: formData.temperature,
        maxTokens: formData.max_tokens,
      },
      priority: formData.priority,
      active: formData.active,
      greeting_message: formData.greeting_message || null,
    };

    try {
      await createMutation.mutateAsync(payload);
    } catch (error: any) {
      alert(`Error: ${error.message}`);
    }
  };

  const toggleTool = (toolName: string) => {
    setFormData((prev) => ({
      ...prev,
      enabled_tools: prev.enabled_tools.includes(toolName)
        ? prev.enabled_tools.filter((t) => t !== toolName)
        : [...prev.enabled_tools, toolName],
    }));
  };


  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-5xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-xl font-bold text-gray-900">
            {agent ? 'Editar Agente' : 'Crear Nuevo Agente'}
          </h2>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="px-6 border-b border-gray-200">
          <div className="flex gap-4">
            {[
              { id: 'basic', label: 'Básico', icon: Settings },
              { id: 'prompt', label: 'System Prompt', icon: Code },
              { id: 'tools', label: 'Tools', icon: Wand2 },
              { id: 'routing', label: 'Routing', icon: AlertCircle },
              { id: 'knowledge', label: 'Knowledge Bases', icon: Book },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setCurrentTab(tab.id as any)}
                className={`flex items-center gap-2 px-4 py-3 border-b-2 transition-colors ${
                  currentTab === tab.id
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-600 hover:text-gray-900'
                }`}
              >
                <tab.icon className="w-4 h-4" />
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto">
          <div className="p-6 space-y-6 min-h-[600px]">
            {/* Basic Tab */}
            {currentTab === 'basic' && (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Nombre del Agente
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="Ej: Agente de Retail - Pedidos"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Descripción
                  </label>
                  <textarea
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    rows={2}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="Descripción breve del agente"
                  />
                  <p className="mt-1 text-xs text-gray-500">
                    Descripción opcional que se mostrará en el card del agente.
                  </p>
                </div>

                {/* Canales Selector - Permite seleccionar MÚLTIPLES canales */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Canales
                    <span className="text-xs font-normal text-gray-500 ml-2">
                      (Selecciona uno o más canales)
                    </span>
                  </label>
                  <div className="border border-gray-300 rounded-lg p-3 max-h-48 overflow-y-auto space-y-2">
                    {channels.filter(c => (c as any).is_active || c.active).length === 0 ? (
                      <p className="text-sm text-gray-500 italic">No hay canales activos disponibles</p>
                    ) : (
                      channels.filter(c => (c as any).is_active || c.active).map((channel) => {
                        // No longer using instance_identifier - channel is identified by id (UUID)
                        const configPhone = (channel as any).config?.phoneNumber 
                          ? ` (${(channel as any).config.phoneNumber})`
                          : '';
                        // Get channel name - the name field comes directly from the database column
                        const channelName = (channel as any).name || '';
                        const isSelected = formData.channel_ids.includes(channel.id);
                        
                        return (
                          <label 
                            key={channel.id}
                            className={`flex items-center gap-2 p-2 rounded cursor-pointer hover:bg-gray-50 ${isSelected ? 'bg-blue-50 border border-blue-300' : 'border border-transparent'}`}
                          >
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setFormData({
                                    ...formData,
                                    channel_ids: [...formData.channel_ids, channel.id]
                                  });
                                } else {
                                  setFormData({
                                    ...formData,
                                    channel_ids: formData.channel_ids.filter(id => id !== channel.id)
                                  });
                                }
                              }}
                              className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                            />
                            <span className="text-sm font-medium">
                              <span className="font-semibold">{channel.channel_type.toUpperCase()}</span>
                              {channelName && channelName.trim() && (
                                <span className="text-gray-600 ml-1">- {channelName}</span>
                              )}
                              {configPhone}
                            </span>
                          </label>
                        );
                      })
                    )}
                  </div>
                  {formData.channel_ids.length > 0 && (
                    <p className="text-xs text-green-600 mt-1">
                      ✓ {formData.channel_ids.length} canal{formData.channel_ids.length > 1 ? 'es' : ''} seleccionado{formData.channel_ids.length > 1 ? 's' : ''}
                    </p>
                  )}
                  <p className="text-xs text-gray-500 mt-1">
                    Si no ves el canal que necesitas, créalo primero en la sección "Canales" del menú.
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Modelo LLM
                  </label>
                  <select
                    value={formData.llm_id}
                    onChange={(e) => setFormData({ ...formData, llm_id: e.target.value })}
                    required
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">Selecciona un modelo...</option>
                    {llms.filter(l => l.active).map((llm) => {
                      const displayName = llm.name || `${llm.provider} - ${llm.model}`;
                      const providerModel = `${llm.provider}/${llm.model}`;
                      return (
                        <option key={llm.id} value={llm.id}>
                          {displayName} ({providerModel})
                        </option>
                      );
                    })}
                  </select>
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Temperature
                    </label>
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      max="2"
                      value={formData.temperature}
                      onChange={(e) => setFormData({ ...formData, temperature: parseFloat(e.target.value) })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Max Tokens
                    </label>
                    <input
                      type="number"
                      step="100"
                      min="100"
                      max="8000"
                      value={formData.max_tokens}
                      onChange={(e) => setFormData({ ...formData, max_tokens: parseInt(e.target.value) })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Prioridad
                    </label>
                    <input
                      type="number"
                      value={formData.priority}
                      onChange={(e) => setFormData({ ...formData, priority: parseInt(e.target.value) })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="active"
                    checked={formData.active}
                    onChange={(e) => setFormData({ ...formData, active: e.target.checked })}
                    className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                  />
                  <label htmlFor="active" className="text-sm font-medium text-gray-700">
                    Agente activo
                  </label>
                </div>
              </div>
            )}

            {/* System Prompt Tab */}
            {currentTab === 'prompt' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <label className="block text-sm font-medium text-gray-700">
                    System Prompt
                  </label>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setShowPromptPreview(!showPromptPreview)}
                      className="text-sm text-blue-600 hover:text-blue-700 flex items-center gap-1"
                    >
                      <Eye className="w-4 h-4" />
                      {showPromptPreview ? 'Editar' : 'Preview'}
                    </button>
                  </div>
                </div>

                {showPromptPreview ? (
                  <div className="p-4 bg-gray-50 rounded-lg border border-gray-200 text-sm prose prose-sm max-w-none prose-headings:text-gray-900 prose-p:text-gray-700 prose-ul:text-gray-700 prose-ol:text-gray-700 prose-code:text-gray-800 prose-code:bg-gray-200 prose-code:px-1 prose-code:rounded prose-pre:bg-gray-800 prose-pre:text-gray-100 [&_table]:w-full [&_table]:border-collapse [&_table]:my-3 [&_th]:border [&_th]:border-gray-300 [&_th]:bg-gray-200 [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:font-semibold [&_td]:border [&_td]:border-gray-300 [&_td]:px-3 [&_td]:py-2 [&_td]:bg-white">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={{
                        code: ({ node, inline, className, children, ...props }: any) =>
                          inline ? (
                            <code className="bg-gray-200 px-1 rounded text-gray-800" {...props}>
                              {children}
                            </code>
                          ) : (
                            <code className="block p-3 bg-gray-800 text-gray-100 rounded-lg overflow-x-auto text-xs" {...props}>
                              {children}
                            </code>
                          ),
                        table: ({ children, ...props }) => (
                          <div className="overflow-x-auto my-3">
                            <table className="w-full border-collapse border border-gray-300" {...props}>
                              {children}
                            </table>
                          </div>
                        ),
                        thead: ({ children, ...props }) => (
                          <thead className="bg-gray-200" {...props}>{children}</thead>
                        ),
                        tbody: ({ children, ...props }) => (
                          <tbody {...props}>{children}</tbody>
                        ),
                        tr: ({ children, ...props }) => (
                          <tr className="border-b border-gray-300 last:border-b-0" {...props}>{children}</tr>
                        ),
                        th: ({ children, ...props }) => (
                          <th className="border border-gray-300 px-3 py-2 text-left font-semibold text-gray-900" {...props}>{children}</th>
                        ),
                        td: ({ children, ...props }) => (
                          <td className="border border-gray-300 px-3 py-2 text-gray-700 bg-white" {...props}>{children}</td>
                        ),
                      }}
                    >
                      {formData.system_prompt || 'No hay system prompt configurado'}
                    </ReactMarkdown>
                  </div>
                ) : (
                  <textarea
                    value={formData.system_prompt}
                    onChange={(e) => setFormData({ ...formData, system_prompt: e.target.value })}
                    rows={16}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-mono text-sm"
                    placeholder="Define el comportamiento del agente aquí..."
                  />
                )}

                <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-800">
                  💡 <strong>Tip:</strong> El system prompt define el comportamiento del agente. 
                  Sé específico sobre qué debe hacer, cómo debe comunicarse, y cuándo usar tools.
                </div>

                {/* Greeting Message - for webchat */}
                <div className="pt-4 border-t border-gray-200">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Mensaje de Bienvenida (WebChat)
                  </label>
                  <textarea
                    value={formData.greeting_message}
                    onChange={(e) => setFormData({ ...formData, greeting_message: e.target.value })}
                    rows={3}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                    placeholder="¡Hola! 👋 Soy tu asistente virtual. ¿En qué puedo ayudarte hoy?"
                  />
                  <p className="mt-1 text-xs text-gray-500">
                    Este mensaje se enviará automáticamente cuando un usuario abra el chat. Déjalo vacío para desactivar.
                  </p>
                </div>
              </div>
            )}

            {/* Tools Tab */}
            {currentTab === 'tools' && (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-3">
                    Selecciona los tools que puede usar este agente
                  </label>
                  <div className="space-y-2">
                    {tools && tools.length > 0 ? tools.map((tool) => (
                      <label
                        key={tool.id}
                        className="flex items-start gap-3 p-3 border border-gray-200 rounded-lg hover:bg-gray-50 cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={formData.enabled_tools.includes(tool.name)}
                          onChange={() => toggleTool(tool.name)}
                          className="mt-1 w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                        />
                        <div className="flex-1">
                          <div className="font-medium text-gray-900">{tool.name}</div>
                          <div className="text-sm text-gray-600">{tool.description}</div>
                        </div>
                      </label>
                    )) : (
                      <div className="p-3 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-600">
                        No hay tools disponibles
                      </div>
                    )}
                  </div>
                </div>

                {formData.enabled_tools.length === 0 && (
                  <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-sm text-yellow-800">
                    ⚠️ No has seleccionado ningún tool. El agente solo podrá responder texto.
                  </div>
                )}
              </div>
            )}

            {/* Routing Tab */}
            {currentTab === 'routing' && (
              <div className="space-y-6">
                <div className="p-4 bg-blue-50 rounded-lg border border-blue-200">
                  <h4 className="font-medium text-blue-900 mb-2">📊 Cómo funciona el routing:</h4>
                  <ol className="text-sm text-blue-700 space-y-1 list-decimal list-inside">
                    <li>Se evalúan todos los flows activos del canal en orden de prioridad</li>
                    <li>Se verifican todas las condiciones configuradas</li>
                    <li>El flow con mayor prioridad que cumpla TODAS sus condiciones se activa</li>
                    <li>Si ninguno cumple condiciones, se usa el flow de mayor prioridad como fallback</li>
                    <li>Si un flow no tiene condiciones, coincide con todos los mensajes</li>
                  </ol>
                </div>

                {/* Message Pattern */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Patrón de Mensaje (Regex)
                  </label>
                  <input
                    type="text"
                    value={formData.routing_pattern}
                    onChange={(e) => setFormData({ ...formData, routing_pattern: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 font-mono text-sm"
                    placeholder="(pedido|comprar|ordenar|quiero)"
                  />
                  <p className="mt-1 text-xs text-gray-500">
                    Regex para detectar cuándo activar este agente. Ej: (pedido|comprar|stock). Deja vacío para no usar esta condición.
                  </p>
                </div>

                {/* Description */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Descripción del Routing
                  </label>
                  <textarea
                    value={formData.routing_description}
                    onChange={(e) => setFormData({ ...formData, routing_description: e.target.value })}
                    rows={2}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    placeholder="Se activa cuando el cliente quiere hacer un pedido..."
                  />
                  <p className="mt-1 text-xs text-gray-500">
                    Descripción opcional para documentar cuándo se activa este agente (no afecta el matching).
                  </p>
                </div>

                <div className="border-t pt-4">
                  <h4 className="text-sm font-semibold text-gray-700 mb-3">Condiciones por Canal</h4>
                  
                  {/* Phone Numbers (WhatsApp/SMS) */}
                  <div className="mb-4">
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Números de Teléfono (WhatsApp/SMS)
                    </label>
                    <input
                      type="text"
                      value={formData.routing_phone_numbers}
                      onChange={(e) => setFormData({ ...formData, routing_phone_numbers: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                      placeholder="+1234567890, +0987654321"
                    />
                    <p className="mt-1 text-xs text-gray-500">
                      Lista separada por comas de números de teléfono. Solo para WhatsApp/SMS.
                    </p>
                  </div>

                  {/* Bot Username (Telegram) */}
                  <div className="mb-4">
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Bot Username (Telegram)
                    </label>
                    <input
                      type="text"
                      value={formData.routing_bot_username}
                      onChange={(e) => setFormData({ ...formData, routing_bot_username: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                      placeholder="@mybot"
                    />
                    <p className="mt-1 text-xs text-gray-500">
                      Username del bot de Telegram. Solo para Telegram.
                    </p>
                  </div>

                  {/* Email Address */}
                  <div className="mb-4">
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Dirección de Email
                    </label>
                    <input
                      type="email"
                      value={formData.routing_email_address}
                      onChange={(e) => setFormData({ ...formData, routing_email_address: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                      placeholder="cliente@ejemplo.com"
                    />
                    <p className="mt-1 text-xs text-gray-500">
                      Dirección de email específica. Solo para Email channel.
                    </p>
                  </div>
                </div>

                <div className="border-t pt-4">
                  <h4 className="text-sm font-semibold text-gray-700 mb-3">Condiciones de Usuario</h4>
                  
                  {/* User Roles */}
                  <div className="mb-4">
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Roles de Usuario
                    </label>
                    <input
                      type="text"
                      value={formData.routing_user_roles}
                      onChange={(e) => setFormData({ ...formData, routing_user_roles: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                      placeholder="admin, premium, vip"
                    />
                    <p className="mt-1 text-xs text-gray-500">
                      Lista separada por comas de roles de usuario. El usuario debe tener al menos uno de estos roles.
                    </p>
                  </div>
                </div>

                <div className="border-t pt-4">
                  <h4 className="text-sm font-semibold text-gray-700 mb-3">Rango Horario</h4>
                  
                  <div className="grid grid-cols-2 gap-4 mb-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Hora Inicio
                      </label>
                      <input
                        type="time"
                        value={formData.routing_time_start}
                        onChange={(e) => setFormData({ ...formData, routing_time_start: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Hora Fin
                      </label>
                      <input
                        type="time"
                        value={formData.routing_time_end}
                        onChange={(e) => setFormData({ ...formData, routing_time_end: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  </div>

                  <div className="mb-4">
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Días de la Semana
                    </label>
                    <input
                      type="text"
                      value={formData.routing_time_days}
                      onChange={(e) => setFormData({ ...formData, routing_time_days: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                      placeholder="Mon, Tue, Wed, Thu, Fri"
                    />
                    <p className="mt-1 text-xs text-gray-500">
                      Días en inglés abreviados: Mon, Tue, Wed, Thu, Fri, Sat, Sun. Separados por comas.
                    </p>
                  </div>

                  <div className="mb-4">
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Zona Horaria
                    </label>
                    <input
                      type="text"
                      value={formData.routing_time_timezone}
                      onChange={(e) => setFormData({ ...formData, routing_time_timezone: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                      placeholder="America/Argentina/Buenos_Aires"
                    />
                    <p className="mt-1 text-xs text-gray-500">
                      Zona horaria IANA (ej: America/Argentina/Buenos_Aires). Deja vacío para UTC.
                    </p>
                  </div>
                </div>

                <div className="border-t pt-4">
                  <h4 className="text-sm font-semibold text-gray-700 mb-3">Metadata Personalizada</h4>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Metadata (JSON)
                    </label>
                    <textarea
                      value={formData.routing_metadata}
                      onChange={(e) => setFormData({ ...formData, routing_metadata: e.target.value })}
                      rows={4}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 font-mono text-sm"
                      placeholder='{"key": "value", "custom": "data"}'
                    />
                    <p className="mt-1 text-xs text-gray-500">
                      Objeto JSON con metadata personalizada. Debe coincidir exactamente con la metadata del mensaje.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Knowledge Bases Tab */}
            {currentTab === 'knowledge' && (
              <div className="space-y-4">
                <div className="p-4 bg-blue-50 rounded-lg border border-blue-200">
                  <h4 className="font-medium text-blue-900 mb-2">📚 Knowledge Bases</h4>
                  <p className="text-sm text-blue-700">
                    Asigna bases de conocimiento a este agente para que pueda responder preguntas usando RAG (Retrieval-Augmented Generation).
                  </p>
                </div>

                {!agent?.id ? (
                  <div className="p-6 text-center border border-gray-200 rounded-lg">
                    <Book className="mx-auto text-gray-400 mb-2" size={32} />
                    <p className="text-sm text-gray-600">
                      Guarda el agente primero para poder asignar knowledge bases
                    </p>
                  </div>
                ) : (
                  <>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Asignar Knowledge Base
                      </label>
                      <div className="space-y-3">
                        <select
                          onChange={async (e) => {
                            const kbId = e.target.value;
                            if (!kbId) return;
                            
                            try {
                              await api.assignKnowledgeBaseToFlow(kbId, agent.id, {
                                priority: 0,
                                similarity_threshold: 0.35,
                                max_results: 15,
                              });
                              queryClient.invalidateQueries({ queryKey: ['flow-knowledge-bases', agent.id] });
                              queryClient.invalidateQueries({ queryKey: ['knowledge-bases'] });
                              e.target.value = '';
                            } catch (error: any) {
                              alert(`Error: ${error.message}`);
                            }
                          }}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                          defaultValue=""
                        >
                          <option value="">Seleccionar Knowledge Base...</option>
                          {knowledgeBases
                            ?.filter((kb: any) => !assignedKnowledgeBases?.some((akb: any) => akb.knowledge_base_id === kb.id))
                            .map((kb: any) => (
                              <option key={kb.id} value={kb.id}>
                                {kb.name} ({kb.stats?.documents?.completed || 0} documentos)
                              </option>
                            ))}
                        </select>
                        <div className="text-xs text-gray-500 bg-blue-50 p-2 rounded">
                          💡 Valores por defecto: Similarity Threshold: 0.35, Max Results: 15. Puedes editarlos después de asignar.
                        </div>
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Knowledge Bases Asignadas
                      </label>
                      {assignedKnowledgeBases && assignedKnowledgeBases.length > 0 ? (
                        <div className="space-y-2">
                          {assignedKnowledgeBases.map((akb: any) => (
                            <AssignedKBItem
                              key={akb.id}
                              akb={akb}
                              kb={knowledgeBases?.find((k: any) => k.id === akb.knowledge_base_id)}
                              agentId={agent!.id}
                              queryClient={queryClient}
                            />
                          ))}
                        </div>
                      ) : (
                        <div className="p-6 text-center border border-gray-200 rounded-lg">
                          <Book className="mx-auto text-gray-400 mb-2" size={32} />
                          <p className="text-sm text-gray-600">
                            No hay knowledge bases asignadas. Selecciona una arriba para asignarla.
                          </p>
                        </div>
                      )}
                    </div>

                    <div className="p-4 bg-gray-50 rounded-lg border border-gray-200">
                      <h4 className="font-medium text-gray-900 mb-2">ℹ️ Cómo funciona:</h4>
                      <ol className="text-sm text-gray-700 space-y-1 list-decimal list-inside">
                        <li>Cuando el agente recibe un mensaje, busca en las knowledge bases asignadas</li>
                        <li>Encuentra los chunks más relevantes usando búsqueda vectorial</li>
                        <li>Agrega el contexto encontrado al system prompt automáticamente</li>
                        <li>El LLM usa esta información para responder con precisión</li>
                      </ol>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </form>

        {/* Modal Footer */}
        <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 flex items-center justify-between">
          <div className="text-sm text-gray-600">
            {agent ? 'Editando agente existente' : 'Creando nuevo agente'}
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
            >
              Cancelar
            </button>
            <button
              onClick={handleSubmit}
              disabled={createMutation.isPending}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
            >
              {createMutation.isPending ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Guardando...
                </>
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  Guardar Agente
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

