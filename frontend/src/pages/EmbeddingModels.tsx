import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/services/api';
import { Plus, Edit, X, Brain, Key, AlertCircle, Check, Trash2 } from 'lucide-react';
import { Modal } from '@/components/Modal';

interface EmbeddingModel {
  id: string;
  name: string;
  provider: string;
  model_name: string;
  dimensions: number;
  api_key_encrypted?: string;
  config: any;
  active: boolean;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export function EmbeddingModels() {
  const queryClient = useQueryClient();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingModel, setEditingModel] = useState<EmbeddingModel | null>(null);
  const [formData, setFormData] = useState<Partial<EmbeddingModel>>({
    name: '',
    provider: 'openai',
    model_name: '',
    dimensions: 1536,
    config: {},
    active: true,
    is_default: false,
  });

  const { data: models, isLoading } = useQuery({
    queryKey: ['embedding-models'],
    queryFn: () => api.getEmbeddingModels(),
  });

  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      const response = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:3000'}/api/admin/embedding-models`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`,
        },
        body: JSON.stringify(data),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to create embedding model');
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['embedding-models'] });
      closeModal();
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, ...data }: any) => {
      const response = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:3000'}/api/admin/embedding-models/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`,
        },
        body: JSON.stringify(data),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to update embedding model');
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['embedding-models'] });
      closeModal();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:3000'}/api/admin/embedding-models/${id}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`,
        },
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to delete embedding model');
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['embedding-models'] });
    },
  });

  const openCreateModal = () => {
    setEditingModel(null);
    setFormData({
      name: '',
      provider: 'openai',
      model_name: 'text-embedding-3-small',
      dimensions: 1536,
      config: {},
      active: true,
      is_default: false,
    });
    setIsModalOpen(true);
  };

  const openEditModal = (model: EmbeddingModel) => {
    setEditingModel(model);
    setFormData({
      name: model.name,
      provider: model.provider,
      model_name: model.model_name,
      dimensions: model.dimensions,
      config: {
        ...(model.config || {}),
        // Map api_key_encrypted from backend to apiKey in form
        apiKey: model.api_key_encrypted || '',
      },
      active: model.active,
      is_default: model.is_default,
    });
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingModel(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const payload: any = {
      name: formData.name,
      provider: formData.provider,
      model_name: formData.model_name,
      dimensions: formData.dimensions,
      config: {
        ...formData.config,
        // Remove apiKey from config, it goes to api_key_encrypted
        apiKey: undefined,
      },
      active: formData.active !== undefined ? formData.active : true,
      is_default: formData.is_default || false,
    };

    // Add API key if provided (in production, this should be encrypted on the server)
    if (formData.config?.apiKey) {
      payload.api_key_encrypted = formData.config.apiKey;
    }

    if (editingModel) {
      updateMutation.mutate({ id: editingModel.id, ...payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">Loading embedding models...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Embedding Models</h2>
        <button onClick={openCreateModal} className="btn-primary flex items-center gap-2">
          <Plus size={18} />
          Add Model
        </button>
      </div>

      {models && models.length > 0 ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {models.map((model: EmbeddingModel) => (
            <div
              key={model.id}
              className="card flex flex-col h-full p-3"
            >
              <div className="flex items-start justify-between mb-2">
                <div className="p-1.5 bg-primary-100 rounded-lg">
                  <Brain className="text-primary-600" size={16} />
                </div>
                <span
                  className={`badge text-xs ${
                    model.active ? 'badge-success' : 'badge-error'
                  }`}
                >
                  {model.active ? <Check size={10} /> : <X size={10} />}
                </span>
              </div>

              <div className="flex-1 min-h-0">
                <h3 className="font-semibold text-sm mb-1 line-clamp-1">{model.name}</h3>
                <p className="text-xs text-gray-600 mb-1 line-clamp-1 uppercase">{model.provider}</p>
                <div className="space-y-0.5 text-xs">
                  <div className="flex justify-between">
                    <span className="text-gray-500">Model:</span>
                    <span className="font-medium truncate ml-2">{model.model_name}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Dims:</span>
                    <span className="font-medium">{model.dimensions}</span>
                  </div>
                  {model.is_default && (
                    <div className="flex justify-between">
                      <span className="text-gray-500">Default:</span>
                      <span className="text-green-600 font-medium">✓</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-gray-500">API:</span>
                    <span>
                      {model.api_key_encrypted ? (
                        <Key size={12} className="text-green-600" />
                      ) : (
                        <AlertCircle size={12} className="text-red-600" />
                      )}
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex gap-2 pt-2 border-t mt-2">
                <button
                  onClick={() => openEditModal(model)}
                  className="p-2 hover:bg-gray-100 rounded transition-colors"
                  title="Edit"
                >
                  <Edit size={14} className="text-gray-600" />
                </button>
                <button
                  onClick={() => {
                    if (confirm(`Are you sure you want to delete "${model.name}"? This action cannot be undone.`)) {
                      deleteMutation.mutate(model.id);
                    }
                  }}
                  className="p-2 hover:bg-red-50 rounded transition-colors"
                  title="Delete"
                  disabled={deleteMutation.isPending}
                >
                  <Trash2 size={14} className="text-red-600" />
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-lg p-12 text-center">
          <Brain className="mx-auto text-gray-400 mb-4" size={48} />
          <h3 className="text-lg font-semibold text-gray-900 mb-2">No embedding models</h3>
          <p className="text-gray-600 mb-6">
            Get started by creating your first embedding model configuration.
          </p>
          <button
            onClick={openCreateModal}
            className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
          >
            Add Model
          </button>
        </div>
      )}

      <Modal
        isOpen={isModalOpen}
        onClose={closeModal}
        title={editingModel ? 'Edit Embedding Model' : 'Create Embedding Model'}
        maxWidth="md"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Name</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
              placeholder="e.g., OpenAI text-embedding-3-small"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Provider</label>
            <select
              value={formData.provider}
              onChange={(e) => setFormData({ ...formData, provider: e.target.value })}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
              required
            >
              <option value="openai">OpenAI</option>
              <option value="azure-openai">Azure OpenAI</option>
              <option value="cohere">Cohere</option>
              <option value="huggingface">HuggingFace</option>
              <option value="local">Local</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Model Name</label>
            <input
              type="text"
              value={formData.model_name}
              onChange={(e) => setFormData({ ...formData, model_name: e.target.value })}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
              placeholder="e.g., text-embedding-3-small, embed-english-v3.0"
              required
            />
            <p className="text-xs text-gray-500 mt-1">
              {formData.provider === 'openai' && 'Examples: text-embedding-3-small (1536), text-embedding-3-large (3072)'}
              {formData.provider === 'cohere' && 'Examples: embed-english-v3.0 (1024), embed-multilingual-v3.0 (1024)'}
              {formData.provider === 'huggingface' && 'Examples: sentence-transformers/all-MiniLM-L6-v2 (384)'}
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Dimensions</label>
            <input
              type="number"
              value={formData.dimensions}
              onChange={(e) => setFormData({ ...formData, dimensions: parseInt(e.target.value) })}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
              placeholder="1536"
              required
              min="1"
            />
            <p className="text-xs text-gray-500 mt-1">
              Vector dimensions (typically 1536 for OpenAI, 384-1024 for others)
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">API Key</label>
            <input
              type="password"
              value={formData.config?.apiKey || ''}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  config: { ...formData.config, apiKey: e.target.value },
                })
              }
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
              placeholder="Enter API key"
            />
            <p className="text-xs text-gray-500 mt-1">
              Required for OpenAI, Cohere, and HuggingFace. Leave empty to use environment variable.
            </p>
          </div>

          {(formData.provider === 'openai' || formData.provider === 'azure-openai') && (
            <div>
              <label className="block text-sm font-medium mb-1">Base URL (Optional)</label>
              <input
                type="text"
                value={formData.config?.base_url || ''}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    config: { ...formData.config, base_url: e.target.value },
                  })
                }
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
                placeholder="https://api.openai.com/v1"
              />
              <p className="text-xs text-gray-500 mt-1">
                For Azure OpenAI, use: https://YOUR_RESOURCE.openai.azure.com
              </p>
            </div>
          )}

          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={formData.active}
                onChange={(e) => setFormData({ ...formData, active: e.target.checked })}
                className="rounded"
              />
              <span className="text-sm">Active</span>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={formData.is_default}
                onChange={(e) => setFormData({ ...formData, is_default: e.target.checked })}
                className="rounded"
              />
              <span className="text-sm">Set as Default</span>
            </label>
          </div>

          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={closeModal}
              className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
            >
              {editingModel ? 'Update' : 'Create'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

