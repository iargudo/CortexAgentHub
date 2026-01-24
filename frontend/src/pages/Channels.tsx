import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/services/api';
import { MessageSquare, Check, X, Plus, Edit2, Trash2, Send, Phone, Copy, CheckCircle, AlertCircle } from 'lucide-react';
import { Modal } from '@/components/Modal';

interface ChannelConfig {
  id?: string;
  type: string;
  name: string;
  config: any;
  active?: boolean;
}

export function Channels() {
  const queryClient = useQueryClient();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingChannel, setEditingChannel] = useState<ChannelConfig | null>(null);
  const [formData, setFormData] = useState<ChannelConfig>({
    type: 'whatsapp',
    name: '',
    config: {
      provider: 'ultramsg', // Default provider for WhatsApp
    },
    active: true,
  });

  // Estado para modal de envío de WhatsApp
  const [sendModalOpen, setSendModalOpen] = useState(false);
  const [sendingChannelId, setSendingChannelId] = useState<string | null>(null);
  const [phoneNumber, setPhoneNumber] = useState('');
  const [messageToSend, setMessageToSend] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [sendResult, setSendResult] = useState<{ success: boolean; message: string } | null>(null);

  const { data: channels, isLoading } = useQuery({
    queryKey: ['channels'],
    queryFn: () => api.getChannels(),
  });

  const createMutation = useMutation({
    mutationFn: (data: ChannelConfig) => api.createChannel(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['channels'] });
      closeModal();
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, ...data }: ChannelConfig & { id: string }) =>
      api.updateChannel(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['channels'] });
      closeModal();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deleteChannel(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['channels'] });
    },
  });

  const openCreateModal = () => {
    setEditingChannel(null);
    setFormData({
      type: 'whatsapp',
      name: '',
      config: {
        provider: 'ultramsg', // Default provider for WhatsApp
      },
      active: true,
    });
    setIsModalOpen(true);
  };

  const openEditModal = (channel: any) => {
    setEditingChannel(channel);
    
    // Parse config si viene como string JSON (PostgreSQL puede devolverlo así)
    let config: any = {};
    if (typeof channel.config === 'string') {
      try {
        config = JSON.parse(channel.config);
      } catch (e) {
        console.error('Error parsing channel config:', e);
        config = {};
      }
    } else if (channel.config && typeof channel.config === 'object') {
      config = { ...channel.config };
    } else {
      // Si config es null o undefined, inicializar como objeto vacío
      config = {};
    }
    
    const channelType = channel.channel_type || channel.type;
    
    // Clean config: remove instanceIdentifier if present (not needed, we use channel id)
    // NOTE: Keep instanceId - it's required for Ultramsg configuration
    if (config.instanceIdentifier) delete config.instanceIdentifier; // Only remove instanceIdentifier, NOT instanceId
    
    if (channelType === 'whatsapp') {
      // CRÍTICO: Si no hay provider en el config, establecer 'ultramsg' por defecto
      // Esto es importante para canales creados antes de soportar múltiples proveedores
      // DEBE establecerse ANTES de setFormData para que los campos se muestren inmediatamente
      if (!config.provider || config.provider === '' || config.provider === null || config.provider === undefined) {
        config.provider = 'ultramsg';
      }
    }
    
    // Debug: log para verificar qué se está cargando
    console.log('Editing channel:', {
      channelType,
      channelId: channel.id,
      originalConfig: channel.config,
      parsedConfig: config,
      provider: config.provider,
      hasProvider: !!config.provider,
      willShowUltramsgFields: channelType === 'whatsapp' && (config.provider === 'ultramsg' || !config.provider),
    });
    
    // Establecer formData con el config que ya tiene el provider establecido
    // Asegurarse de que config siempre sea un objeto válido (no null/undefined)
    const finalConfig = config && typeof config === 'object' ? { ...config } : {};
    
    // CRÍTICO: Si es WhatsApp y no tiene provider, establecerlo AHORA (no esperar al useEffect)
    // Esto asegura que los campos se muestren inmediatamente al abrir el modal
    if (channelType === 'whatsapp' && (!finalConfig.provider || finalConfig.provider === '' || finalConfig.provider === null || finalConfig.provider === undefined)) {
      finalConfig.provider = 'ultramsg';
      console.log('Setting provider to ultramsg immediately in openEditModal');
    }
    
    console.log('Setting formData with config:', {
      channelType,
      finalConfig,
      provider: finalConfig.provider,
      willShowFields: channelType === 'whatsapp' && finalConfig.provider === 'ultramsg',
    });
    
    setFormData({
      type: channelType,
      name: channel.name,
      config: finalConfig, // Este config ya tiene provider establecido si es whatsapp
      active: channel.active !== undefined ? channel.active : (channel.is_active !== undefined ? channel.is_active : true),
    });
    
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingChannel(null);
  };

  // Asegurar que el provider se establezca correctamente cuando el tipo es whatsapp
  // Este useEffect se ejecuta cuando el modal se abre o cuando cambia el tipo
  useEffect(() => {
    if (isModalOpen && formData.type === 'whatsapp') {
      // Si no hay provider o está vacío, establecer 'ultramsg' por defecto
      const currentProvider = formData.config?.provider;
      if (!currentProvider || currentProvider === '' || currentProvider === null || currentProvider === undefined) {
        console.log('Setting default provider to ultramsg in useEffect');
        setFormData(prev => ({
          ...prev,
          config: {
            ...(prev.config || {}),
            provider: 'ultramsg',
          },
        }));
      }
    }
  }, [isModalOpen, formData.type]); // Removido formData.config?.provider de las dependencias para evitar loops

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // Preparar payload - el id (UUID) se genera automáticamente en el backend
    const payload: any = {
      channel_type: formData.type,
      name: formData.name,
      config: formData.config,
      is_active: formData.active,
    };

    if (editingChannel) {
      updateMutation.mutate({ ...payload, id: editingChannel.id! });
    } else {
      createMutation.mutate(payload);
    }
  };

  const handleDelete = (id: string) => {
    if (confirm('Are you sure you want to delete this channel?')) {
      deleteMutation.mutate(id);
    }
  };

  const openSendModal = (channelId: string) => {
    setSendingChannelId(channelId);
    setPhoneNumber('');
    setMessageToSend('');
    setSendResult(null);
    setSendModalOpen(true);
  };

  const closeSendModal = () => {
    setSendModalOpen(false);
    setSendingChannelId(null);
    setPhoneNumber('');
    setMessageToSend('');
    setSendResult(null);
  };

  const handleSendWhatsApp = async () => {
    if (!phoneNumber.trim() || !messageToSend.trim() || !sendingChannelId) return;

    setIsSending(true);
    setSendResult(null);

    try {
      await api.sendWhatsAppToNumber(
        phoneNumber.trim(),
        messageToSend.trim(),
        sendingChannelId
      );
      setSendResult({ success: true, message: '¡Mensaje enviado correctamente!' });
      // Limpiar formulario después de éxito
      setPhoneNumber('');
      setMessageToSend('');
    } catch (err: any) {
      setSendResult({
        success: false,
        message: err.response?.data?.error?.message || 'Error al enviar el mensaje',
      });
    } finally {
      setIsSending(false);
    }
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch (e) {
      // Fallback (older browsers / non-secure contexts)
      const el = document.createElement('textarea');
      el.value = text;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
    }
  };

  const formatId = (id?: string) => {
    if (!id) return '';
    if (id.length <= 14) return id;
    return `${id.slice(0, 8)}…${id.slice(-4)}`;
  };

  if (isLoading) {
    return <div className="flex justify-center p-8">Loading...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Channel Management</h2>
        <button onClick={openCreateModal} className="btn-primary flex items-center gap-2">
          <Plus size={18} />
          Add Channel
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
        {channels?.map((channel: any) => (
          <div key={channel.id} className="card flex flex-col h-full p-3">
            <div className="flex items-start justify-between mb-2">
              <div className="p-1.5 bg-primary-100 rounded-lg">
                <MessageSquare className="text-primary-600" size={16} />
              </div>
              <span
                className={`badge text-xs ${
                  channel.active ? 'badge-success' : 'badge-error'
                }`}
              >
                {channel.active ? <Check size={10} /> : <X size={10} />}
              </span>
            </div>

            <div className="flex-1 flex flex-col justify-center text-center min-h-0">
              <h3 className="font-semibold text-sm mb-1 line-clamp-1">{channel.name}</h3>
              <p className="text-xs text-gray-600 uppercase tracking-wide">
                {channel.channel_type || channel.type}
              </p>
              {channel.id && (
                <div className="mt-2 flex items-center justify-center gap-2 text-xs text-gray-500">
                  <span className="font-mono" title={channel.id}>
                    ID: {formatId(channel.id)}
                  </span>
                  <button
                    type="button"
                    onClick={() => copyToClipboard(channel.id)}
                    className="p-1 hover:bg-gray-100 rounded transition-colors"
                    title="Copiar ID"
                  >
                    <Copy size={12} className="text-gray-500" />
                  </button>
                </div>
              )}
            </div>

            <div className="flex gap-2 pt-2 border-t mt-2">
              {(channel.channel_type || channel.type) === 'whatsapp' && channel.active && (
                <button
                  onClick={() => openSendModal(channel.id)}
                  className="p-2 hover:bg-green-50 rounded transition-colors"
                  title="Enviar WhatsApp"
                >
                  <Send size={14} className="text-green-600" />
                </button>
              )}
              <button
                onClick={() => openEditModal(channel)}
                className="p-2 hover:bg-gray-100 rounded transition-colors"
                title="Edit"
              >
                <Edit2 size={14} className="text-gray-600" />
              </button>
              <button
                onClick={() => handleDelete(channel.id)}
                className="p-2 hover:bg-red-50 rounded transition-colors"
                title="Delete"
              >
                <Trash2 size={14} className="text-red-600" />
              </button>
            </div>
          </div>
        ))}
      </div>

      <Modal
        isOpen={isModalOpen}
        onClose={closeModal}
        title={editingChannel ? 'Edit Channel' : 'Create Channel'}
        maxWidth="md"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Channel Type</label>
            <select
              value={formData.type}
              onChange={(e) => {
                const newType = e.target.value;
                let newConfig: any = {};
                // Si cambia a WhatsApp, inicializar con provider por defecto
                if (newType === 'whatsapp') {
                  newConfig = { provider: 'ultramsg' };
                }
                setFormData({ ...formData, type: newType, config: newConfig });
              }}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
              required
            >
              <option value="whatsapp">WhatsApp</option>
              <option value="telegram">Telegram</option>
              <option value="email">Email</option>
              <option value="webchat">WebChat</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Channel Name</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
              placeholder="e.g., WhatsApp Business"
              required
            />
          </div>


          {formData.type === 'whatsapp' && (
            <>
              <div>
                <label className="block text-sm font-medium mb-1">Provider</label>
                <select
                  value={formData.config?.provider || 'ultramsg'}
                  onChange={(e) => {
                    const newProvider = e.target.value;
                    console.log('Provider changed to:', newProvider);
                    setFormData({
                      ...formData,
                      config: { ...formData.config, provider: newProvider },
                    });
                  }}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
                >
                  <option value="ultramsg">Ultramsg</option>
                  <option value="twilio">Twilio</option>
                  <option value="360dialog">360dialog</option>
                </select>
                {/* Debug info */}
                {process.env.NODE_ENV === 'development' && (
                  <p className="text-xs text-gray-400 mt-1">
                    Debug: provider = "{formData.config?.provider || 'undefined'}"
                  </p>
                )}
              </div>

              {/* Ultramsg Configuration */}
              {(formData.config?.provider === 'ultramsg' || (formData.type === 'whatsapp' && (!formData.config?.provider || formData.config.provider === ''))) && (
                <>
                  <div>
                    <label className="block text-sm font-medium mb-1">Instance ID</label>
                    <input
                      type="text"
                      value={formData.config.instanceId || ''}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          config: { ...formData.config, instanceId: e.target.value },
                        })
                      }
                      className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
                      placeholder="Instance ID"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Token</label>
                    <input
                      type="password"
                      value={formData.config.token || ''}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          config: { ...formData.config, token: e.target.value },
                        })
                      }
                      className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
                      placeholder="API Token"
                    />
                  </div>
                </>
              )}

              {/* Twilio Configuration */}
              {formData.config.provider === 'twilio' && (
                <>
                  <div>
                    <label className="block text-sm font-medium mb-1">Account SID</label>
                    <input
                      type="text"
                      value={formData.config.accountSid || ''}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          config: { ...formData.config, accountSid: e.target.value },
                        })
                      }
                      className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
                      placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Auth Token</label>
                    <input
                      type="password"
                      value={formData.config.authToken || ''}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          config: { ...formData.config, authToken: e.target.value },
                        })
                      }
                      className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
                      placeholder="Auth Token"
                    />
                  </div>
                  {/* Instance Identifier is auto-generated as GUID - no manual input needed */}
                </>
              )}

              {/* 360dialog Configuration */}
              {formData.config.provider === '360dialog' && (
                <>
                  <div>
                    <label className="block text-sm font-medium mb-1">
                      API Key (D360-API-KEY) <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="password"
                      value={formData.config.token || ''}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          config: { ...formData.config, token: e.target.value },
                        })
                      }
                      className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
                      placeholder="D360-API-KEY"
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      API Key única para tu número de WhatsApp Business
                    </p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">
                      Phone Number ID <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={formData.config.phoneNumberId || ''}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          config: { ...formData.config, phoneNumberId: e.target.value },
                        })
                      }
                      className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
                      placeholder="WhatsApp Business Phone Number ID"
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      ID del número de teléfono de WhatsApp Business (se encuentra en el Hub de 360dialog)
                    </p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">
                      Phone Number <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={formData.config.phoneNumber || ''}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          config: { ...formData.config, phoneNumber: e.target.value },
                        })
                      }
                      className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
                      placeholder="+593995906687"
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      Número de teléfono completo con código de país (ej: +593995906687)
                    </p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">
                      WhatsApp Business Account ID (Opcional)
                    </label>
                    <input
                      type="text"
                      value={formData.config.wabaId || ''}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          config: { ...formData.config, wabaId: e.target.value },
                        })
                      }
                      className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
                      placeholder="WABA ID (opcional)"
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      ID de la cuenta de WhatsApp Business (útil para multi-cuenta)
                    </p>
                  </div>
                  {/* Instance Identifier is auto-generated as GUID - no manual input needed */}
                </>
              )}

              {/* Common fields for Ultramsg and Twilio */}
              {(formData.config.provider === 'ultramsg' || formData.config.provider === 'twilio') && (
                <div>
                  <label className="block text-sm font-medium mb-1">Phone Number</label>
                  <input
                    type="text"
                    value={formData.config.phoneNumber || ''}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        config: { ...formData.config, phoneNumber: e.target.value },
                      })
                    }
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
                    placeholder="+593995906687"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Número de teléfono completo con código de país
                  </p>
                </div>
              )}
            </>
          )}

          {formData.type === 'telegram' && (
            <div>
              <label className="block text-sm font-medium mb-1">Bot Token</label>
              <input
                type="text"
                value={formData.config.botToken || ''}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    config: { ...formData.config, botToken: e.target.value },
                  })
                }
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
                placeholder="Bot Token from @BotFather"
              />
            </div>
          )}

          {formData.type === 'email' && (
            <>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">SMTP Host</label>
                  <input
                    type="text"
                    value={formData.config.smtp?.host || ''}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        config: {
                          ...formData.config,
                          smtp: { ...formData.config.smtp, host: e.target.value },
                        },
                      })
                    }
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
                    placeholder="smtp.gmail.com"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">SMTP Port</label>
                  <input
                    type="number"
                    value={formData.config.smtp?.port || 587}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        config: {
                          ...formData.config,
                          smtp: { ...formData.config.smtp, port: parseInt(e.target.value) },
                        },
                      })
                    }
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">SMTP User</label>
                  <input
                    type="text"
                    value={formData.config.smtp?.user || ''}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        config: {
                          ...formData.config,
                          smtp: { ...formData.config.smtp, user: e.target.value },
                        },
                      })
                    }
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">SMTP Password</label>
                  <input
                    type="password"
                    value={formData.config.smtp?.pass || ''}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        config: {
                          ...formData.config,
                          smtp: { ...formData.config.smtp, pass: e.target.value },
                        },
                      })
                    }
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
                  />
                </div>
              </div>
            </>
          )}

          {formData.type === 'webchat' && (
            <>
              <div>
                <label className="block text-sm font-medium mb-1">JWT Secret</label>
                <input
                  type="password"
                  value={formData.config.jwtSecret || ''}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      config: { ...formData.config, jwtSecret: e.target.value },
                    })
                  }
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
                  placeholder="your-jwt-secret-here"
                />
                <p className="text-xs text-gray-500 mt-1">
                  El puerto WebSocket se configura globalmente con la variable de entorno WEBCHAT_WS_PORT (por defecto: 3078). Todos los canales WebChat comparten el mismo puerto.
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Allowed Origins (comma-separated)</label>
                <input
                  type="text"
                  value={
                    Array.isArray(formData.config.allowedOrigins)
                      ? formData.config.allowedOrigins.join(', ')
                      : ''
                  }
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      config: {
                        ...formData.config,
                        allowedOrigins: e.target.value.split(',').map((s) => s.trim()),
                      },
                    })
                  }
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
                  placeholder="https://empresa.com, http://localhost:5174"
                />
                <p className="text-xs text-gray-500 mt-1">
                  CORS allowed origins. Use * for all origins (not recommended for production)
                </p>
              </div>
            </>
          )}

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="active"
              checked={formData.active}
              onChange={(e) => setFormData({ ...formData, active: e.target.checked })}
              className="rounded"
            />
            <label htmlFor="active" className="text-sm">
              Active
            </label>
          </div>

          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={closeModal}
              className="btn-secondary flex-1"
              disabled={createMutation.isPending || updateMutation.isPending}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn-primary flex-1"
              disabled={createMutation.isPending || updateMutation.isPending}
            >
              {createMutation.isPending || updateMutation.isPending
                ? 'Saving...'
                : editingChannel
                ? 'Update'
                : 'Create'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Modal de Envío de WhatsApp */}
      <Modal
        isOpen={sendModalOpen}
        onClose={closeSendModal}
        title="Enviar WhatsApp"
        maxWidth="md"
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Envía un mensaje de WhatsApp a cualquier número usando este canal.
          </p>

          <div>
            <label className="block text-sm font-medium mb-1">
              <div className="flex items-center gap-2">
                <Phone size={14} />
                Número de Teléfono
              </div>
            </label>
            <input
              type="text"
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value)}
              placeholder="593991234567"
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-green-500"
              disabled={isSending}
            />
            <p className="text-xs text-gray-500 mt-1">
              Incluye el código de país sin el signo +. Ejemplo: 593991234567
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">
              <div className="flex items-center gap-2">
                <MessageSquare size={14} />
                Mensaje
              </div>
            </label>
            <textarea
              value={messageToSend}
              onChange={(e) => setMessageToSend(e.target.value)}
              placeholder="Escribe tu mensaje aquí..."
              className="w-full h-32 px-3 py-2 border rounded-lg focus:ring-2 focus:ring-green-500 resize-none"
              disabled={isSending}
            />
          </div>

          {sendResult && (
            <div
              className={`p-3 rounded-lg flex items-start gap-2 ${
                sendResult.success
                  ? 'bg-green-50 border border-green-200'
                  : 'bg-red-50 border border-red-200'
              }`}
            >
              {sendResult.success ? (
                <CheckCircle size={16} className="text-green-600 flex-shrink-0 mt-0.5" />
              ) : (
                <AlertCircle size={16} className="text-red-600 flex-shrink-0 mt-0.5" />
              )}
              <p className={`text-sm ${sendResult.success ? 'text-green-700' : 'text-red-700'}`}>
                {sendResult.message}
              </p>
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={closeSendModal}
              className="btn-secondary flex-1"
              disabled={isSending}
            >
              Cerrar
            </button>
            <button
              type="button"
              onClick={handleSendWhatsApp}
              disabled={isSending || !phoneNumber.trim() || !messageToSend.trim()}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isSending ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"></div>
                  Enviando...
                </>
              ) : (
                <>
                  <Send size={16} />
                  Enviar
                </>
              )}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
