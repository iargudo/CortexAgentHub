import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/services/api';
import { Wrench, Check, X, Plus, Edit2, Trash2, Play, PlusCircle, MinusCircle, HelpCircle, Book, Code, AlertCircle } from 'lucide-react';
import { Modal } from '@/components/Modal';
import { CodeEditor } from '@/components/CodeEditor';

interface Parameter {
  name: string;
  type: string;
  description: string;
  required: boolean;
}

interface ToolConfig {
  id?: string;
  name: string;
  description: string;
  implementation?: string;
  toolType?: string;
  config?: {
    smtp?: {
      host: string;
      port: number;
      secure: boolean;
      user: string;
      password: string;
      fromAddress?: string;
      fromName?: string;
    };
    database?: {
      type: 'postgresql' | 'mysql' | 'mssql' | 'oracle';
      host: string;
      port: number;
      database: string;
      user: string;
      password: string;
      ssl?: boolean;
      encrypt?: boolean;
      trustServerCertificate?: boolean;
      connectString?: string;
    };
    rest?: {
      baseUrl: string;
      auth?: {
        type: 'none' | 'bearer' | 'basic' | 'apikey' | 'custom';
        bearerToken?: string;
        basicAuth?: {
          username: string;
          password: string;
        };
        apiKey?: {
          key: string;
          value: string;
          location: 'header' | 'query';
        };
        customHeaders?: Record<string, string>;
      };
      defaultHeaders?: Record<string, string>;
      timeout?: number;
    };
  };
  parameters: {
    type: string;
    properties: Record<string, any>;
    required: string[];
  };
  permissions?: {
    channels?: string[];
    rateLimit?: {
      requests: number;
      window: number;
    };
  };
  active?: boolean;
}

export function Tools() {
  const queryClient = useQueryClient();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isTestModalOpen, setIsTestModalOpen] = useState(false);
  const [isHelpModalOpen, setIsHelpModalOpen] = useState(false);
  const [editingTool, setEditingTool] = useState<any | null>(null);
  const [testingTool, setTestingTool] = useState<any | null>(null);
  const [testParams, setTestParams] = useState<Record<string, any>>({});
  const [testResult, setTestResult] = useState<any>(null);

  const [formData, setFormData] = useState<ToolConfig>({
    name: '',
    description: '',
    implementation: '',
    toolType: 'javascript',
    config: {},
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
    permissions: {
      channels: [],
      rateLimit: {
        requests: 10,
        window: 60,
      },
    },
    active: true,
  });

  const [parameters, setParameters] = useState<Parameter[]>([]);

  const { data: tools, isLoading } = useQuery({
    queryKey: ['tools'],
    queryFn: () => api.getTools(),
  });

  const createMutation = useMutation({
    mutationFn: (data: ToolConfig) => api.createTool(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tools'] });
      closeModal();
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, ...data }: ToolConfig & { id: string }) =>
      api.updateTool(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tools'] });
      closeModal();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deleteTool(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tools'] });
    },
  });

  const testMutation = useMutation({
    mutationFn: ({ id, parameters }: { id: string; parameters: any }) =>
      api.testTool(id, parameters),
    onSuccess: (data) => {
      setTestResult(data);
    },
  });

  const openCreateModal = () => {
    setEditingTool(null);
    setFormData({
      name: '',
      description: '',
      implementation: '',
      toolType: 'javascript',
      config: {},
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
      permissions: {
        channels: [],
        rateLimit: {
          requests: 10,
          window: 60,
        },
      },
      active: true,
    });
    setParameters([]);
    setIsModalOpen(true);
  };

  const openEditModal = (tool: any) => {
    setEditingTool(tool);

    // Convert parameters schema to form format
    const params: Parameter[] = [];
    if (tool.parameters?.properties) {
      Object.entries(tool.parameters.properties).forEach(([name, schema]: [string, any]) => {
        params.push({
          name,
          type: schema.type || 'string',
          description: schema.description || '',
          required: tool.parameters.required?.includes(name) || false,
        });
      });
    }
    setParameters(params);

    setFormData({
      name: tool.name,
      description: tool.description,
      implementation: tool.implementation || '',
      toolType: tool.toolType || tool.tool_type || 'javascript',
      config: tool.config || {},
      parameters: tool.parameters || {
        type: 'object',
        properties: {},
        required: [],
      },
      permissions: tool.permissions || {
        channels: [],
        rateLimit: { requests: 10, window: 60 },
      },
      active: tool.active ?? true,
    });
    setIsModalOpen(true);
  };

  const openTestModal = (tool: any) => {
    setTestingTool(tool);
    setTestParams({});
    setTestResult(null);
    setIsTestModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingTool(null);
  };

  const closeTestModal = () => {
    setIsTestModalOpen(false);
    setTestingTool(null);
    setTestResult(null);
  };

  const addParameter = () => {
    setParameters([
      ...parameters,
      { name: '', type: 'string', description: '', required: false },
    ]);
  };

  const removeParameter = (index: number) => {
    setParameters(parameters.filter((_, i) => i !== index));
  };

  const updateParameter = (index: number, field: keyof Parameter, value: any) => {
    const updated = [...parameters];
    updated[index] = { ...updated[index], [field]: value };
    setParameters(updated);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // Build parameters schema from parameters array
    const properties: Record<string, any> = {};
    const required: string[] = [];

    parameters.forEach((param) => {
      if (param.name) {
        properties[param.name] = {
          type: param.type,
          description: param.description,
        };
        if (param.required) {
          required.push(param.name);
        }
      }
    });

    const toolData: any = {
      ...formData,
      tool_type: formData.toolType || 'javascript',
      parameters: {
        type: 'object',
        properties,
        required,
      },
    };

    // For email, sql, or rest type, include config but not implementation
    if (formData.toolType === 'email' || formData.toolType === 'sql' || formData.toolType === 'rest') {
      toolData.config = formData.config || {};
      // Don't send implementation for email, sql, or rest tools
      toolData.implementation = undefined;
    } else {
      // For javascript type, include implementation
      toolData.implementation = formData.implementation || '';
    }

    if (editingTool) {
      updateMutation.mutate({ ...toolData, id: editingTool.id });
    } else {
      createMutation.mutate(toolData);
    }
  };

  const handleDelete = (id: string) => {
    if (confirm('Are you sure you want to delete this tool?')) {
      deleteMutation.mutate(id);
    }
  };

  const handleTest = () => {
    if (testingTool) {
      testMutation.mutate({ id: testingTool.id, parameters: testParams });
    }
  };

  if (isLoading) {
    return <div className="flex justify-center p-8">Loading...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">MCP Tools</h2>
        <div className="flex items-center gap-2">
          <button 
            onClick={() => setIsHelpModalOpen(true)}
            className="btn-secondary flex items-center gap-2"
            title="Ver guía de creación de tools"
          >
            <HelpCircle size={18} />
            Ayuda
          </button>
          <button onClick={openCreateModal} className="btn-primary flex items-center gap-2">
            <Plus size={18} />
            Add Tool
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
        {tools?.map((tool: any) => (
          <div key={tool.id || tool.name} className="card flex flex-col h-full p-3">
            <div className="flex items-start justify-between mb-2">
              <div className="p-1.5 bg-orange-100 rounded-lg">
                <Wrench className="text-orange-600" size={16} />
              </div>
              <span
                className={`badge text-xs ${
                  tool.active ?? tool.enabled ? 'badge-success' : 'badge-error'
                }`}
              >
                {tool.active ?? tool.enabled ? <Check size={10} /> : <X size={10} />}
              </span>
            </div>

            <div className="flex-1 min-h-0">
              <h3 className="font-semibold text-sm mb-1 line-clamp-1">{tool.name}</h3>
              <p className="text-xs text-gray-600 line-clamp-2">{tool.description}</p>
            </div>

            <div className="flex gap-2 pt-2 border-t mt-2">
              <button
                onClick={() => openTestModal(tool)}
                className="p-2 hover:bg-blue-50 rounded transition-colors"
                title="Test"
              >
                <Play size={14} className="text-blue-600" />
              </button>
              <button
                onClick={() => openEditModal(tool)}
                className="p-2 hover:bg-gray-100 rounded transition-colors"
                title="Edit"
              >
                <Edit2 size={14} className="text-gray-600" />
              </button>
              <button
                onClick={() => handleDelete(tool.id)}
                className="p-2 hover:bg-red-50 rounded transition-colors"
                title="Delete"
              >
                <Trash2 size={14} className="text-red-600" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {(!tools || tools.length === 0) && (
        <div className="text-center py-12 text-gray-500">
          <Wrench size={48} className="mx-auto mb-4 opacity-50" />
          <p>No MCP tools registered yet.</p>
          <p className="text-sm mt-2">Create your first tool to get started.</p>
        </div>
      )}

      {/* Create/Edit Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={closeModal}
        title={editingTool ? 'Edit Tool' : 'Create Tool'}
        maxWidth="lg"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Tool Name</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
              placeholder="e.g., search_knowledge_base"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Description</label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
              rows={3}
              placeholder="Describe what this tool does..."
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Tool Type</label>
            <select
              value={formData.toolType || 'javascript'}
              onChange={(e) => {
                const newType = e.target.value;
                setFormData({
                  ...formData,
                  toolType: newType,
                  // Reset config when switching types
                  config: newType === 'email' ? { 
                    smtp: {
                      host: '',
                      port: 587,
                      secure: false,
                      user: '',
                      password: '',
                    }
                  } : newType === 'sql' ? {
                    database: {
                      type: 'postgresql',
                      host: '',
                      port: 5432,
                      database: '',
                      user: '',
                      password: '',
                    }
                  } : newType === 'rest' ? {
                    rest: {
                      baseUrl: '',
                      auth: {
                        type: 'none',
                      },
                      defaultHeaders: {},
                      timeout: 30,
                    }
                  } : {},
                  // Clear implementation when switching to email, sql, or rest
                  implementation: (newType === 'email' || newType === 'sql' || newType === 'rest') ? '' : formData.implementation,
                });
              }}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
            >
              <option value="javascript">JavaScript (Custom Code)</option>
              <option value="email">Email (SMTP Configuration)</option>
              <option value="sql">SQL (Database Query)</option>
              <option value="rest">REST API (HTTP Client)</option>
            </select>
            <p className="text-xs text-gray-500 mt-1">
              {formData.toolType === 'email' 
                ? 'Email tools use SMTP configuration instead of JavaScript code'
                : formData.toolType === 'sql'
                ? 'SQL tools execute queries on configured databases using SQL ANSI'
                : formData.toolType === 'rest'
                ? 'REST tools call HTTP APIs with configurable authentication and methods'
                : 'JavaScript tools require implementation code to execute'}
            </p>
          </div>

          {formData.toolType === 'email' ? (
            <div className="space-y-4 border rounded-lg p-4 bg-blue-50">
              <div className="flex items-center gap-2 mb-3">
                <AlertCircle size={18} className="text-blue-600" />
                <h3 className="font-medium text-blue-900">SMTP Configuration</h3>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">SMTP Host</label>
                  <input
                    type="text"
                    value={formData.config?.smtp?.host || ''}
                    onChange={(e) => setFormData({
                      ...formData,
                      config: {
                        smtp: {
                          ...formData.config?.smtp,
                          host: e.target.value,
                          port: formData.config?.smtp?.port || 587,
                          secure: formData.config?.smtp?.secure || false,
                          user: formData.config?.smtp?.user || '',
                          password: formData.config?.smtp?.password || '',
                          fromAddress: formData.config?.smtp?.fromAddress || '',
                          fromName: formData.config?.smtp?.fromName || '',
                        },
                      },
                    })}
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
                    placeholder="smtp.gmail.com"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">SMTP Port</label>
                  <input
                    type="number"
                    value={formData.config?.smtp?.port || 587}
                    onChange={(e) => setFormData({
                      ...formData,
                      config: {
                        smtp: {
                          ...formData.config?.smtp,
                          host: formData.config?.smtp?.host || '',
                          port: parseInt(e.target.value) || 587,
                          secure: formData.config?.smtp?.secure || false,
                          user: formData.config?.smtp?.user || '',
                          password: formData.config?.smtp?.password || '',
                          fromAddress: formData.config?.smtp?.fromAddress || '',
                          fromName: formData.config?.smtp?.fromName || '',
                        },
                      },
                    })}
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
                    placeholder="587"
                    required
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">SMTP User</label>
                  <input
                    type="text"
                    value={formData.config?.smtp?.user || ''}
                    onChange={(e) => setFormData({
                      ...formData,
                      config: {
                        smtp: {
                          ...formData.config?.smtp,
                          host: formData.config?.smtp?.host || '',
                          port: formData.config?.smtp?.port || 587,
                          secure: formData.config?.smtp?.secure || false,
                          user: e.target.value,
                          password: formData.config?.smtp?.password || '',
                          fromAddress: formData.config?.smtp?.fromAddress || e.target.value,
                          fromName: formData.config?.smtp?.fromName || '',
                        },
                      },
                    })}
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
                    placeholder="your_email@gmail.com"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">SMTP Password</label>
                  <input
                    type="password"
                    value={formData.config?.smtp?.password || ''}
                    onChange={(e) => setFormData({
                      ...formData,
                      config: {
                        smtp: {
                          ...formData.config?.smtp,
                          host: formData.config?.smtp?.host || '',
                          port: formData.config?.smtp?.port || 587,
                          secure: formData.config?.smtp?.secure || false,
                          user: formData.config?.smtp?.user || '',
                          password: e.target.value,
                          fromAddress: formData.config?.smtp?.fromAddress || '',
                          fromName: formData.config?.smtp?.fromName || '',
                        },
                      },
                    })}
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
                    placeholder="Your app password"
                    required
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">From Address</label>
                  <input
                    type="email"
                    value={formData.config?.smtp?.fromAddress || formData.config?.smtp?.user || ''}
                    onChange={(e) => setFormData({
                      ...formData,
                      config: {
                        smtp: {
                          ...formData.config?.smtp,
                          host: formData.config?.smtp?.host || '',
                          port: formData.config?.smtp?.port || 587,
                          secure: formData.config?.smtp?.secure || false,
                          user: formData.config?.smtp?.user || '',
                          password: formData.config?.smtp?.password || '',
                          fromAddress: e.target.value,
                          fromName: formData.config?.smtp?.fromName || '',
                        },
                      },
                    })}
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
                    placeholder="sender@example.com"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">From Name (Optional)</label>
                  <input
                    type="text"
                    value={formData.config?.smtp?.fromName || ''}
                    onChange={(e) => setFormData({
                      ...formData,
                      config: {
                        smtp: {
                          ...formData.config?.smtp,
                          host: formData.config?.smtp?.host || '',
                          port: formData.config?.smtp?.port || 587,
                          secure: formData.config?.smtp?.secure || false,
                          user: formData.config?.smtp?.user || '',
                          password: formData.config?.smtp?.password || '',
                          fromAddress: formData.config?.smtp?.fromAddress || '',
                          fromName: e.target.value,
                        },
                      },
                    })}
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
                    placeholder="Your Name"
                  />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={formData.config?.smtp?.secure || false}
                  onChange={(e) => setFormData({
                    ...formData,
                    config: {
                      smtp: {
                        ...formData.config?.smtp,
                        host: formData.config?.smtp?.host || '',
                        port: formData.config?.smtp?.port || 587,
                        secure: e.target.checked,
                        user: formData.config?.smtp?.user || '',
                        password: formData.config?.smtp?.password || '',
                        fromAddress: formData.config?.smtp?.fromAddress || '',
                        fromName: formData.config?.smtp?.fromName || '',
                      },
                    },
                  })}
                  className="rounded"
                />
                <label className="text-sm">Use Secure Connection (TLS/SSL)</label>
              </div>
              <div className="bg-blue-100 border border-blue-300 rounded-lg p-3 text-sm text-blue-800">
                <strong>📧 Email Tool Parameters:</strong>
                <ul className="list-disc list-inside mt-2 space-y-1">
                  <li><code className="bg-blue-200 px-1 rounded">to</code> (required): Email recipient</li>
                  <li><code className="bg-blue-200 px-1 rounded">subject</code> (required): Email subject</li>
                  <li><code className="bg-blue-200 px-1 rounded">text</code> (optional): Plain text content</li>
                  <li><code className="bg-blue-200 px-1 rounded">html</code> (optional): HTML content</li>
                  <li><code className="bg-blue-200 px-1 rounded">cc</code> (optional): CC recipients</li>
                  <li><code className="bg-blue-200 px-1 rounded">bcc</code> (optional): BCC recipients</li>
                </ul>
              </div>
            </div>
          ) : formData.toolType === 'sql' ? (
            <div className="space-y-4 border rounded-lg p-4 bg-green-50">
              <div className="flex items-center gap-2 mb-3">
                <AlertCircle size={18} className="text-green-600" />
                <h3 className="font-medium text-green-900">Database Configuration</h3>
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-1">Database Type</label>
                <select
                  value={formData.config?.database?.type || 'postgresql'}
                  onChange={(e) => {
                    const dbType = e.target.value as 'postgresql' | 'mysql' | 'mssql' | 'oracle';
                    const defaultPorts: Record<string, number> = {
                      postgresql: 5432,
                      mysql: 3306,
                      mssql: 1433,
                      oracle: 1521,
                    };
                    setFormData({
                      ...formData,
                      config: {
                        database: {
                          ...formData.config?.database,
                          type: dbType,
                          port: defaultPorts[dbType] || 5432,
                          host: formData.config?.database?.host || '',
                          database: formData.config?.database?.database || '',
                          user: formData.config?.database?.user || '',
                          password: formData.config?.database?.password || '',
                        },
                      },
                    });
                  }}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
                  required
                >
                  <option value="postgresql">PostgreSQL</option>
                  <option value="mysql">MySQL</option>
                  <option value="mssql">MSSQL Server</option>
                  <option value="oracle">Oracle</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Host</label>
                  <input
                    type="text"
                    value={formData.config?.database?.host || ''}
                    onChange={(e) => setFormData({
                      ...formData,
                      config: {
                        database: {
                          ...formData.config?.database,
                          type: formData.config?.database?.type || 'postgresql',
                          host: e.target.value,
                          port: formData.config?.database?.port || 5432,
                          database: formData.config?.database?.database || '',
                          user: formData.config?.database?.user || '',
                          password: formData.config?.database?.password || '',
                          ssl: formData.config?.database?.ssl,
                          encrypt: formData.config?.database?.encrypt,
                          trustServerCertificate: formData.config?.database?.trustServerCertificate,
                          connectString: formData.config?.database?.connectString,
                        },
                      },
                    })}
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
                    placeholder="localhost"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Port</label>
                  <input
                    type="number"
                    value={formData.config?.database?.port || 5432}
                    onChange={(e) => setFormData({
                      ...formData,
                      config: {
                        database: {
                          ...formData.config?.database,
                          type: formData.config?.database?.type || 'postgresql',
                          host: formData.config?.database?.host || '',
                          port: parseInt(e.target.value) || 5432,
                          database: formData.config?.database?.database || '',
                          user: formData.config?.database?.user || '',
                          password: formData.config?.database?.password || '',
                          ssl: formData.config?.database?.ssl,
                          encrypt: formData.config?.database?.encrypt,
                          trustServerCertificate: formData.config?.database?.trustServerCertificate,
                          connectString: formData.config?.database?.connectString,
                        },
                      },
                    })}
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Database Name</label>
                <input
                  type="text"
                  value={formData.config?.database?.database || ''}
                  onChange={(e) => setFormData({
                    ...formData,
                    config: {
                      database: {
                        ...formData.config?.database,
                        type: formData.config?.database?.type || 'postgresql',
                        host: formData.config?.database?.host || '',
                        port: formData.config?.database?.port || 5432,
                        database: e.target.value,
                        user: formData.config?.database?.user || '',
                        password: formData.config?.database?.password || '',
                        ssl: formData.config?.database?.ssl,
                        encrypt: formData.config?.database?.encrypt,
                        trustServerCertificate: formData.config?.database?.trustServerCertificate,
                        connectString: formData.config?.database?.connectString,
                      },
                    },
                  })}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
                  placeholder="database_name"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">User</label>
                  <input
                    type="text"
                    value={formData.config?.database?.user || ''}
                    onChange={(e) => setFormData({
                      ...formData,
                      config: {
                        database: {
                          ...formData.config?.database,
                          type: formData.config?.database?.type || 'postgresql',
                          host: formData.config?.database?.host || '',
                          port: formData.config?.database?.port || 5432,
                          database: formData.config?.database?.database || '',
                          user: e.target.value,
                          password: formData.config?.database?.password || '',
                          ssl: formData.config?.database?.ssl,
                          encrypt: formData.config?.database?.encrypt,
                          trustServerCertificate: formData.config?.database?.trustServerCertificate,
                          connectString: formData.config?.database?.connectString,
                        },
                      },
                    })}
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
                    placeholder="database_user"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Password</label>
                  <input
                    type="password"
                    value={formData.config?.database?.password || ''}
                    onChange={(e) => setFormData({
                      ...formData,
                      config: {
                        database: {
                          ...formData.config?.database,
                          type: formData.config?.database?.type || 'postgresql',
                          host: formData.config?.database?.host || '',
                          port: formData.config?.database?.port || 5432,
                          database: formData.config?.database?.database || '',
                          user: formData.config?.database?.user || '',
                          password: e.target.value,
                          ssl: formData.config?.database?.ssl,
                          encrypt: formData.config?.database?.encrypt,
                          trustServerCertificate: formData.config?.database?.trustServerCertificate,
                          connectString: formData.config?.database?.connectString,
                        },
                      },
                    })}
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
                    placeholder="database_password"
                    required
                  />
                </div>
              </div>

              {/* PostgreSQL specific options */}
              {formData.config?.database?.type === 'postgresql' && (
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={formData.config?.database?.ssl || false}
                    onChange={(e) => setFormData({
                      ...formData,
                      config: {
                        database: {
                          ...formData.config?.database,
                          type: formData.config?.database?.type || 'postgresql',
                          host: formData.config?.database?.host || '',
                          port: formData.config?.database?.port || 5432,
                          database: formData.config?.database?.database || '',
                          user: formData.config?.database?.user || '',
                          password: formData.config?.database?.password || '',
                          ssl: e.target.checked,
                          encrypt: formData.config?.database?.encrypt,
                          trustServerCertificate: formData.config?.database?.trustServerCertificate,
                          connectString: formData.config?.database?.connectString,
                        },
                      },
                    })}
                    className="rounded"
                  />
                  <label className="text-sm">Use SSL Connection</label>
                </div>
              )}

              {/* MSSQL specific options */}
              {formData.config?.database?.type === 'mssql' && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={formData.config?.database?.encrypt !== false}
                      onChange={(e) => setFormData({
                        ...formData,
                        config: {
                          database: {
                            ...formData.config?.database,
                            type: formData.config?.database?.type || 'postgresql',
                            host: formData.config?.database?.host || '',
                            port: formData.config?.database?.port || 5432,
                            database: formData.config?.database?.database || '',
                            user: formData.config?.database?.user || '',
                            password: formData.config?.database?.password || '',
                            ssl: formData.config?.database?.ssl,
                            encrypt: e.target.checked,
                            trustServerCertificate: formData.config?.database?.trustServerCertificate,
                            connectString: formData.config?.database?.connectString,
                          },
                        },
                      })}
                      className="rounded"
                    />
                    <label className="text-sm">Encrypt Connection</label>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={formData.config?.database?.trustServerCertificate || false}
                      onChange={(e) => setFormData({
                        ...formData,
                        config: {
                          database: {
                            ...formData.config?.database,
                            type: formData.config?.database?.type || 'postgresql',
                            host: formData.config?.database?.host || '',
                            port: formData.config?.database?.port || 5432,
                            database: formData.config?.database?.database || '',
                            user: formData.config?.database?.user || '',
                            password: formData.config?.database?.password || '',
                            ssl: formData.config?.database?.ssl,
                            encrypt: formData.config?.database?.encrypt,
                            trustServerCertificate: e.target.checked,
                            connectString: formData.config?.database?.connectString,
                          },
                        },
                      })}
                      className="rounded"
                    />
                    <label className="text-sm">Trust Server Certificate</label>
                  </div>
                </div>
              )}

              {/* Oracle specific options */}
              {formData.config?.database?.type === 'oracle' && (
                <div>
                  <label className="block text-sm font-medium mb-1">Connect String (Optional)</label>
                  <input
                    type="text"
                    value={formData.config?.database?.connectString || ''}
                    onChange={(e) => setFormData({
                      ...formData,
                      config: {
                        database: {
                          ...formData.config?.database,
                          type: formData.config?.database?.type || 'postgresql',
                          host: formData.config?.database?.host || '',
                          port: formData.config?.database?.port || 5432,
                          database: formData.config?.database?.database || '',
                          user: formData.config?.database?.user || '',
                          password: formData.config?.database?.password || '',
                          ssl: formData.config?.database?.ssl,
                          encrypt: formData.config?.database?.encrypt,
                          trustServerCertificate: formData.config?.database?.trustServerCertificate,
                          connectString: e.target.value,
                        },
                      },
                    })}
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
                    placeholder="hostname:port/service_name"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Overrides host:port/database if provided
                  </p>
                </div>
              )}

              <div className="bg-green-100 border border-green-300 rounded-lg p-3 text-sm text-green-800">
                <strong>🗄️ SQL Tool Parameters:</strong>
                <ul className="list-disc list-inside mt-2 space-y-1">
                  <li><code className="bg-green-200 px-1 rounded">query</code> (required): SQL ANSI query to execute</li>
                  <li><code className="bg-green-200 px-1 rounded">parameters</code> (optional): Array of parameter values for parameterized queries</li>
                </ul>
                <p className="mt-2 text-xs">
                  <strong>Note:</strong> The tool executes SQL ANSI queries. Use standard SQL syntax that works across all supported databases.
                </p>
              </div>
            </div>
          ) : formData.toolType === 'rest' ? (
            <div className="space-y-4 border rounded-lg p-4 bg-purple-50">
              <div className="flex items-center gap-2 mb-3">
                <AlertCircle size={18} className="text-purple-600" />
                <h3 className="font-medium text-purple-900">REST API Configuration</h3>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Base URL</label>
                <input
                  type="url"
                  value={formData.config?.rest?.baseUrl || ''}
                  onChange={(e) => setFormData({
                    ...formData,
                    config: {
                      rest: {
                        ...formData.config?.rest,
                        baseUrl: e.target.value,
                        auth: formData.config?.rest?.auth || { type: 'none' },
                        defaultHeaders: formData.config?.rest?.defaultHeaders || {},
                        timeout: formData.config?.rest?.timeout || 30,
                      },
                    },
                  })}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
                  placeholder="https://api.example.com"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Authentication Type</label>
                <select
                  value={formData.config?.rest?.auth?.type || 'none'}
                  onChange={(e) => {
                    const authType = e.target.value as 'none' | 'bearer' | 'basic' | 'apikey' | 'custom';
                    setFormData({
                      ...formData,
                      config: {
                        rest: {
                          ...formData.config?.rest,
                          baseUrl: formData.config?.rest?.baseUrl || '',
                          auth: {
                            type: authType,
                            bearerToken: authType === 'bearer' ? formData.config?.rest?.auth?.bearerToken : undefined,
                            basicAuth: authType === 'basic' ? (formData.config?.rest?.auth?.basicAuth || { username: '', password: '' }) : undefined,
                            apiKey: authType === 'apikey' ? (formData.config?.rest?.auth?.apiKey || { key: '', value: '', location: 'header' }) : undefined,
                            customHeaders: authType === 'custom' ? (formData.config?.rest?.auth?.customHeaders || {}) : undefined,
                          },
                          defaultHeaders: formData.config?.rest?.defaultHeaders || {},
                          timeout: formData.config?.rest?.timeout || 30,
                        },
                      },
                    });
                  }}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
                >
                  <option value="none">None</option>
                  <option value="bearer">Bearer Token</option>
                  <option value="basic">Basic Authentication</option>
                  <option value="apikey">API Key</option>
                  <option value="custom">Custom Headers</option>
                </select>
              </div>

              {/* Bearer Token */}
              {formData.config?.rest?.auth?.type === 'bearer' && (
                <div>
                  <label className="block text-sm font-medium mb-1">Bearer Token</label>
                  <input
                    type="password"
                    value={formData.config?.rest?.auth?.bearerToken || ''}
                    onChange={(e) => setFormData({
                      ...formData,
                      config: {
                        rest: {
                          ...formData.config?.rest,
                          baseUrl: formData.config?.rest?.baseUrl || '',
                          auth: {
                            type: 'bearer',
                            bearerToken: e.target.value,
                            basicAuth: undefined,
                            apiKey: undefined,
                            customHeaders: undefined,
                          },
                          defaultHeaders: formData.config?.rest?.defaultHeaders || {},
                          timeout: formData.config?.rest?.timeout || 30,
                        },
                      },
                    })}
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
                    placeholder="your_bearer_token"
                    required
                  />
                </div>
              )}

              {/* Basic Auth */}
              {formData.config?.rest?.auth?.type === 'basic' && (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium mb-1">Username</label>
                    <input
                      type="text"
                      value={formData.config?.rest?.auth?.basicAuth?.username || ''}
                      onChange={(e) => setFormData({
                        ...formData,
                        config: {
                          rest: {
                            ...formData.config?.rest,
                            baseUrl: formData.config?.rest?.baseUrl || '',
                            auth: {
                              type: 'basic',
                              basicAuth: {
                                username: e.target.value,
                                password: formData.config?.rest?.auth?.basicAuth?.password || '',
                              },
                              bearerToken: undefined,
                              apiKey: undefined,
                              customHeaders: undefined,
                            },
                            defaultHeaders: formData.config?.rest?.defaultHeaders || {},
                            timeout: formData.config?.rest?.timeout || 30,
                          },
                        },
                      })}
                      className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
                      placeholder="username"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Password</label>
                    <input
                      type="password"
                      value={formData.config?.rest?.auth?.basicAuth?.password || ''}
                      onChange={(e) => setFormData({
                        ...formData,
                        config: {
                          rest: {
                            ...formData.config?.rest,
                            baseUrl: formData.config?.rest?.baseUrl || '',
                            auth: {
                              type: 'basic',
                              basicAuth: {
                                username: formData.config?.rest?.auth?.basicAuth?.username || '',
                                password: e.target.value,
                              },
                              bearerToken: undefined,
                              apiKey: undefined,
                              customHeaders: undefined,
                            },
                            defaultHeaders: formData.config?.rest?.defaultHeaders || {},
                            timeout: formData.config?.rest?.timeout || 30,
                          },
                        },
                      })}
                      className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
                      placeholder="password"
                      required
                    />
                  </div>
                </div>
              )}

              {/* API Key */}
              {formData.config?.rest?.auth?.type === 'apikey' && (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium mb-1">API Key Name</label>
                      <input
                        type="text"
                        value={formData.config?.rest?.auth?.apiKey?.key || ''}
                        onChange={(e) => setFormData({
                          ...formData,
                          config: {
                            rest: {
                              ...formData.config?.rest,
                              baseUrl: formData.config?.rest?.baseUrl || '',
                              auth: {
                                type: 'apikey',
                                apiKey: {
                                  key: e.target.value,
                                  value: formData.config?.rest?.auth?.apiKey?.value || '',
                                  location: formData.config?.rest?.auth?.apiKey?.location || 'header',
                                },
                                bearerToken: undefined,
                                basicAuth: undefined,
                                customHeaders: undefined,
                              },
                              defaultHeaders: formData.config?.rest?.defaultHeaders || {},
                              timeout: formData.config?.rest?.timeout || 30,
                            },
                          },
                        })}
                        className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
                        placeholder="X-API-Key"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">API Key Value</label>
                      <input
                        type="password"
                        value={formData.config?.rest?.auth?.apiKey?.value || ''}
                        onChange={(e) => setFormData({
                          ...formData,
                          config: {
                            rest: {
                              ...formData.config?.rest,
                              baseUrl: formData.config?.rest?.baseUrl || '',
                              auth: {
                                type: 'apikey',
                                apiKey: {
                                  key: formData.config?.rest?.auth?.apiKey?.key || '',
                                  value: e.target.value,
                                  location: formData.config?.rest?.auth?.apiKey?.location || 'header',
                                },
                                bearerToken: undefined,
                                basicAuth: undefined,
                                customHeaders: undefined,
                              },
                              defaultHeaders: formData.config?.rest?.defaultHeaders || {},
                              timeout: formData.config?.rest?.timeout || 30,
                            },
                          },
                        })}
                        className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
                        placeholder="your_api_key"
                        required
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Location</label>
                    <select
                      value={formData.config?.rest?.auth?.apiKey?.location || 'header'}
                      onChange={(e) => setFormData({
                        ...formData,
                        config: {
                          rest: {
                            ...formData.config?.rest,
                            baseUrl: formData.config?.rest?.baseUrl || '',
                            auth: {
                              type: 'apikey',
                              apiKey: {
                                key: formData.config?.rest?.auth?.apiKey?.key || '',
                                value: formData.config?.rest?.auth?.apiKey?.value || '',
                                location: e.target.value as 'header' | 'query',
                              },
                              bearerToken: undefined,
                              basicAuth: undefined,
                              customHeaders: undefined,
                            },
                            defaultHeaders: formData.config?.rest?.defaultHeaders || {},
                            timeout: formData.config?.rest?.timeout || 30,
                          },
                        },
                      })}
                      className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
                    >
                      <option value="header">Header</option>
                      <option value="query">Query Parameter</option>
                    </select>
                  </div>
                </div>
              )}

              {/* Custom Headers */}
              {formData.config?.rest?.auth?.type === 'custom' && (
                <div>
                  <label className="block text-sm font-medium mb-1">Custom Headers (JSON)</label>
                  <textarea
                    value={JSON.stringify(formData.config?.rest?.auth?.customHeaders || {}, null, 2)}
                    onChange={(e) => {
                      try {
                        const headers = JSON.parse(e.target.value);
                        setFormData({
                          ...formData,
                          config: {
                            rest: {
                              ...formData.config?.rest,
                              baseUrl: formData.config?.rest?.baseUrl || '',
                              auth: {
                                type: 'custom',
                                customHeaders: headers,
                                bearerToken: undefined,
                                basicAuth: undefined,
                                apiKey: undefined,
                              },
                              defaultHeaders: formData.config?.rest?.defaultHeaders || {},
                              timeout: formData.config?.rest?.timeout || 30,
                            },
                          },
                        });
                      } catch (err) {
                        // Invalid JSON, ignore
                      }
                    }}
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500 font-mono text-xs"
                    rows={4}
                    placeholder='{\n  "Authorization": "Custom Token",\n  "X-Custom-Header": "value"\n}'
                  />
                </div>
              )}

              <div>
                <label className="block text-sm font-medium mb-1">Default Headers (JSON, Optional)</label>
                <textarea
                  value={JSON.stringify(formData.config?.rest?.defaultHeaders || {}, null, 2)}
                  onChange={(e) => {
                    try {
                      const headers = JSON.parse(e.target.value);
                      setFormData({
                        ...formData,
                        config: {
                          rest: {
                            ...formData.config?.rest,
                            baseUrl: formData.config?.rest?.baseUrl || '',
                            auth: formData.config?.rest?.auth || { type: 'none' },
                            defaultHeaders: headers,
                            timeout: formData.config?.rest?.timeout || 30,
                          },
                        },
                      });
                    } catch (err) {
                      // Invalid JSON, ignore
                    }
                  }}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500 font-mono text-xs"
                  rows={3}
                  placeholder='{\n  "Content-Type": "application/json",\n  "Accept": "application/json"\n}'
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Timeout (seconds)</label>
                <input
                  type="number"
                  value={formData.config?.rest?.timeout || 30}
                  onChange={(e) => setFormData({
                    ...formData,
                    config: {
                      rest: {
                        ...formData.config?.rest,
                        baseUrl: formData.config?.rest?.baseUrl || '',
                        auth: formData.config?.rest?.auth || { type: 'none' },
                        defaultHeaders: formData.config?.rest?.defaultHeaders || {},
                        timeout: parseInt(e.target.value) || 30,
                      },
                    },
                  })}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
                  min="1"
                  max="300"
                />
              </div>

              <div className="bg-purple-100 border border-purple-300 rounded-lg p-3 text-sm text-purple-800">
                <strong>🌐 REST Tool Parameters:</strong>
                <ul className="list-disc list-inside mt-2 space-y-1">
                  <li><code className="bg-purple-200 px-1 rounded">method</code> (required): HTTP method (GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS)</li>
                  <li><code className="bg-purple-200 px-1 rounded">endpoint</code> (required): API endpoint path (e.g., /api/users)</li>
                  <li><code className="bg-purple-200 px-1 rounded">headers</code> (optional): Additional headers as JSON object</li>
                  <li><code className="bg-purple-200 px-1 rounded">queryParams</code> (optional): Query parameters as JSON object</li>
                  <li><code className="bg-purple-200 px-1 rounded">body</code> (optional): Request body (object or string)</li>
                  <li><code className="bg-purple-200 px-1 rounded">bodyType</code> (optional): Body type (json, form-data, x-www-form-urlencoded, raw) - defaults to json</li>
                </ul>
              </div>
            </div>
          ) : (
            <div>
              <label className="block text-sm font-medium mb-2">
                Implementation Code (JavaScript)
                <span className="text-xs text-gray-500 ml-2 font-normal">
                  Type "handler" for templates with autocomplete
                </span>
              </label>
              <CodeEditor
                value={formData.implementation || ''}
                onChange={(value) => setFormData({ ...formData, implementation: value })}
                height="400px"
              />
              <p className="text-xs text-gray-500 mt-2">
                💡 <strong>Available utilities:</strong> <code className="bg-gray-100 px-1 rounded">parameters</code>, <code className="bg-gray-100 px-1 rounded">context</code>, <code className="bg-gray-100 px-1 rounded">logger</code>, <code className="bg-gray-100 px-1 rounded">db</code>, <code className="bg-gray-100 px-1 rounded">fetch</code>, <code className="bg-gray-100 px-1 rounded">utils</code>
                <br />
                ⌨️ <strong>Shortcuts:</strong> Ctrl+Space for autocomplete, Ctrl+/ to comment, Alt+Shift+F to format
              </p>
            </div>
          )}

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-medium">Parameters</label>
              <button
                type="button"
                onClick={addParameter}
                className="btn-secondary text-xs flex items-center gap-1"
              >
                <PlusCircle size={14} />
                Add Parameter
              </button>
            </div>

            {parameters.length > 0 ? (
              <div className="space-y-3 border rounded-lg p-3 max-h-64 overflow-y-auto">
                {parameters.map((param, index) => (
                  <div key={index} className="border rounded p-3 bg-gray-50">
                    <div className="grid grid-cols-2 gap-2 mb-2">
                      <input
                        type="text"
                        value={param.name}
                        onChange={(e) => updateParameter(index, 'name', e.target.value)}
                        className="px-2 py-1 border rounded text-sm"
                        placeholder="Parameter name"
                      />
                      <select
                        value={param.type}
                        onChange={(e) => updateParameter(index, 'type', e.target.value)}
                        className="px-2 py-1 border rounded text-sm"
                      >
                        <option value="string">String</option>
                        <option value="number">Number</option>
                        <option value="boolean">Boolean</option>
                        <option value="array">Array</option>
                        <option value="object">Object</option>
                      </select>
                    </div>
                    <input
                      type="text"
                      value={param.description}
                      onChange={(e) => updateParameter(index, 'description', e.target.value)}
                      className="w-full px-2 py-1 border rounded text-sm mb-2"
                      placeholder="Description"
                    />
                    <div className="flex items-center justify-between">
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={param.required}
                          onChange={(e) =>
                            updateParameter(index, 'required', e.target.checked)
                          }
                          className="rounded"
                        />
                        Required
                      </label>
                      <button
                        type="button"
                        onClick={() => removeParameter(index)}
                        className="text-red-600 text-xs flex items-center gap-1"
                      >
                        <MinusCircle size={14} />
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-500 text-center py-4">
                No parameters defined. Click "Add Parameter" to create one.
              </p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Allowed Channels</label>
            <div className="border rounded-lg p-3 space-y-2">
              {['whatsapp', 'telegram', 'webchat', 'email'].map((channel) => (
                <label key={channel} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.permissions?.channels?.includes(channel) || false}
                    onChange={(e) => {
                      const channels = formData.permissions?.channels || [];
                      if (e.target.checked) {
                        setFormData({
                          ...formData,
                          permissions: {
                            ...formData.permissions,
                            channels: [...channels, channel],
                          },
                        });
                      } else {
                        setFormData({
                          ...formData,
                          permissions: {
                            ...formData.permissions,
                            channels: channels.filter((c) => c !== channel),
                          },
                        });
                      }
                    }}
                    className="rounded"
                  />
                  <span className="text-sm capitalize">{channel}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Rate Limit (requests)</label>
              <input
                type="number"
                value={formData.permissions?.rateLimit?.requests || 10}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    permissions: {
                      ...formData.permissions,
                      rateLimit: {
                        ...formData.permissions?.rateLimit!,
                        requests: parseInt(e.target.value),
                      },
                    },
                  })
                }
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
                min="1"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Window (seconds)</label>
              <input
                type="number"
                value={formData.permissions?.rateLimit?.window || 60}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    permissions: {
                      ...formData.permissions,
                      rateLimit: {
                        ...formData.permissions?.rateLimit!,
                        window: parseInt(e.target.value),
                      },
                    },
                  })
                }
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
                min="1"
              />
            </div>
          </div>

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
                : editingTool
                ? 'Update'
                : 'Create'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Test Modal */}
      <Modal
        isOpen={isTestModalOpen}
        onClose={closeTestModal}
        title={`Test Tool: ${testingTool?.name || ''}`}
        maxWidth="md"
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-600">{testingTool?.description}</p>

          <div>
            <label className="block text-sm font-medium mb-2">Test Parameters</label>
            {testingTool?.parameters?.properties &&
            Object.keys(testingTool.parameters.properties).length > 0 ? (
              <div className="space-y-3">
                {Object.entries(testingTool.parameters.properties).map(
                  ([name, schema]: [string, any]) => (
                    <div key={name}>
                      <label className="block text-sm mb-1">
                        {name}
                        {testingTool.parameters.required?.includes(name) && (
                          <span className="text-red-500 ml-1">*</span>
                        )}
                      </label>
                      <input
                        type={schema.type === 'number' ? 'number' : 'text'}
                        value={testParams[name] || ''}
                        onChange={(e) =>
                          setTestParams({ ...testParams, [name]: e.target.value })
                        }
                        className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
                        placeholder={schema.description}
                      />
                    </div>
                  )
                )}
              </div>
            ) : (
              <p className="text-sm text-gray-500">No parameters required</p>
            )}
          </div>

          {testResult && (
            <div className={`border rounded-lg p-4 ${
              testResult.data?.status === 'success' 
                ? 'bg-green-50 border-green-200' 
                : 'bg-red-50 border-red-200'
            }`}>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  {testResult.data?.status === 'success' ? (
                    <>
                      <Check className="text-green-600" size={18} />
                      <span className="font-semibold text-green-900">Ejecución Exitosa</span>
                    </>
                  ) : (
                    <>
                      <X className="text-red-600" size={18} />
                      <span className="font-semibold text-red-900">Error en Ejecución</span>
                    </>
                  )}
                </div>
                {testResult.data?.executionTime && (
                  <span className="text-xs text-gray-600">
                    {testResult.data.executionTime.toFixed(3)}s
                  </span>
                )}
              </div>

              {testResult.data?.status === 'success' ? (
                <div>
                  <p className="text-sm font-medium text-gray-700 mb-2">Resultado:</p>
                  <pre className="text-xs bg-white p-3 rounded border overflow-auto max-h-48 text-gray-800">
                    {JSON.stringify(testResult.data.result, null, 2)}
                  </pre>
                </div>
              ) : (
                <div>
                  <p className="text-sm font-medium text-red-900 mb-2">Error:</p>
                  <div className="bg-white p-3 rounded border">
                    <p className="text-sm text-red-800 font-medium mb-2">
                      {testResult.data?.error?.message}
                    </p>
                    {testResult.data?.error?.stack && (
                      <details className="mt-2">
                        <summary className="text-xs text-gray-600 cursor-pointer hover:text-gray-900">
                          Ver stack trace
                        </summary>
                        <pre className="text-xs text-gray-700 mt-2 overflow-auto max-h-32">
                          {testResult.data.error.stack}
                        </pre>
                      </details>
                    )}
                  </div>
                </div>
              )}

              {testResult.data?.timestamp && (
                <p className="text-xs text-gray-500 mt-2">
                  Ejecutado: {new Date(testResult.data.timestamp).toLocaleString()}
                </p>
              )}
            </div>
          )}

          <div className="flex gap-3 pt-4">
            <button onClick={closeTestModal} className="btn-secondary flex-1">
              Close
            </button>
            <button
              onClick={handleTest}
              className="btn-primary flex-1 flex items-center justify-center gap-2"
              disabled={testMutation.isPending}
            >
              <Play size={16} />
              {testMutation.isPending ? 'Testing...' : 'Run Test'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Help/Documentation Modal */}
      <Modal
        isOpen={isHelpModalOpen}
        onClose={() => setIsHelpModalOpen(false)}
        title="Guía de Creación de MCP Tools"
        maxWidth="xl"
      >
        <div className="space-y-6 max-h-[70vh] overflow-y-auto">
          
          {/* Introduction */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <Book className="text-blue-600 flex-shrink-0 mt-0.5" size={20} />
              <div>
                <h3 className="font-semibold text-blue-900 mb-1">¿Qué es una MCP Tool?</h3>
                <p className="text-sm text-blue-800">
                  Una <strong>MCP Tool</strong> es una función ejecutable que el AI puede invocar para realizar acciones específicas 
                  como consultar APIs, acceder a bases de datos, enviar emails, etc. Cada tool se programa en JavaScript 
                  y se ejecuta de forma segura en un sandbox aislado.
                </p>
              </div>
            </div>
          </div>

          {/* Tool Structure */}
          <div>
            <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
              <Code size={18} className="text-purple-600" />
              Estructura de una Tool
            </h3>
            <div className="bg-gray-50 border rounded-lg p-4 space-y-3 text-sm">
              <div>
                <strong className="text-gray-700">1. Nombre:</strong>
                <p className="text-gray-600 ml-4">Identificador único (snake_case): <code className="bg-white px-1 rounded">get_weather</code>, <code className="bg-white px-1 rounded">send_email</code></p>
              </div>
              <div>
                <strong className="text-gray-700">2. Descripción:</strong>
                <p className="text-gray-600 ml-4">Explica claramente qué hace la tool para que el AI sepa cuándo usarla.</p>
              </div>
              <div>
                <strong className="text-gray-700">3. Parámetros:</strong>
                <p className="text-gray-600 ml-4">Define los inputs que necesita tu función (tipo, descripción, si es requerido).</p>
              </div>
              <div>
                <strong className="text-gray-700">4. Implementation (Handler):</strong>
                <p className="text-gray-600 ml-4">Código JavaScript que se ejecuta cuando el AI invoca la tool.</p>
              </div>
              <div>
                <strong className="text-gray-700">5. Permisos:</strong>
                <p className="text-gray-600 ml-4">Canales permitidos (whatsapp, telegram, webchat, email) y rate limiting.</p>
              </div>
            </div>
          </div>

          {/* Parameter Types */}
          <div>
            <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
              <AlertCircle size={18} className="text-green-600" />
              Tipos de Parámetros Soportados
            </h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-gray-50 border rounded p-3 text-sm">
                <code className="font-semibold text-blue-600">string</code>
                <p className="text-gray-600 text-xs mt-1">Texto: nombres, emails, URLs</p>
              </div>
              <div className="bg-gray-50 border rounded p-3 text-sm">
                <code className="font-semibold text-blue-600">number</code>
                <p className="text-gray-600 text-xs mt-1">Números: cantidades, IDs</p>
              </div>
              <div className="bg-gray-50 border rounded p-3 text-sm">
                <code className="font-semibold text-blue-600">boolean</code>
                <p className="text-gray-600 text-xs mt-1">Verdadero/Falso: flags</p>
              </div>
              <div className="bg-gray-50 border rounded p-3 text-sm">
                <code className="font-semibold text-blue-600">array</code>
                <p className="text-gray-600 text-xs mt-1">Listas: tags, opciones múltiples</p>
              </div>
              <div className="bg-gray-50 border rounded p-3 text-sm">
                <code className="font-semibold text-blue-600">object</code>
                <p className="text-gray-600 text-xs mt-1">Objetos: estructuras complejas</p>
              </div>
            </div>
          </div>

          {/* Available Utilities */}
          <div>
            <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
              <Code size={18} className="text-orange-600" />
              Utilidades Disponibles en ExecutionEngine
            </h3>
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 space-y-3 text-sm">
              <div className="mb-3 p-2 bg-blue-100 border border-blue-300 rounded">
                <strong>⚠️ IMPORTANTE:</strong> Las tools NO tienen acceso a <code>require()</code> ni a módulos npm. 
                Solo puedes usar las utilidades listadas aquí.
              </div>
              
              <div>
                <strong className="text-gray-800">✅ <code>fetch(url, options)</code></strong>
                <p className="text-gray-600 ml-4">Cliente HTTP nativo para llamar APIs externas.</p>
              </div>
              
              <div>
                <strong className="text-gray-800">✅ <code>logger.info(msg, meta)</code></strong>
                <p className="text-gray-600 ml-4">Sistema de logs (.info, .warn, .error).</p>
              </div>
              
              <div>
                <strong className="text-gray-800">✅ <code>db.query(sql, values)</code></strong>
                <p className="text-gray-600 ml-4">Ejecutar consultas SELECT en PostgreSQL (solo lectura).</p>
              </div>
              
              <div>
                <strong className="text-gray-800">✅ <code>utils.sleep(ms)</code></strong>
                <p className="text-gray-600 ml-4">Pausar ejecución por milisegundos.</p>
              </div>
              
              <div>
                <strong className="text-gray-800">✅ <code>utils.formatDate(date)</code></strong>
                <p className="text-gray-600 ml-4">Convertir Date a ISO string.</p>
              </div>
              
              <div>
                <strong className="text-gray-800">✅ <code>utils.parseJSON(str)</code> / <code>utils.stringifyJSON(obj)</code></strong>
                <p className="text-gray-600 ml-4">Parsear y serializar JSON.</p>
              </div>
              
              <div>
                <strong className="text-gray-800">✅ <code>parameters</code></strong>
                <p className="text-gray-600 ml-4">Objeto con los parámetros pasados por el AI.</p>
              </div>
              
              <div>
                <strong className="text-gray-800">✅ <code>context</code></strong>
                <p className="text-gray-600 ml-4">Contexto de la conversación (sessionId, userId, channelType, etc).</p>
              </div>
              
              <div className="mt-3 p-2 bg-red-50 border border-red-200 rounded">
                <strong>❌ NO DISPONIBLE:</strong> <code>require()</code>, <code>import</code>, <code>nodemailer</code>, 
                <code>axios</code>, ni cualquier módulo npm. Usa <code>fetch</code> para HTTP.
              </div>
            </div>
          </div>

          {/* Implementation Examples */}
          <div>
            <h3 className="font-semibold text-gray-900 mb-3">Ejemplos de Implementación</h3>
            
            {/* Example 1: Simple API Call */}
            <div className="mb-4">
              <h4 className="text-sm font-medium text-gray-800 mb-2">1️⃣ Llamada a API Externa (Clima)</h4>
              <pre className="bg-gray-900 text-gray-100 p-3 rounded text-xs overflow-x-auto">
{`async function handler(parameters) {
  // Validar parámetros
  if (!parameters.city) {
    throw new Error('City is required');
  }

  // Llamar a API externa
  const response = await fetch(
    \`https://api.open-meteo.com/v1/forecast?latitude=\${lat}&longitude=\${lon}&current=temperature_2m\`
  );
  
  if (!response.ok) {
    throw new Error(\`API error: \${response.status}\`);
  }

  const data = await response.json();
  
  // Retornar resultado estructurado
  return {
    city: parameters.city,
    temperature: data.current.temperature_2m,
    unit: 'Celsius'
  };
}`}</pre>
            </div>

            {/* Example 2: Database Query */}
            <div className="mb-4">
              <h4 className="text-sm font-medium text-gray-800 mb-2">2️⃣ Consulta a Base de Datos</h4>
              <pre className="bg-gray-900 text-gray-100 p-3 rounded text-xs overflow-x-auto">
{`async function handler(parameters) {
  const { Pool } = require('pg');
  
  const pool = new Pool({
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  });

  try {
    const result = await pool.query(
      'SELECT * FROM products WHERE category = $1 LIMIT $2',
      [parameters.category, parameters.limit || 10]
    );
    
    return {
      products: result.rows,
      count: result.rowCount
    };
  } finally {
    await pool.end();
  }
}`}</pre>
            </div>

            {/* Example 3: Send Email */}
            <div className="mb-4">
              <h4 className="text-sm font-medium text-gray-800 mb-2">3️⃣ Enviar Email (via SendGrid API)</h4>
              <div className="mb-2 p-2 bg-yellow-50 border border-yellow-200 rounded text-xs">
                <strong>⚠️ Importante:</strong> El ExecutionEngine NO soporta <code>require()</code>. 
                Usa APIs HTTP con <code>fetch</code> en lugar de librerías npm.
              </div>
              <pre className="bg-gray-900 text-gray-100 p-3 rounded text-xs overflow-x-auto">
{`async function handler(parameters) {
  // Validar parámetros requeridos
  if (!parameters.to || !parameters.subject || !parameters.body) {
    throw new Error('to, subject, and body are required');
  }

  // Usar SendGrid API (requiere SENDGRID_API_KEY en .env)
  // Alternativas: Mailgun, Resend, AWS SES, etc.
  const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      'Authorization': \`Bearer \${process.env.SENDGRID_API_KEY}\`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      personalizations: [{
        to: [{ email: parameters.to }]
      }],
      from: { 
        email: parameters.from || process.env.EMAIL_FROM || 'noreply@example.com' 
      },
      subject: parameters.subject,
      content: [{
        type: 'text/html',
        value: parameters.body
      }]
    })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(\`SendGrid error: \${response.status} - \${error}\`);
  }

  return {
    sent: true,
    to: parameters.to,
    subject: parameters.subject,
    timestamp: new Date().toISOString()
  };
}`}</pre>
            </div>

            {/* Example 4: Simple Calculation */}
            <div className="mb-4">
              <h4 className="text-sm font-medium text-gray-800 mb-2">4️⃣ Cálculo/Procesamiento</h4>
              <pre className="bg-gray-900 text-gray-100 p-3 rounded text-xs overflow-x-auto">
{`async function handler(parameters) {
  const { operation, numbers } = parameters;
  
  if (!Array.isArray(numbers) || numbers.length === 0) {
    throw new Error('Numbers array is required');
  }

  let result;
  switch (operation) {
    case 'sum':
      result = numbers.reduce((a, b) => a + b, 0);
      break;
    case 'average':
      result = numbers.reduce((a, b) => a + b, 0) / numbers.length;
      break;
    case 'max':
      result = Math.max(...numbers);
      break;
    case 'min':
      result = Math.min(...numbers);
      break;
    default:
      throw new Error(\`Unknown operation: \${operation}\`);
  }

  return { operation, result, count: numbers.length };
}`}</pre>
            </div>
          </div>

          {/* Best Practices */}
          <div>
            <h3 className="font-semibold text-gray-900 mb-3">✅ Buenas Prácticas</h3>
            <ul className="space-y-2 text-sm">
              <li className="flex gap-2">
                <span className="text-green-600 flex-shrink-0">✓</span>
                <span><strong>Valida inputs:</strong> Siempre verifica que los parámetros sean correctos antes de usarlos.</span>
              </li>
              <li className="flex gap-2">
                <span className="text-green-600 flex-shrink-0">✓</span>
                <span><strong>Maneja errores:</strong> Usa try/catch y lanza errores descriptivos.</span>
              </li>
              <li className="flex gap-2">
                <span className="text-green-600 flex-shrink-0">✓</span>
                <span><strong>Retorna objetos estructurados:</strong> Facilita al AI interpretar los resultados.</span>
              </li>
              <li className="flex gap-2">
                <span className="text-green-600 flex-shrink-0">✓</span>
                <span><strong>Usa async/await:</strong> Para operaciones asíncronas (APIs, DB, etc.).</span>
              </li>
              <li className="flex gap-2">
                <span className="text-green-600 flex-shrink-0">✓</span>
                <span><strong>Limpia recursos:</strong> Cierra conexiones de BD, streams, etc.</span>
              </li>
              <li className="flex gap-2">
                <span className="text-green-600 flex-shrink-0">✓</span>
                <span><strong>Documenta bien:</strong> Descripción clara para que el AI sepa cuándo usar tu tool.</span>
              </li>
            </ul>
          </div>

          {/* Security & Permissions */}
          <div>
            <h3 className="font-semibold text-gray-900 mb-3">🔒 Seguridad y Permisos</h3>
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 space-y-2 text-sm">
              <p><strong>Canales Permitidos:</strong> Define en qué canales puede usarse la tool (whatsapp, telegram, webchat, email).</p>
              <p><strong>Rate Limiting:</strong> Limita cuántas veces se puede ejecutar en un período de tiempo para evitar abusos.</p>
              <p><strong>Sandbox Aislado:</strong> Todas las tools se ejecutan en un entorno aislado sin acceso al sistema de archivos del host.</p>
              <p><strong>Variables de Entorno:</strong> Usa <code className="bg-white px-1 rounded">process.env.VAR_NAME</code> para credenciales sensibles (nunca las hardcodees).</p>
            </div>
          </div>

          {/* Testing */}
          <div>
            <h3 className="font-semibold text-gray-900 mb-3">🧪 Probar tu Tool</h3>
            <ol className="space-y-2 text-sm list-decimal list-inside">
              <li>Crea la tool con su implementación completa</li>
              <li>Haz clic en el botón "Test" (ícono de play) en la tarjeta de la tool</li>
              <li>Ingresa valores de prueba para cada parámetro</li>
              <li>Haz clic en "Run Test" para ejecutar</li>
              <li>Revisa el resultado y ajusta el código si es necesario</li>
            </ol>
          </div>

          {/* Close Button */}
          <div className="flex justify-end pt-4 border-t">
            <button
              onClick={() => setIsHelpModalOpen(false)}
              className="btn-primary"
            >
              Entendido
            </button>
          </div>

        </div>
      </Modal>
    </div>
  );
}
