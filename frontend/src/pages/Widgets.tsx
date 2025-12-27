import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, getApiBaseUrl } from '@/services/api';
import { MessageSquare, Plus, Edit2, Trash2, Copy, Check, X, Code } from 'lucide-react';

interface Widget {
  id: string;
  name: string;
  widget_key: string;
  channel_id: string;
  channel_name?: string;
  channel_type?: string;
  allowed_origins?: string[];
  position: string;
  primary_color: string;
  button_color: string;
  button_text_color: string;
  welcome_message?: string;
  placeholder_text: string;
  show_typing_indicator: boolean;
  enable_sound: boolean;
  button_size: number;
  chat_width: number;
  chat_height: number;
  active: boolean;
  created_at: string;
  updated_at: string;
}


export function Widgets() {
  const queryClient = useQueryClient();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingWidget, setEditingWidget] = useState<Widget | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [showEmbedCode, setShowEmbedCode] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    widget_key: '',
    channel_id: '',
    allowed_origins: [] as string[],
    position: 'bottom-right',
    primary_color: '#3B82F6',
    button_color: '#3B82F6',
    button_text_color: '#FFFFFF',
    welcome_message: '',
    placeholder_text: 'Escribe tu mensaje...',
    show_typing_indicator: true,
    enable_sound: false,
    button_size: 56,
    chat_width: 380,
    chat_height: 500,
    active: true,
  });
  const [newOrigin, setNewOrigin] = useState('');

  const { data: widgets, isLoading } = useQuery({
    queryKey: ['widgets'],
    queryFn: () => api.getWidgets(),
  });

  const { data: channels } = useQuery({
    queryKey: ['channels'],
    queryFn: () => api.getChannels(),
  });

  const createMutation = useMutation({
    mutationFn: (data: any) => api.createWidget(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['widgets'] });
      closeModal();
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, ...data }: any) => api.updateWidget(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['widgets'] });
      closeModal();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deleteWidget(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['widgets'] });
    },
  });

  const openCreateModal = () => {
    setEditingWidget(null);
    setFormData({
      name: '',
      widget_key: '',
      channel_id: '',
      allowed_origins: [],
      position: 'bottom-right',
      primary_color: '#3B82F6',
      button_color: '#3B82F6',
      button_text_color: '#FFFFFF',
      welcome_message: '',
      placeholder_text: 'Escribe tu mensaje...',
      show_typing_indicator: true,
      enable_sound: false,
      button_size: 56,
      chat_width: 380,
      chat_height: 500,
      active: true,
    });
    setIsModalOpen(true);
  };

  const openEditModal = (widget: Widget) => {
    setEditingWidget(widget);
    setFormData({
      name: widget.name,
      widget_key: widget.widget_key,
      channel_id: widget.channel_id,
      allowed_origins: widget.allowed_origins || [],
      position: widget.position,
      primary_color: widget.primary_color,
      button_color: widget.button_color,
      button_text_color: widget.button_text_color,
      welcome_message: widget.welcome_message || '',
      placeholder_text: widget.placeholder_text,
      show_typing_indicator: widget.show_typing_indicator,
      enable_sound: widget.enable_sound,
      button_size: widget.button_size,
      chat_width: widget.chat_width,
      chat_height: widget.chat_height,
      active: widget.active,
    });
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingWidget(null);
    setNewOrigin('');
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.channel_id) {
      alert('Por favor selecciona un canal');
      return;
    }
    if (!formData.widget_key) {
      alert('Por favor ingresa un widget key');
      return;
    }

    if (editingWidget) {
      updateMutation.mutate({ id: editingWidget.id, ...formData });
    } else {
      createMutation.mutate(formData);
    }
  };

  const handleDelete = async (id: string) => {
    if (confirm('¿Estás seguro de eliminar este widget?')) {
      await deleteMutation.mutateAsync(id);
    }
  };

  const copyEmbedCode = (widgetKey: string) => {
    const apiUrl = getApiBaseUrl();
    const embedCode = `<script src="${apiUrl}/widget.js?key=${widgetKey}"></script>`;
    navigator.clipboard.writeText(embedCode);
    setCopiedKey(widgetKey);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const addOrigin = () => {
    if (newOrigin && !formData.allowed_origins.includes(newOrigin)) {
      setFormData({
        ...formData,
        allowed_origins: [...formData.allowed_origins, newOrigin],
      });
      setNewOrigin('');
    }
  };

  const removeOrigin = (origin: string) => {
    setFormData({
      ...formData,
      allowed_origins: formData.allowed_origins.filter((o) => o !== origin),
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">Cargando widgets...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Widgets de Chat</h2>
        <button
          onClick={openCreateModal}
          className="btn-primary flex items-center gap-2"
        >
          <Plus size={18} />
          Nuevo Widget
        </button>
      </div>

      {/* Widgets Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
        {widgets?.map((widget: Widget) => (
          <div key={widget.id} className="card flex flex-col h-full p-3">
            <div className="flex items-start justify-between mb-2">
              <div className="p-1.5 bg-primary-100 rounded-lg">
                <MessageSquare
                  size={16}
                  className="text-primary-600"
                  style={{ color: widget.button_color }}
                />
              </div>
              <span
                className={`badge text-xs ${
                  widget.active ? 'badge-success' : 'badge-error'
                }`}
              >
                {widget.active ? <Check size={10} /> : <X size={10} />}
              </span>
            </div>

            <div className="flex-1 flex flex-col justify-center text-center min-h-0">
              <h3 className="font-semibold text-sm mb-1 line-clamp-1">{widget.name}</h3>
              <p className="text-xs text-gray-600 uppercase tracking-wide">
                {widget.widget_key}
              </p>
            </div>

            <div className="flex gap-2 pt-2 border-t mt-2">
              <button
                onClick={() => setShowEmbedCode(widget.widget_key)}
                className="p-2 hover:bg-gray-100 rounded transition-colors"
                title="Ver código de inserción"
              >
                <Code size={14} className="text-gray-600" />
              </button>
              <button
                onClick={() => copyEmbedCode(widget.widget_key)}
                className="p-2 hover:bg-gray-100 rounded transition-colors"
                title="Copiar código de inserción"
              >
                {copiedKey === widget.widget_key ? (
                  <Check size={14} className="text-green-600" />
                ) : (
                  <Copy size={14} className="text-gray-600" />
                )}
              </button>
              <button
                onClick={() => openEditModal(widget)}
                className="p-2 hover:bg-gray-100 rounded transition-colors"
                title="Editar"
              >
                <Edit2 size={14} className="text-gray-600" />
              </button>
              <button
                onClick={() => handleDelete(widget.id)}
                className="p-2 hover:bg-red-50 rounded transition-colors"
                title="Eliminar"
              >
                <Trash2 size={14} className="text-red-600" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Embed Code Modal */}
      {showEmbedCode && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60] p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full">
            <div className="px-6 py-4 border-b flex items-center justify-between">
              <h2 className="text-xl font-bold">Código de Inserción</h2>
              <button
                onClick={() => setShowEmbedCode(null)}
                className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100"
              >
                <X size={20} />
              </button>
            </div>
            <div className="p-6">
              <p className="text-sm text-gray-600 mb-4">
                Copia y pega este código en tu sitio web para insertar el widget:
              </p>
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4">
                <p className="text-xs text-blue-800">
                  <strong>Nota sobre puertos:</strong> Este código carga widget.js desde el puerto HTTP del API ({getApiBaseUrl()}). 
                  El widget.js luego se conectará automáticamente al puerto WebSocket (configurado con WEBCHAT_WS_PORT, por defecto 3078) 
                  para la comunicación en tiempo real. Son dos puertos diferentes: HTTP para cargar el script, WebSocket para el chat.
                </p>
              </div>
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 mb-4">
                <code className="text-sm text-gray-800 break-all">
                  {`<script src="${getApiBaseUrl()}/widget.js?key=${showEmbedCode}"></script>`}
                </code>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => {
                    const apiUrl = getApiBaseUrl();
                    const embedCode = `<script src="${apiUrl}/widget.js?key=${showEmbedCode}"></script>`;
                    navigator.clipboard.writeText(embedCode);
                    setCopiedKey(showEmbedCode);
                    setTimeout(() => setCopiedKey(null), 2000);
                  }}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center justify-center gap-2"
                >
                  {copiedKey === showEmbedCode ? (
                    <>
                      <Check size={16} />
                      Copiado
                    </>
                  ) : (
                    <>
                      <Copy size={16} />
                      Copiar Código
                    </>
                  )}
                </button>
                <button
                  onClick={() => setShowEmbedCode(null)}
                  className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  Cerrar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Empty State */}
      {widgets?.length === 0 && (
        <div className="text-center py-12 bg-gray-50 rounded-lg border-2 border-dashed border-gray-300">
          <MessageSquare className="w-16 h-16 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-gray-900 mb-2">
            No hay widgets configurados
          </h3>
          <p className="text-gray-600 mb-4">
            Crea tu primer widget para insertar en sitios web
          </p>
          <button
            onClick={openCreateModal}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            <Plus className="w-5 h-5" />
            Crear Widget
          </button>
        </div>
      )}

      {/* Create/Edit Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-3xl w-full max-h-[90vh] overflow-hidden flex flex-col">
            <div className="px-6 py-4 border-b flex items-center justify-between">
              <h2 className="text-xl font-bold">
                {editingWidget ? 'Editar Widget' : 'Crear Widget'}
              </h2>
              <button
                onClick={closeModal}
                className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100"
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto">
              <div className="p-6 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Nombre del Widget
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.name}
                    onChange={(e) =>
                      setFormData({ ...formData, name: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    placeholder="Ej: Widget Principal"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Widget Key (único)
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.widget_key}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        widget_key: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'),
                      })
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 font-mono text-sm"
                    placeholder="mi-widget-key"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Solo letras, números y guiones. Se usará en el código de inserción.
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Canal
                  </label>
                  <select
                    value={formData.channel_id}
                    onChange={(e) =>
                      setFormData({ ...formData, channel_id: e.target.value })
                    }
                    required
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">Selecciona un canal...</option>
                    {channels
                      ?.filter((c: any) => c.is_active && c.channel_type === 'webchat')
                      .map((channel: any) => (
                        <option key={channel.id} value={channel.id}>
                          {channel.name} ({channel.channel_type})
                        </option>
                      ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Orígenes Permitidos (CORS)
                  </label>
                  <div className="flex gap-2 mb-2">
                    <input
                      type="text"
                      value={newOrigin}
                      onChange={(e) => setNewOrigin(e.target.value)}
                      onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), addOrigin())}
                      placeholder="https://ejemplo.com o *.ejemplo.com"
                      className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm"
                    />
                    <button
                      type="button"
                      onClick={addOrigin}
                      className="px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm"
                    >
                      Agregar
                    </button>
                  </div>
                  {formData.allowed_origins.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {formData.allowed_origins.map((origin) => (
                        <span
                          key={origin}
                          className="inline-flex items-center gap-1 px-2 py-1 bg-blue-100 text-blue-800 rounded text-xs"
                        >
                          {origin}
                          <button
                            type="button"
                            onClick={() => removeOrigin(origin)}
                            className="hover:text-blue-600"
                          >
                            <X size={12} />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                  <p className="text-xs text-gray-500 mt-1">
                    Deja vacío para permitir todos los orígenes. Usa *.dominio.com para subdominios.
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Posición
                    </label>
                    <select
                      value={formData.position}
                      onChange={(e) =>
                        setFormData({ ...formData, position: e.target.value })
                      }
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="bottom-right">Inferior Derecha</option>
                      <option value="bottom-left">Inferior Izquierda</option>
                      <option value="top-right">Superior Derecha</option>
                      <option value="top-left">Superior Izquierda</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Color Principal
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="color"
                        value={formData.primary_color}
                        onChange={(e) =>
                          setFormData({ ...formData, primary_color: e.target.value })
                        }
                        className="w-16 h-10 border border-gray-300 rounded"
                      />
                      <input
                        type="text"
                        value={formData.primary_color}
                        onChange={(e) =>
                          setFormData({ ...formData, primary_color: e.target.value })
                        }
                        className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 font-mono text-sm"
                      />
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Color del Botón
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="color"
                        value={formData.button_color}
                        onChange={(e) =>
                          setFormData({ ...formData, button_color: e.target.value })
                        }
                        className="w-16 h-10 border border-gray-300 rounded"
                      />
                      <input
                        type="text"
                        value={formData.button_color}
                        onChange={(e) =>
                          setFormData({ ...formData, button_color: e.target.value })
                        }
                        className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 font-mono text-sm"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Color del Texto del Botón
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="color"
                        value={formData.button_text_color}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            button_text_color: e.target.value,
                          })
                        }
                        className="w-16 h-10 border border-gray-300 rounded"
                      />
                      <input
                        type="text"
                        value={formData.button_text_color}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            button_text_color: e.target.value,
                          })
                        }
                        className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 font-mono text-sm"
                      />
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Mensaje de Bienvenida
                  </label>
                  <textarea
                    value={formData.welcome_message}
                    onChange={(e) =>
                      setFormData({ ...formData, welcome_message: e.target.value })
                    }
                    rows={3}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    placeholder="¡Hola! ¿En qué puedo ayudarte?"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Texto del Placeholder
                  </label>
                  <input
                    type="text"
                    value={formData.placeholder_text}
                    onChange={(e) =>
                      setFormData({ ...formData, placeholder_text: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Tamaño del Botón (px)
                    </label>
                    <input
                      type="number"
                      min="40"
                      max="100"
                      value={formData.button_size}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          button_size: parseInt(e.target.value) || 56,
                        })
                      }
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Ancho del Chat (px)
                    </label>
                    <input
                      type="number"
                      min="300"
                      max="600"
                      value={formData.chat_width}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          chat_width: parseInt(e.target.value) || 380,
                        })
                      }
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Alto del Chat (px)
                    </label>
                    <input
                      type="number"
                      min="400"
                      max="800"
                      value={formData.chat_height}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          chat_height: parseInt(e.target.value) || 500,
                        })
                      }
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>

                <div className="flex items-center gap-4">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={formData.show_typing_indicator}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          show_typing_indicator: e.target.checked,
                        })
                      }
                      className="w-4 h-4 text-blue-600 border-gray-300 rounded"
                    />
                    <span className="text-sm text-gray-700">
                      Mostrar indicador de escritura
                    </span>
                  </label>

                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={formData.enable_sound}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          enable_sound: e.target.checked,
                        })
                      }
                      className="w-4 h-4 text-blue-600 border-gray-300 rounded"
                    />
                    <span className="text-sm text-gray-700">Habilitar sonidos</span>
                  </label>

                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={formData.active}
                      onChange={(e) =>
                        setFormData({ ...formData, active: e.target.checked })
                      }
                      className="w-4 h-4 text-blue-600 border-gray-300 rounded"
                    />
                    <span className="text-sm text-gray-700">Activo</span>
                  </label>
                </div>
              </div>

              <div className="px-6 py-4 border-t bg-gray-50 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={closeModal}
                  className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={createMutation.isPending || updateMutation.isPending}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
                >
                  {createMutation.isPending || updateMutation.isPending
                    ? 'Guardando...'
                    : editingWidget
                    ? 'Actualizar'
                    : 'Crear'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

