import { useState, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/services/api';
import { MessageSquare, Filter, Eye, Calendar, User, Hash, DollarSign, Download, Bot } from 'lucide-react';
import { Modal } from '@/components/Modal';
import { ConversationDetail } from '@/components/ConversationDetail';

interface Conversation {
  id: string;
  channel: string;
  channelUserId: string;
  startedAt: string;
  lastActivity: string;
  status: string;
  metadata: any;
  messageCount: number;
  lastMessageAt: string | null;
  totalCost: number;
  hasTools: boolean;
  flowId: string | null;
  flowName: string | null;
}

// Helper function to convert date to ISO string with correct time in Ecuador timezone
// Ecuador timezone: America/Guayaquil (UTC-5)
const formatDateForQuery = (dateString: string, isStartDate: boolean): string => {
  if (!dateString) return '';
  
  // Parse the date string (YYYY-MM-DD format)
  const [year, month, day] = dateString.split('-').map(Number);
  
  if (isStartDate) {
    // Start date: 00:00:00 in Ecuador (UTC-5)
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T00:00:00-05:00`;
  } else {
    // End date: 23:59:59 in Ecuador (UTC-5)
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T23:59:59-05:00`;
  }
};

export function Conversations() {
  const [selectedConversation, setSelectedConversation] = useState<string | null>(null);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  const [filters, setFilters] = useState({
    channel: '',
    status: '',
    userId: '',
    startDate: '',
    endDate: '',
    hasTools: '', // 'true', 'false', or '' for all
    flowId: '', // Filter by agent/flow
  });
  const [debouncedFilters, setDebouncedFilters] = useState(filters);
  const [limit] = useState(50);
  const [offset, setOffset] = useState(0);

  // Debounce filters, especialmente para fechas
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedFilters(filters);
      setOffset(0); // Reset pagination when filters change
    }, 500); // 500ms delay

    return () => clearTimeout(timer);
  }, [filters]);

  // Build query params, only including non-empty values
  const queryParams = useMemo(() => {
    const params: any = {
      limit,
      offset,
    };

    if (debouncedFilters.channel) {
      params.channel = debouncedFilters.channel;
    }
    if (debouncedFilters.status) {
      params.status = debouncedFilters.status;
    }
    if (debouncedFilters.userId) {
      params.userId = debouncedFilters.userId;
    }
    if (debouncedFilters.startDate) {
      params.startDate = formatDateForQuery(debouncedFilters.startDate, true);
    }
    if (debouncedFilters.endDate) {
      params.endDate = formatDateForQuery(debouncedFilters.endDate, false);
    }
    if (debouncedFilters.hasTools) {
      params.hasTools = debouncedFilters.hasTools;
    }
    if (debouncedFilters.flowId) {
      params.flowId = debouncedFilters.flowId;
    }

    return params;
  }, [debouncedFilters, limit, offset]);

  const { data, isLoading, error } = useQuery({
    queryKey: ['conversations', queryParams],
    queryFn: () => api.listConversations(queryParams),
  });

  const handleViewDetail = (conversationId: string) => {
    setSelectedConversation(conversationId);
    setIsDetailModalOpen(true);
  };

  const handleFilterChange = (key: string, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  };

  const handleClearFilters = () => {
    setFilters({
      channel: '',
      status: '',
      userId: '',
      startDate: '',
      endDate: '',
      hasTools: '',
      flowId: '',
    });
  };

  // Fetch available flows for the filter dropdown
  const { data: flowsData } = useQuery({
    queryKey: ['flows-list'],
    queryFn: () => api.getFlows(),
  });
  const availableFlows = flowsData || [];

  const conversations = data?.conversations || [];
  const pagination = data?.pagination || { total: 0, limit: 50, offset: 0, hasMore: false };
  const statistics = data?.statistics || { totalMessages: 0, totalCost: 0 };

  const formatDate = (dateString: string) => {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    return date.toLocaleString('es-ES', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatChannel = (channel: string) => {
    return channel.charAt(0).toUpperCase() + channel.slice(1);
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
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <MessageSquare className="h-8 w-8 text-primary-600" />
            <h1 className="text-3xl font-bold text-gray-900">Conversaciones</h1>
          </div>
        </div>
        <div className="bg-red-50 border border-red-200 rounded-lg p-6">
          <h3 className="text-lg font-semibold text-red-800 mb-2">Error al cargar conversaciones</h3>
          <p className="text-red-600">
            {error instanceof Error ? error.message : 'No se pudieron cargar las conversaciones. Por favor, intenta de nuevo.'}
          </p>
          {(error as any)?.response?.status === 404 && (
            <p className="text-sm text-red-500 mt-2">
              El endpoint no fue encontrado. Verifica que el backend esté desplegado correctamente.
            </p>
          )}
        </div>
      </div>
    );
  }

  const handleExport = async () => {
    try {
      // Build export params (same as current filters)
      const exportParams: any = {};
      if (debouncedFilters.channel) exportParams.channel = debouncedFilters.channel;
      if (debouncedFilters.status) exportParams.status = debouncedFilters.status;
      if (debouncedFilters.userId) exportParams.userId = debouncedFilters.userId;
      if (debouncedFilters.startDate) exportParams.startDate = formatDateForQuery(debouncedFilters.startDate, true);
      if (debouncedFilters.endDate) exportParams.endDate = formatDateForQuery(debouncedFilters.endDate, false);
      if (debouncedFilters.hasTools) exportParams.hasTools = debouncedFilters.hasTools;

      const blob = await api.exportConversations(exportParams);
      
      // Create download link
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `conversaciones_${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (error: any) {
      console.error('Error exporting conversations:', error);
      alert('Error al exportar conversaciones. Por favor, intenta de nuevo.');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <MessageSquare className="h-8 w-8 text-primary-600" />
          <h1 className="text-3xl font-bold text-gray-900">Conversaciones</h1>
        </div>
        <button
          onClick={handleExport}
          className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
        >
          <Download className="h-5 w-5" />
          Exportar a Excel
        </button>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex items-center gap-2 mb-4">
          <Filter className="h-5 w-5 text-gray-500" />
          <h2 className="text-lg font-semibold text-gray-900">Filtros</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Canal
            </label>
            <select
              value={filters.channel}
              onChange={(e) => handleFilterChange('channel', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              <option value="">Todos</option>
              <option value="whatsapp">WhatsApp</option>
              <option value="telegram">Telegram</option>
              <option value="webchat">WebChat</option>
              <option value="email">Email</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Estado
            </label>
            <select
              value={filters.status}
              onChange={(e) => handleFilterChange('status', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              <option value="">Todos</option>
              <option value="active">Activa</option>
              <option value="closed">Cerrada</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Tools Ejecutados
            </label>
            <select
              value={filters.hasTools}
              onChange={(e) => handleFilterChange('hasTools', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              <option value="">Todos</option>
              <option value="true">Con Tools</option>
              <option value="false">Sin Tools</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              <div className="flex items-center gap-1">
                <Bot size={14} />
                Agente
              </div>
            </label>
            <select
              value={filters.flowId}
              onChange={(e) => handleFilterChange('flowId', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              <option value="">Todos</option>
              {availableFlows.map((flow: any) => (
                <option key={flow.id} value={flow.id}>
                  {flow.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Usuario ID
            </label>
            <input
              type="text"
              value={filters.userId}
              onChange={(e) => handleFilterChange('userId', e.target.value)}
              placeholder="Buscar por ID..."
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Fecha Inicio
            </label>
            <input
              type="date"
              value={filters.startDate}
              onChange={(e) => handleFilterChange('startDate', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Fecha Fin
            </label>
            <input
              type="date"
              value={filters.endDate}
              onChange={(e) => handleFilterChange('endDate', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>
        </div>

        {(filters.channel || filters.status || filters.userId || filters.startDate || filters.endDate || filters.hasTools || filters.flowId) && (
          <div className="mt-4">
            <button
              onClick={handleClearFilters}
              className="text-sm text-primary-600 hover:text-primary-700"
            >
              Limpiar filtros
            </button>
          </div>
        )}
      </div>

      {/* Statistics */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-lg shadow p-4">
          <div className="text-sm text-gray-600">Total Conversaciones</div>
          <div className="text-2xl font-bold text-gray-900">{pagination.total}</div>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <div className="text-sm text-gray-600">Mostrando</div>
          <div className="text-2xl font-bold text-gray-900">
            {conversations.length} de {pagination.total}
          </div>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <div className="text-sm text-gray-600">Total Mensajes</div>
          <div className="text-2xl font-bold text-gray-900">
            {statistics.totalMessages || conversations.reduce((sum: number, conv: Conversation) => sum + conv.messageCount, 0)}
          </div>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <div className="text-sm text-gray-600">Costo Total</div>
          <div className="text-2xl font-bold text-gray-900">
            ${(statistics.totalCost || conversations.reduce((sum: number, conv: Conversation) => sum + conv.totalCost, 0)).toFixed(2)}
          </div>
        </div>
      </div>

      {/* Conversations Table */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  ID
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Canal
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Usuario
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Mensajes
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Tools
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Agente
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Última Actividad
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Estado
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Costo
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Acciones
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {conversations.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-6 py-8 text-center text-gray-500">
                    No se encontraron conversaciones
                  </td>
                </tr>
              ) : (
                conversations.map((conversation: Conversation) => (
                  <tr key={conversation.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <Hash className="h-4 w-4 text-gray-400 mr-2" />
                        <span className="text-sm font-mono text-gray-900">
                          {conversation.id.substring(0, 8)}...
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="px-2 py-1 text-xs font-semibold rounded-full bg-blue-100 text-blue-800">
                        {formatChannel(conversation.channel)}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <User className="h-4 w-4 text-gray-400 mr-2" />
                        <span className="text-sm text-gray-900">{conversation.channelUserId}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <MessageSquare className="h-4 w-4 text-gray-400 mr-2" />
                        <span className="text-sm text-gray-900">{conversation.messageCount}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {conversation.hasTools ? (
                        <span className="px-2 py-1 text-xs font-semibold rounded-full bg-purple-100 text-purple-800">
                          Sí
                        </span>
                      ) : (
                        <span className="px-2 py-1 text-xs font-semibold rounded-full bg-gray-100 text-gray-500">
                          No
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {conversation.flowName ? (
                        <div className="flex items-center">
                          <Bot className="h-4 w-4 text-indigo-500 mr-2" />
                          <span className="text-sm text-gray-900">{conversation.flowName}</span>
                        </div>
                      ) : (
                        <span className="text-sm text-gray-400">-</span>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <Calendar className="h-4 w-4 text-gray-400 mr-2" />
                        <span className="text-sm text-gray-900">
                          {formatDate(conversation.lastActivity)}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span
                        className={`px-2 py-1 text-xs font-semibold rounded-full ${
                          conversation.status === 'active'
                            ? 'bg-green-100 text-green-800'
                            : 'bg-gray-100 text-gray-800'
                        }`}
                      >
                        {conversation.status === 'active' ? 'Activa' : 'Cerrada'}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <DollarSign className="h-4 w-4 text-gray-400 mr-2" />
                        <span className="text-sm text-gray-900">
                          ${conversation.totalCost.toFixed(2)}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                      <button
                        onClick={() => handleViewDetail(conversation.id)}
                        className="text-primary-600 hover:text-primary-900 flex items-center gap-1"
                      >
                        <Eye className="h-4 w-4" />
                        Ver
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {pagination.total > 0 && (
          <div className="bg-white px-4 py-3 flex items-center justify-between border-t border-gray-200 sm:px-6">
            <div className="flex-1 flex justify-between sm:hidden">
              <button
                onClick={() => setOffset(Math.max(0, offset - limit))}
                disabled={offset === 0}
                className="relative inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50"
              >
                Anterior
              </button>
              <button
                onClick={() => setOffset(offset + limit)}
                disabled={!pagination.hasMore}
                className="ml-3 relative inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50"
              >
                Siguiente
              </button>
            </div>
            <div className="hidden sm:flex-1 sm:flex sm:items-center sm:justify-between">
              <div>
                <p className="text-sm text-gray-700">
                  Mostrando <span className="font-medium">{offset + 1}</span> a{' '}
                  <span className="font-medium">
                    {Math.min(offset + limit, pagination.total)}
                  </span>{' '}
                  de <span className="font-medium">{pagination.total}</span> resultados
                </p>
              </div>
              <div>
                <nav className="relative z-0 inline-flex rounded-md shadow-sm -space-x-px" aria-label="Pagination">
                  <button
                    onClick={() => setOffset(Math.max(0, offset - limit))}
                    disabled={offset === 0}
                    className="relative inline-flex items-center px-2 py-2 rounded-l-md border border-gray-300 bg-white text-sm font-medium text-gray-500 hover:bg-gray-50 disabled:opacity-50"
                  >
                    Anterior
                  </button>
                  <button
                    onClick={() => setOffset(offset + limit)}
                    disabled={!pagination.hasMore}
                    className="relative inline-flex items-center px-2 py-2 rounded-r-md border border-gray-300 bg-white text-sm font-medium text-gray-500 hover:bg-gray-50 disabled:opacity-50"
                  >
                    Siguiente
                  </button>
                </nav>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Detail Modal */}
      {selectedConversation && (
        <Modal
          isOpen={isDetailModalOpen}
          onClose={() => {
            setIsDetailModalOpen(false);
            setSelectedConversation(null);
          }}
          title="Detalles de Conversación"
          maxWidth="xl"
        >
          <ConversationDetail conversationId={selectedConversation} />
        </Modal>
      )}
    </div>
  );
}

