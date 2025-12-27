import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/services/api';
import { Brain, Check, X, Plus, Edit2, Trash2 } from 'lucide-react';
import { Modal } from '@/components/Modal';

interface LLMConfig {
  id?: string;
  provider: string;
  model: string;
  config: any;
  priority?: number;
  active?: boolean;
  instance_identifier?: string;
  name?: string;
}

export function LLMs() {
  const queryClient = useQueryClient();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingLLM, setEditingLLM] = useState<LLMConfig | null>(null);
  const [formData, setFormData] = useState<LLMConfig>({
    provider: 'openai',
    model: '',
    config: {},
    priority: 10,
    active: true,
    instance_identifier: 'default',
    name: '',
  });

  const { data: llms, isLoading } = useQuery({
    queryKey: ['llms'],
    queryFn: () => api.getLLMs(),
  });

  const createMutation = useMutation({
    mutationFn: (data: LLMConfig) => api.createLLM(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['llms'] });
      closeModal();
    },
    onError: (error: any) => {
      const errorMessage = error?.response?.data?.error?.message || error?.response?.data?.message || error?.message || 'Error al crear el LLM';
      if (error?.response?.status === 409) {
        alert(`Error: ${errorMessage}`);
      } else {
        alert(`Error al crear el LLM: ${errorMessage}`);
      }
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, ...data }: LLMConfig & { id: string }) =>
      api.updateLLM(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['llms'] });
      closeModal();
    },
    onError: (error: any) => {
      const errorMessage = error?.response?.data?.error?.message || error?.response?.data?.message || error?.message || 'Error al actualizar el LLM';
      if (error?.response?.status === 409) {
        alert(`Error: ${errorMessage}`);
      } else {
        alert(`Error al actualizar el LLM: ${errorMessage}`);
      }
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deleteLLM(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['llms'] });
    },
  });

  const openCreateModal = () => {
    setEditingLLM(null);
    setFormData({
      provider: 'openai',
      model: '',
      config: {},
      priority: 10,
      active: true,
      instance_identifier: 'default',
      name: '',
    });
    setIsModalOpen(true);
  };

  const openEditModal = (llm: any) => {
    setEditingLLM(llm);
    setFormData({
      provider: llm.provider,
      model: llm.model,
      config: llm.config || {},
      priority: llm.priority,
      active: llm.active,
      instance_identifier: llm.instance_identifier || 'default',
      name: llm.name || '',
    });
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingLLM(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (editingLLM) {
      updateMutation.mutate({ ...formData, id: editingLLM.id! });
    } else {
      createMutation.mutate(formData);
    }
  };

  const handleDelete = (id: string) => {
    if (confirm('Are you sure you want to delete this LLM configuration?')) {
      deleteMutation.mutate(id);
    }
  };

  if (isLoading) {
    return <div className="flex justify-center p-8">Loading...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">LLM Providers</h2>
        <button onClick={openCreateModal} className="btn-primary flex items-center gap-2">
          <Plus size={18} />
          Add Provider
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
        {llms?.map((llm: any) => (
          <div key={llm.id} className="card flex flex-col h-full p-3">
            <div className="flex items-start justify-between mb-2">
              <div className="p-1.5 bg-purple-100 rounded-lg">
                <Brain className="text-purple-600" size={16} />
              </div>
              <span
                className={`badge text-xs ${
                  llm.active ? 'badge-success' : 'badge-error'
                }`}
              >
                {llm.active ? <Check size={10} /> : <X size={10} />}
              </span>
            </div>

            <div className="flex-1 flex flex-col justify-center text-center min-h-0">
              <h3 className="font-semibold text-sm mb-1">{llm.name || llm.provider.toUpperCase()}</h3>
              <p className="text-xs text-gray-600 mb-1 line-clamp-1">{llm.model}</p>
              {llm.instance_identifier && llm.instance_identifier !== 'default' && (
                <p className="text-xs text-gray-500 mb-1">Instance: {llm.instance_identifier}</p>
              )}
              <span className="text-xs text-gray-500">Priority: {llm.priority || 10}</span>
            </div>

            <div className="flex gap-2 pt-2 border-t mt-2">
              <button
                onClick={() => openEditModal(llm)}
                className="p-2 hover:bg-gray-100 rounded transition-colors"
                title="Edit"
              >
                <Edit2 size={14} className="text-gray-600" />
              </button>
              <button
                onClick={() => handleDelete(llm.id)}
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
        title={editingLLM ? 'Edit LLM Provider' : 'Add LLM Provider'}
        maxWidth="md"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Provider</label>
            <select
              value={formData.provider}
              onChange={(e) =>
                setFormData({ ...formData, provider: e.target.value, config: {} })
              }
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
              required
            >
              <option value="openai">OpenAI</option>
              <option value="anthropic">Anthropic</option>
              <option value="google">Google</option>
              <option value="ollama">Ollama</option>
              <option value="lmstudio">LMStudio</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Model</label>
            <input
              type="text"
              value={formData.model}
              onChange={(e) => setFormData({ ...formData, model: e.target.value })}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
              placeholder="e.g., gpt-4, claude-3-opus-20240229, llama2"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Name (Optional)</label>
            <input
              type="text"
              value={formData.name || ''}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
              placeholder="e.g., Ollama Server 1 - llama2"
            />
            <p className="text-xs text-gray-500 mt-1">
              Display name for this LLM configuration. If empty, will be auto-generated.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Instance Identifier</label>
            <input
              type="text"
              value={formData.instance_identifier || 'default'}
              onChange={(e) => setFormData({ ...formData, instance_identifier: e.target.value || 'default' })}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
              placeholder="default"
            />
            <p className="text-xs text-gray-500 mt-1">
              Unique identifier for multiple instances of the same provider+model (e.g., "server1", "server2"). 
              Use "default" for single instance.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">API Key</label>
            <input
              type="password"
              value={formData.config.apiKey || ''}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  config: { ...formData.config, apiKey: e.target.value },
                })
              }
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
              placeholder="API Key"
            />
          </div>

          {(formData.provider === 'ollama' || formData.provider === 'lmstudio') && (
            <div>
              <label className="block text-sm font-medium mb-1">Base URL</label>
              <input
                type="text"
                value={formData.config.baseURL || formData.config.baseUrl || ''}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    config: { ...formData.config, baseURL: e.target.value, baseUrl: e.target.value },
                  })
                }
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
                placeholder={formData.provider === 'ollama' ? 'http://localhost:11434' : 'http://localhost:1234/v1'}
              />
              <p className="text-xs text-gray-500 mt-1">
                {formData.provider === 'ollama' 
                  ? 'Ollama server URL (default: http://localhost:11434)'
                  : 'LMStudio server URL (default: http://localhost:1234/v1)'}
              </p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Priority</label>
              <input
                type="number"
                value={formData.priority}
                onChange={(e) =>
                  setFormData({ ...formData, priority: parseInt(e.target.value) })
                }
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
                min="1"
                max="100"
              />
              <p className="text-xs text-gray-500 mt-1">Lower number = higher priority</p>
            </div>

            <div className="flex items-center">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="llm-active"
                  checked={formData.active}
                  onChange={(e) => setFormData({ ...formData, active: e.target.checked })}
                  className="rounded"
                />
                <label htmlFor="llm-active" className="text-sm">
                  Active
                </label>
              </div>
            </div>
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
                : editingLLM
                ? 'Update'
                : 'Create'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
