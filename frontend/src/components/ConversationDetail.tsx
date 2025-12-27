import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '@/services/api';
import { MessageSquare, User, Bot, DollarSign, Wrench, CheckCircle, XCircle, Clock, Send, X, Info } from 'lucide-react';

interface ConversationDetailProps {
  conversationId: string;
}

export function ConversationDetail({ conversationId }: ConversationDetailProps) {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<'info' | 'messages'>('info');
  const [showSendModal, setShowSendModal] = useState(false);
  const [messageToSend, setMessageToSend] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sendSuccess, setSendSuccess] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ['conversation-detail', conversationId],
    queryFn: () => api.getConversationDetail(conversationId),
  });

  const handleSendMessage = async () => {
    if (!messageToSend.trim()) return;
    
    setIsSending(true);
    setSendError(null);
    
    try {
      await api.sendProactiveMessage(conversationId, messageToSend.trim());
      setSendSuccess(true);
      setMessageToSend('');
      // Refresh conversation data
      queryClient.invalidateQueries({ queryKey: ['conversation-detail', conversationId] });
      // Close modal after 1.5 seconds
      setTimeout(() => {
        setShowSendModal(false);
        setSendSuccess(false);
      }, 1500);
    } catch (err: any) {
      setSendError(err.response?.data?.error?.message || 'Error al enviar mensaje');
    } finally {
      setIsSending(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-8">
        <p className="text-red-600">Error al cargar los detalles de la conversación</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="text-center py-8">
        <p className="text-gray-500">No se encontraron datos</p>
      </div>
    );
  }

  const { conversation, messages, toolExecutions, statistics } = data;

  const formatDate = (dateString: string) => {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    return date.toLocaleString('es-ES', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  const formatChannel = (channel: string) => {
    return channel.charAt(0).toUpperCase() + channel.slice(1);
  };

  return (
    <div className="space-y-4">
      {/* Tabs Navigation */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex space-x-8" aria-label="Tabs">
          <button
            onClick={() => setActiveTab('info')}
            className={`
              flex items-center gap-2 py-4 px-1 border-b-2 font-medium text-sm
              ${
                activeTab === 'info'
                  ? 'border-primary-500 text-primary-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }
            `}
          >
            <Info className="h-5 w-5" />
            Información
          </button>
          <button
            onClick={() => setActiveTab('messages')}
            className={`
              flex items-center gap-2 py-4 px-1 border-b-2 font-medium text-sm
              ${
                activeTab === 'messages'
                  ? 'border-primary-500 text-primary-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }
            `}
          >
            <MessageSquare className="h-5 w-5" />
            Mensajes ({messages.length})
          </button>
        </nav>
      </div>

      {/* Tab Content */}
      <div className="mt-4">
        {activeTab === 'info' && (
          <div className="space-y-6">
            {/* Conversation Info */}
            <div className="bg-gray-50 rounded-lg p-4">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-900">Información de la Conversación</h3>
                {conversation.channel === 'whatsapp' && (
                  <button
                    onClick={() => setShowSendModal(true)}
                    className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
                  >
                    <Send className="h-4 w-4" />
                    Enviar Mensaje
                  </button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <span className="text-sm text-gray-600">ID:</span>
                  <p className="text-sm font-mono text-gray-900">{conversation.id}</p>
                </div>
                <div>
                  <span className="text-sm text-gray-600">Canal:</span>
                  <p className="text-sm text-gray-900">{formatChannel(conversation.channel)}</p>
                </div>
                <div>
                  <span className="text-sm text-gray-600">Usuario:</span>
                  <p className="text-sm text-gray-900">{conversation.channelUserId}</p>
                </div>
                <div>
                  <span className="text-sm text-gray-600">Estado:</span>
                  <span
                    className={`ml-2 px-2 py-1 text-xs font-semibold rounded-full ${
                      conversation.status === 'active'
                        ? 'bg-green-100 text-green-800'
                        : 'bg-gray-100 text-gray-800'
                    }`}
                  >
                    {conversation.status === 'active' ? 'Activa' : 'Cerrada'}
                  </span>
                </div>
                <div>
                  <span className="text-sm text-gray-600">Iniciada:</span>
                  <p className="text-sm text-gray-900">{formatDate(conversation.startedAt)}</p>
                </div>
                <div>
                  <span className="text-sm text-gray-600">Última Actividad:</span>
                  <p className="text-sm text-gray-900">{formatDate(conversation.lastActivity)}</p>
                </div>
              </div>
            </div>

            {/* Statistics */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-blue-50 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2">
                  <MessageSquare className="h-5 w-5 text-blue-600" />
                  <span className="text-sm text-gray-600">Total Mensajes</span>
                </div>
                <p className="text-2xl font-bold text-gray-900">{statistics.totalMessages}</p>
              </div>
              <div className="bg-green-50 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2">
                  <User className="h-5 w-5 text-green-600" />
                  <span className="text-sm text-gray-600">Mensajes Usuario</span>
                </div>
                <p className="text-2xl font-bold text-gray-900">{statistics.userMessages}</p>
              </div>
              <div className="bg-purple-50 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Bot className="h-5 w-5 text-purple-600" />
                  <span className="text-sm text-gray-600">Mensajes Asistente</span>
                </div>
                <p className="text-2xl font-bold text-gray-900">{statistics.assistantMessages}</p>
              </div>
              <div className="bg-orange-50 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2">
                  <DollarSign className="h-5 w-5 text-orange-600" />
                  <span className="text-sm text-gray-600">Costo Total</span>
                </div>
                <p className="text-2xl font-bold text-gray-900">${statistics.totalCost.toFixed(2)}</p>
              </div>
            </div>

            {/* Tool Executions */}
            {toolExecutions && toolExecutions.length > 0 && (
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                  <Wrench className="h-5 w-5" />
                  Tools Ejecutados ({toolExecutions.length})
                </h3>
                <div className="space-y-2">
                  {toolExecutions.map((tool: any) => (
                    <div
                      key={tool.id}
                      className={`border rounded-lg p-4 ${
                        tool.status === 'success' ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          {tool.status === 'success' ? (
                            <CheckCircle className="h-5 w-5 text-green-600" />
                          ) : (
                            <XCircle className="h-5 w-5 text-red-600" />
                          )}
                          <span className="font-semibold text-gray-900">{tool.toolName}</span>
                          <span className="text-xs text-gray-500">{formatDate(tool.executedAt)}</span>
                        </div>
                        {tool.executionTimeMs && (
                          <div className="flex items-center gap-1 text-xs text-gray-500">
                            <Clock className="h-4 w-4" />
                            {tool.executionTimeMs}ms
                          </div>
                        )}
                      </div>
                      {tool.parameters && (
                        <div className="mt-2">
                          <span className="text-xs font-semibold text-gray-600">Parámetros:</span>
                          <pre className="text-xs bg-white p-2 rounded mt-1 overflow-x-auto">
                            {JSON.stringify(tool.parameters, null, 2)}
                          </pre>
                        </div>
                      )}
                      {tool.result && (
                        <div className="mt-2">
                          <span className="text-xs font-semibold text-gray-600">Resultado:</span>
                          <pre className="text-xs bg-white p-2 rounded mt-1 overflow-x-auto max-h-40 overflow-y-auto">
                            {JSON.stringify(tool.result, null, 2)}
                          </pre>
                        </div>
                      )}
                      {tool.error && (
                        <div className="mt-2">
                          <span className="text-xs font-semibold text-red-600">Error:</span>
                          <p className="text-xs text-red-600 mt-1">{tool.error}</p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'messages' && (
          <div>
            <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <MessageSquare className="h-5 w-5" />
              Mensajes ({messages.length})
            </h3>
            <div className="space-y-4 max-h-[600px] overflow-y-auto">
              {messages.map((message: any) => (
                <div
                  key={message.id}
                  className={`rounded-lg p-4 ${
                    message.role === 'user'
                      ? 'bg-blue-50 border-l-4 border-blue-500'
                      : 'bg-gray-50 border-l-4 border-gray-400'
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      {message.role === 'user' ? (
                        <User className="h-4 w-4 text-blue-600" />
                      ) : (
                        <Bot className="h-4 w-4 text-gray-600" />
                      )}
                      <span className="text-sm font-semibold text-gray-900">
                        {message.role === 'user' ? 'Usuario' : 'Asistente'}
                      </span>
                    </div>
                    <div className="flex items-center gap-4 text-xs text-gray-500">
                      <span>{formatDate(message.timestamp)}</span>
                      {message.cost > 0 && (
                        <span className="flex items-center gap-1">
                          <DollarSign className="h-3 w-3" />
                          {message.cost.toFixed(4)}
                        </span>
                      )}
                      {message.tokensUsed && message.tokensUsed.total && (
                        <span>{message.tokensUsed.total} tokens</span>
                      )}
                    </div>
                  </div>
                  <p className="text-sm text-gray-900 whitespace-pre-wrap">{message.content}</p>
                  {message.llmProvider && (
                    <div className="mt-2 text-xs text-gray-500">
                      <span>LLM: {message.llmProvider}</span>
                      {message.llmModel && <span className="ml-2">Modelo: {message.llmModel}</span>}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Send Message Modal */}
      {showSendModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-lg mx-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">Enviar Mensaje</h3>
              <button
                onClick={() => {
                  setShowSendModal(false);
                  setMessageToSend('');
                  setSendError(null);
                  setSendSuccess(false);
                }}
                className="text-gray-500 hover:text-gray-700"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            
            <div className="mb-4">
              <p className="text-sm text-gray-600 mb-2">
                Enviando a: <span className="font-semibold">{conversation.channelUserId}</span>
              </p>
              <textarea
                value={messageToSend}
                onChange={(e) => setMessageToSend(e.target.value)}
                placeholder="Escribe tu mensaje aquí..."
                className="w-full h-32 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 resize-none"
                disabled={isSending || sendSuccess}
              />
            </div>

            {sendError && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-sm text-red-600">{sendError}</p>
              </div>
            )}

            {sendSuccess && (
              <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg">
                <p className="text-sm text-green-600 flex items-center gap-2">
                  <CheckCircle className="h-4 w-4" />
                  ¡Mensaje enviado correctamente!
                </p>
              </div>
            )}

            <div className="flex justify-end gap-3">
              <button
                onClick={() => {
                  setShowSendModal(false);
                  setMessageToSend('');
                  setSendError(null);
                }}
                className="px-4 py-2 text-gray-600 hover:text-gray-800"
                disabled={isSending}
              >
                Cancelar
              </button>
              <button
                onClick={handleSendMessage}
                disabled={isSending || !messageToSend.trim() || sendSuccess}
                className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isSending ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"></div>
                    Enviando...
                  </>
                ) : (
                  <>
                    <Send className="h-4 w-4" />
                    Enviar
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

