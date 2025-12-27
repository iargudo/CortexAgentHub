import axios, { AxiosInstance } from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

// Export API base URL for use in embed codes
export const getApiBaseUrl = () => API_BASE_URL;

// Get frontend base URL for chat client links
export const getFrontendBaseUrl = () => {
  // In production, use window.location.origin
  // In development, check if we're on localhost
  if (typeof window !== 'undefined') {
    return window.location.origin;
  }
  // Fallback for SSR
  return import.meta.env.VITE_FRONTEND_URL || 'http://localhost:5174';
};

// Generate chat client URL for an agent
export const getChatClientUrl = (agentId: string) => {
  return `${getFrontendBaseUrl()}/chat/${agentId}`;
};

class ApiService {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: API_BASE_URL,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Add auth token interceptor
    this.client.interceptors.request.use((config) => {
      const token = localStorage.getItem('auth_token');
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
      return config;
    });

    // Add error interceptor
    this.client.interceptors.response.use(
      (response) => response,
      async (error) => {
        if (error.response?.status === 401) {
          console.warn('Authentication error:', error.response?.data);
          
          // Remove invalid token if it exists
          const token = localStorage.getItem('auth_token');
          if (token) {
            localStorage.removeItem('auth_token');
          }
          
          // Don't auto-login anymore - user must provide credentials
          // Redirect to login page or show login modal
          if (!error.config?.url?.includes('/login')) {
            // Only redirect if not already on login page
            window.dispatchEvent(new CustomEvent('auth:unauthorized'));
          }
        }
        return Promise.reject(error);
      }
    );
  }

  // Authentication
  async login(credentials: { username: string; password: string }) {
    try {
      if (!credentials.username || !credentials.password) {
        throw new Error('Username and password are required');
      }
      const { data } = await this.client.post('/api/admin/login', credentials);
      if (data.success && data.token) {
        localStorage.setItem('auth_token', data.token);
        return data;
      }
      throw new Error('Login failed: Invalid response');
    } catch (error: any) {
      console.error('Login error:', error);
      throw error;
    }
  }

  async logout() {
    localStorage.removeItem('auth_token');
  }

  // Admin Users management
  async getCurrentUser() {
    const { data } = await this.client.get('/api/admin/users/me');
    return data.user;
  }

  async changePassword(payload: {
    currentPassword: string;
    newPassword: string;
  }) {
    const { data } = await this.client.post('/api/admin/users/me/change-password', payload);
    return data;
  }

  async getUsers() {
    const { data } = await this.client.get('/api/admin/users');
    return data.users;
  }

  async createUser(payload: {
    username: string;
    password: string;
    email?: string;
    full_name?: string;
  }) {
    const { data } = await this.client.post('/api/admin/users', payload);
    return data.user;
  }

  async updateUser(id: string, payload: {
    username?: string;
    password?: string;
    email?: string;
    full_name?: string;
    is_active?: boolean;
  }) {
    const { data } = await this.client.put(`/api/admin/users/${id}`, payload);
    return data.user;
  }

  async deleteUser(id: string) {
    const { data } = await this.client.delete(`/api/admin/users/${id}`);
    return data;
  }

  // Dashboard
  async getDashboardStats() {
    const { data } = await this.client.get('/api/admin/dashboard/stats');
    return data.data;
  }

  async getHealth() {
    const { data } = await this.client.get('/api/admin/health');
    return data.data;
  }

  // Channels
  async getChannels() {
    const { data } = await this.client.get('/api/admin/channels');
    return data.data;
  }

  async createChannel(payload: {
    type?: string;
    channel_type?: string;
    name?: string;
    config: any;
    active?: boolean;
    is_active?: boolean;
  }) {
    const { data } = await this.client.post('/api/admin/channels', payload);
    return data.data;
  }

  async updateChannel(id: string, payload: {
    type?: string;
    name?: string;
    config?: any;
    active?: boolean;
  }) {
    const { data } = await this.client.put(`/api/admin/channels/${id}`, payload);
    return data.data;
  }

  async deleteChannel(id: string) {
    const { data } = await this.client.delete(`/api/admin/channels/${id}`);
    return data;
  }

  async testChannel(channelId: string, testMessage: string) {
    const { data } = await this.client.post(
      `/api/admin/channels/${channelId}/test`,
      { testMessage }
    );
    return data;
  }

  // LLMs
  async getLLMs() {
    const { data } = await this.client.get('/api/admin/llms');
    return data.data;
  }

  async createLLM(payload: {
    provider: string;
    model: string;
    config: any;
    priority?: number;
    active?: boolean;
  }) {
    const { data } = await this.client.post('/api/admin/llms', payload);
    return data.data;
  }

  async updateLLM(id: string, payload: {
    provider?: string;
    model?: string;
    config?: any;
    priority?: number;
    active?: boolean;
  }) {
    const { data } = await this.client.put(`/api/admin/llms/${id}`, payload);
    return data.data;
  }

  async deleteLLM(id: string) {
    const { data } = await this.client.delete(`/api/admin/llms/${id}`);
    return data;
  }

  // Tools
  async getTools() {
    const { data } = await this.client.get('/api/admin/tools');
    return data.data;
  }

  async createTool(payload: {
    name: string;
    description: string;
    parameters: any;
    permissions?: any;
    active?: boolean;
    tool_type?: string;
    config?: any;
    implementation?: string;
  }) {
    const { data } = await this.client.post('/api/admin/tools', payload);
    return data.data;
  }

  async updateTool(id: string, payload: {
    name?: string;
    description?: string;
    parameters?: any;
    permissions?: any;
    active?: boolean;
    tool_type?: string;
    config?: any;
    implementation?: string;
  }) {
    const { data } = await this.client.put(`/api/admin/tools/${id}`, payload);
    return data.data;
  }

  async deleteTool(id: string) {
    const { data } = await this.client.delete(`/api/admin/tools/${id}`);
    return data;
  }

  async testTool(id: string, parameters: any) {
    const { data } = await this.client.post(`/api/admin/tools/${id}/test`, { parameters });
    return data;
  }

  // Analytics
  async getAnalytics(params?: {
    startDate?: string;
    endDate?: string;
    granularity?: 'hour' | 'day' | 'week';
  }) {
    const { data } = await this.client.get('/api/admin/analytics', { params });
    return data.data;
  }

  // Logs
  async getLogs(params?: { level?: string; limit?: number }) {
    const { data } = await this.client.get('/api/admin/logs', { params });
    return data.data;
  }

  async deleteLogs() {
    const { data } = await this.client.delete('/api/admin/logs');
    return data;
  }

  // Conversations
  async getConversation(conversationId: string, limit?: number) {
    const { data } = await this.client.get(
      `/api/v1/conversations/${conversationId}`,
      { params: { limit } }
    );
    return data.data;
  }

  async listConversations(params?: {
    channel?: string;
    limit?: number;
    offset?: number;
    startDate?: string;
    endDate?: string;
    status?: string;
    userId?: string;
    hasTools?: string;
    flowId?: string;
  }) {
    const { data } = await this.client.get('/api/admin/conversations', { params });
    return data.data;
  }

  async getConversationDetail(conversationId: string) {
    const { data } = await this.client.get(`/api/admin/conversations/${conversationId}`);
    return data.data;
  }

  async exportConversations(params?: {
    channel?: string;
    startDate?: string;
    endDate?: string;
    status?: string;
    userId?: string;
  }): Promise<Blob> {
    const response = await this.client.get('/api/admin/conversations/export', {
      params,
      responseType: 'blob',
    });
    return response.data;
  }

  async getUserConversations(userId: string, params?: { channelType?: string; limit?: number }) {
    const { data } = await this.client.get(`/api/v1/conversations/user/${userId}`, { params });
    return data.data;
  }

  // WhatsApp Messaging
  async sendProactiveMessage(conversationId: string, message: string) {
    const { data } = await this.client.post(`/api/admin/conversations/${conversationId}/send-message`, {
      message,
    });
    return data;
  }

  async sendWhatsAppToNumber(phoneNumber: string, message: string, channelConfigId?: string) {
    const { data } = await this.client.post('/api/admin/whatsapp/send', {
      phoneNumber,
      message,
      channelConfigId,
    });
    return data;
  }

  async getWhatsAppChannels() {
    const { data } = await this.client.get('/api/admin/whatsapp/channels');
    return data.data;
  }

  // Messages
  async sendMessage(payload: {
    channelType: string;
    userId: string;
    content: string;
    metadata?: any;
  }) {
    // Use JWT token from localStorage (admin token) instead of API key
    // The token is automatically added by the axios interceptor
    const { data } = await this.client.post('/api/v1/messages/send', payload);
    return data.data;
  }

  // Orchestration Flows
  async getFlows() {
    const { data } = await this.client.get('/api/admin/flows');
    return data.data;
  }

  async createFlow(payload: {
    name: string;
    description?: string;
    channel_ids: string[]; // Array of channel IDs
    llm_id: string;
    enabled_tools?: string[];
    flow_config?: any;
    routing_conditions?: any;
    priority?: number;
    active?: boolean;
  }) {
    const { data } = await this.client.post('/api/admin/flows', payload);
    return data.data;
  }

  async updateFlow(id: string, payload: {
    name?: string;
    description?: string;
    channel_ids?: string[]; // Array of channel IDs
    llm_id?: string;
    enabled_tools?: string[];
    flow_config?: any;
    routing_conditions?: any;
    priority?: number;
    active?: boolean;
  }) {
    const { data } = await this.client.put(`/api/admin/flows/${id}`, payload);
    return data.data;
  }

  async deleteFlow(id: string) {
    const { data } = await this.client.delete(`/api/admin/flows/${id}`);
    return data;
  }

  // Embedding Models
  async getEmbeddingModels() {
    const { data } = await this.client.get('/api/admin/embedding-models');
    return data.data;
  }

  // Knowledge Bases
  async getKnowledgeBases(activeOnly?: boolean) {
    const { data } = await this.client.get('/api/admin/knowledge-bases', {
      params: { activeOnly },
    });
    return data.data;
  }

  async getKnowledgeBase(id: string) {
    const { data } = await this.client.get(`/api/admin/knowledge-bases/${id}`);
    return data.data;
  }

  async createKnowledgeBase(payload: {
    name: string;
    description?: string;
    embedding_model_id?: string;
    chunk_size?: number;
    chunk_overlap?: number;
    chunking_strategy?: string;
    metadata?: any;
  }) {
    const { data } = await this.client.post('/api/admin/knowledge-bases', payload);
    return data.data;
  }

  async updateKnowledgeBase(id: string, payload: {
    name?: string;
    description?: string;
    embedding_model_id?: string;
    chunk_size?: number;
    chunk_overlap?: number;
    chunking_strategy?: string;
    active?: boolean;
    metadata?: any;
  }) {
    const { data } = await this.client.put(`/api/admin/knowledge-bases/${id}`, payload);
    return data.data;
  }

  async deleteKnowledgeBase(id: string) {
    const { data } = await this.client.delete(`/api/admin/knowledge-bases/${id}`);
    return data;
  }

  // Knowledge Base Documents
  async getDocuments(knowledgeBaseId: string) {
    const { data } = await this.client.get(`/api/admin/knowledge-bases/${knowledgeBaseId}/documents`);
    return data.data;
  }

  async addDocument(knowledgeBaseId: string, payload: {
    title?: string;
    content?: string;
    file?: File;
    source_type?: string;
    source_url?: string;
    file_name?: string;
    file_type?: string;
    file_size?: number;
    metadata?: any;
  }) {
    // If file is provided, use FormData for multipart upload
    if (payload.file) {
      const formData = new FormData();
      if (payload.title) {
        formData.append('title', payload.title);
      }
      formData.append('file', payload.file);
      
      const { data } = await this.client.post(
        `/api/admin/knowledge-bases/${knowledgeBaseId}/documents`,
        formData,
        {
          headers: {
            'Content-Type': 'multipart/form-data',
          },
        }
      );
      return data.data;
    } else {
      // Otherwise, use JSON (existing behavior)
      const { data } = await this.client.post(`/api/admin/knowledge-bases/${knowledgeBaseId}/documents`, payload);
      return data.data;
    }
  }

  async addDocumentsBatch(knowledgeBaseId: string, payload: {
    files: File[];
    category?: string;
    defaultTitle?: string;
  }) {
    const formData = new FormData();
    
    // Add all files
    payload.files.forEach((file) => {
      formData.append('files', file);
    });
    
    // Add category if provided
    if (payload.category) {
      formData.append('category', payload.category);
    }
    
    // Add default title if provided
    if (payload.defaultTitle) {
      formData.append('defaultTitle', payload.defaultTitle);
    }
    
    const { data } = await this.client.post(
      `/api/admin/knowledge-bases/${knowledgeBaseId}/documents/batch`,
      formData,
      {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      }
    );
    return data.data;
  }

  async deleteDocument(knowledgeBaseId: string, documentId: string) {
    const { data } = await this.client.delete(`/api/admin/knowledge-bases/${knowledgeBaseId}/documents/${documentId}`);
    return data;
  }

  // Flow Knowledge Base Assignments
  async getFlowKnowledgeBases(flowId: string) {
    const { data } = await this.client.get(`/api/admin/flows/${flowId}/knowledge-bases`);
    return data.data;
  }

  async assignKnowledgeBaseToFlow(knowledgeBaseId: string, flowId: string, payload: {
    priority?: number;
    similarity_threshold?: number;
    max_results?: number;
  }) {
    const { data } = await this.client.post(
      `/api/admin/knowledge-bases/${knowledgeBaseId}/flows/${flowId}`,
      payload
    );
    return data.data;
  }

  async unassignKnowledgeBaseFromFlow(knowledgeBaseId: string, flowId: string) {
    const { data } = await this.client.delete(
      `/api/admin/knowledge-bases/${knowledgeBaseId}/flows/${flowId}`
    );
    return data;
  }

  // Queue monitoring
  async getQueueStats() {
    const { data } = await this.client.get('/api/admin/queues/stats');
    return data;
  }

  async getQueueJobs(queueName: string, status: 'waiting' | 'active' | 'completed' | 'failed' | 'delayed' = 'waiting', limit: number = 50) {
    const { data } = await this.client.get(`/api/admin/queues/${queueName}/jobs`, {
      params: { status, limit },
    });
    return data;
  }

  async resetQueueStatistics() {
    const { data } = await this.client.post('/api/admin/queues/reset-statistics');
    return data;
  }

  // RAG Search (for testing)
  async searchKnowledgeBases(payload: {
    flow_id: string;
    query_text: string;
    knowledge_base_ids?: string[];
    max_results?: number;
    similarity_threshold?: number;
  }) {
    const { data } = await this.client.post('/api/admin/knowledge-bases/search', payload);
    return data.data;
  }

  // Widgets
  async getWidgets() {
    const { data } = await this.client.get('/api/admin/widgets');
    return data.data;
  }

  async getWidget(id: string) {
    const { data } = await this.client.get(`/api/admin/widgets/${id}`);
    return data.data;
  }

  async createWidget(payload: {
    name: string;
    widget_key: string;
    channel_id: string;
    allowed_origins?: string[];
    position?: string;
    primary_color?: string;
    button_color?: string;
    button_text_color?: string;
    welcome_message?: string;
    placeholder_text?: string;
    show_typing_indicator?: boolean;
    enable_sound?: boolean;
    button_size?: number;
    chat_width?: number;
    chat_height?: number;
    active?: boolean;
  }) {
    const { data } = await this.client.post('/api/admin/widgets', payload);
    return data.data;
  }

  async updateWidget(id: string, payload: {
    name?: string;
    widget_key?: string;
    channel_id?: string;
    allowed_origins?: string[];
    position?: string;
    primary_color?: string;
    button_color?: string;
    button_text_color?: string;
    welcome_message?: string;
    placeholder_text?: string;
    show_typing_indicator?: boolean;
    enable_sound?: boolean;
    button_size?: number;
    chat_width?: number;
    chat_height?: number;
    active?: boolean;
  }) {
    const { data } = await this.client.put(`/api/admin/widgets/${id}`, payload);
    return data.data;
  }

  async deleteWidget(id: string) {
    const { data } = await this.client.delete(`/api/admin/widgets/${id}`);
    return data;
  }
}

export const api = new ApiService();
