import { useState, useRef, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/services/api';
import {
  Plus,
  Edit,
  Trash2,
  Book,
  Upload,
  AlertCircle,
  Loader2,
  FileText,
  X,
  FolderOpen,
  File,
  Sparkles,
  Clock,
  CheckCircle2,
  XCircle,
  Info,
} from 'lucide-react';
import { Modal } from '@/components/Modal';

interface KnowledgeBase {
  id: string;
  name: string;
  description?: string;
  embedding_model_id?: string;
  chunk_size: number;
  chunk_overlap: number;
  chunking_strategy: string;
  active: boolean;
  metadata: any;
  stats?: {
    documents: {
      total: number;
      completed: number;
      processing: number;
      failed: number;
    };
    embeddings: {
      total: number;
    };
  };
  created_at: string;
  updated_at: string;
}

interface EmbeddingModel {
  id: string;
  name: string;
  provider: string;
  model_name: string;
  dimensions: number;
  is_default: boolean;
  active: boolean;
}

interface Document {
  id: string;
  knowledge_base_id: string;
  title?: string;
  content: string;
  source_type: string;
  source_url?: string;
  file_name?: string;
  file_type?: string;
  file_size?: number;
  metadata?: any;
  status: string;
  error_message?: string;
  embeddings_count?: number;
  estimated_chunks?: number;
  created_at: string;
  updated_at: string;
}

export function KnowledgeBases() {
  const queryClient = useQueryClient();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isDocumentModalOpen, setIsDocumentModalOpen] = useState(false);
  const [isDocumentsViewOpen, setIsDocumentsViewOpen] = useState(false);
  const [selectedKB, setSelectedKB] = useState<KnowledgeBase | null>(null);
  const [editingKB, setEditingKB] = useState<KnowledgeBase | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [documentCategory, setDocumentCategory] = useState('');
  const [uploadMode, setUploadMode] = useState<'single' | 'batch'>('single');
  const [formData, setFormData] = useState<Partial<KnowledgeBase>>({
    name: '',
    description: '',
    embedding_model_id: '',
    chunk_size: 1000,
    chunk_overlap: 200,
    chunking_strategy: 'recursive',
    active: true,
  });
  const [documentContent, setDocumentContent] = useState('');
  const [documentTitle, setDocumentTitle] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropZoneRef = useRef<HTMLDivElement>(null);

  const { data: knowledgeBases, isLoading } = useQuery({
    queryKey: ['knowledge-bases'],
    queryFn: () => api.getKnowledgeBases(),
    // Auto-refresh every 10 seconds to update document stats
    refetchInterval: 10000,
  });

  const { data: embeddingModels } = useQuery({
    queryKey: ['embedding-models'],
    queryFn: () => api.getEmbeddingModels(),
  });

  const { data: documents, refetch: refetchDocuments } = useQuery({
    queryKey: ['documents', selectedKB?.id],
    queryFn: () => api.getDocuments(selectedKB!.id),
    enabled: !!selectedKB && isDocumentsViewOpen,
    // Auto-refresh every 3 seconds if there are documents processing or pending
    refetchInterval: (query) => {
      const docs = query.state.data as Document[] | undefined;
      const hasProcessing = docs?.some((d: Document) => 
        d.status === 'processing' || d.status === 'pending'
      );
      return hasProcessing ? 3000 : false; // Refresh every 3s if processing/pending
    },
  });

  const createMutation = useMutation({
    mutationFn: (data: any) => api.createKnowledgeBase(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['knowledge-bases'] });
      closeModal();
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, ...data }: any) => api.updateKnowledgeBase(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['knowledge-bases'] });
      closeModal();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deleteKnowledgeBase(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['knowledge-bases'] });
    },
  });

  const addDocumentMutation = useMutation({
    mutationFn: ({ kbId, data }: { kbId: string; data: any }) =>
      api.addDocument(kbId, data),
    onSuccess: (document) => {
      queryClient.invalidateQueries({ queryKey: ['documents', selectedKB?.id] });
      queryClient.invalidateQueries({ queryKey: ['knowledge-bases'] });
      setIsDocumentModalOpen(false);
      setDocumentContent('');
      setDocumentTitle('');
      setSelectedFile(null);
      setSelectedFiles([]);
      setDocumentCategory('');
      
      // Show message about async processing
      if (document?.status === 'pending' || document?.status === 'processing') {
        alert('Document uploaded successfully! It is now being processed in the background. You can check the status in the documents list.');
      }
      
      // Open documents view to show the new document
      if (selectedKB) {
        setIsDocumentsViewOpen(true);
        refetchDocuments();
      }
    },
    onError: (error: any) => {
      console.error('Error adding document:', error);
      const errorMessage = error?.response?.data?.message || error?.message || 'Failed to add document';
      alert(`Error: ${errorMessage}`);
    },
  });

  const addDocumentsBatchMutation = useMutation({
    mutationFn: ({ kbId, files, category, defaultTitle }: { kbId: string; files: File[]; category?: string; defaultTitle?: string }) =>
      api.addDocumentsBatch(kbId, { files, category, defaultTitle }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['documents', selectedKB?.id] });
      queryClient.invalidateQueries({ queryKey: ['knowledge-bases'] });
      setIsDocumentModalOpen(false);
      setSelectedFiles([]);
      setDocumentCategory('');
      setDocumentTitle('');
      
      // Show results with info about async processing
      const successCount = data.successCount || 0;
      const failureCount = data.failureCount || 0;
      if (failureCount > 0) {
        alert(`Upload completed: ${successCount} successful, ${failureCount} failed.\n\nNote: Documents are being processed in the background. Check the documents list to see the processing status.`);
      } else {
        alert(`Successfully uploaded ${successCount} document(s)!\n\nNote: Documents are being processed in the background. They will appear as "pending" or "processing" until embeddings are generated. Check the documents list to monitor progress.`);
      }
      
      // Open documents view to show the new documents
      if (selectedKB) {
        setIsDocumentsViewOpen(true);
        refetchDocuments();
      }
    },
    onError: (error: any) => {
      console.error('Error uploading documents:', error);
      const errorMessage = error?.response?.data?.message || error?.message || 'Failed to upload documents';
      
      // Check if it's a file size error
      if (errorMessage.includes('too large') || errorMessage.includes('file size')) {
        alert(`Error: File size too large. Maximum file size is 50MB. Please try smaller files.`);
      } else {
        alert(`Error: ${errorMessage}`);
      }
    },
  });

  const deleteDocumentMutation = useMutation({
    mutationFn: ({ kbId, docId }: { kbId: string; docId: string }) =>
      api.deleteDocument(kbId, docId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['documents', selectedKB?.id] });
      queryClient.invalidateQueries({ queryKey: ['knowledge-bases'] });
      refetchDocuments();
    },
  });

  const openCreateModal = () => {
    setEditingKB(null);
    setFormData({
      name: '',
      description: '',
      embedding_model_id: embeddingModels?.[0]?.id || '',
      chunk_size: 1000,
      chunk_overlap: 200,
      chunking_strategy: 'recursive',
      active: true,
    });
    setIsModalOpen(true);
  };

  const openEditModal = (kb: KnowledgeBase) => {
    setEditingKB(kb);
    setFormData({
      name: kb.name,
      description: kb.description,
      embedding_model_id: kb.embedding_model_id,
      chunk_size: kb.chunk_size,
      chunk_overlap: kb.chunk_overlap,
      chunking_strategy: kb.chunking_strategy,
      active: kb.active,
    });
    setIsModalOpen(true);
  };

  const openDocumentModal = (kb: KnowledgeBase) => {
    setSelectedKB(kb);
    setDocumentContent('');
    setDocumentTitle('');
    setSelectedFile(null);
    setSelectedFiles([]);
    setDocumentCategory('');
    setUploadMode('single');
    setIsDocumentModalOpen(true);
  };

  const openDocumentsView = (kb: KnowledgeBase) => {
    setSelectedKB(kb);
    setIsDocumentsViewOpen(true);
  };

  const closeDocumentsView = () => {
    setIsDocumentsViewOpen(false);
    setSelectedKB(null);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingKB(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingKB) {
      updateMutation.mutate({ id: editingKB.id, ...formData });
    } else {
      createMutation.mutate(formData);
    }
  };

  const handleAddDocument = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedKB) return;

    // If a file is selected, upload it
    if (selectedFile) {
      const validExtensions = ['.pdf', '.docx', '.xlsx', '.xls', '.txt', '.md', '.csv'];
      const fileExtension = selectedFile.name.toLowerCase().substring(selectedFile.name.lastIndexOf('.'));
      
      if (!validExtensions.includes(fileExtension)) {
        alert(`File type ${fileExtension} is not supported. Supported types: PDF, DOCX, XLSX, XLS, TXT, MD, CSV`);
        return;
      }

      // Prepare metadata with category if provided
      const metadata: any = {};
      if (documentCategory) {
        metadata.category = documentCategory;
      }

      // For binary files, send the file directly
      if (['.pdf', '.docx', '.xlsx', '.xls'].includes(fileExtension)) {
        addDocumentMutation.mutate({
          kbId: selectedKB.id,
          data: {
            title: documentTitle || selectedFile.name,
            file: selectedFile,
            metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
          },
        });
      } else {
        // For text files, read as text first
        const reader = new FileReader();
        reader.onload = async (event) => {
          const content = event.target?.result as string;
          addDocumentMutation.mutate({
            kbId: selectedKB.id,
            data: {
              title: documentTitle || selectedFile.name,
              content: content,
              source_type: 'file',
              file_name: selectedFile.name,
              file_type: selectedFile.type,
              file_size: selectedFile.size,
              metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
            },
          });
        };
        reader.readAsText(selectedFile);
      }
    } else if (documentContent.trim()) {
      // If no file but has content, send as manual entry
      const metadata: any = {};
      if (documentCategory) {
        metadata.category = documentCategory;
      }
      
      addDocumentMutation.mutate({
        kbId: selectedKB.id,
        data: {
          title: documentTitle || undefined,
          content: documentContent,
          source_type: 'manual',
          metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
        },
      });
    } else {
      // Neither file nor content
      alert('Please select a file or paste content');
    }
  };

  const validateAndSetFiles = useCallback((files: File[]) => {
    if (files.length === 0) return false;

    // Validate file types
    const validExtensions = ['.pdf', '.docx', '.xlsx', '.xls', '.txt', '.md', '.csv'];
    const invalidFiles = files.filter(file => {
      const fileExtension = file.name.toLowerCase().substring(file.name.lastIndexOf('.'));
      return !validExtensions.includes(fileExtension);
    });

    if (invalidFiles.length > 0) {
      alert(`Some files are not supported. Supported types: PDF, DOCX, XLSX, XLS, TXT, MD, CSV`);
      return false;
    }

    // Validate file sizes (50MB max)
    const maxSize = 50 * 1024 * 1024; // 50MB
    const oversizedFiles = files.filter(file => file.size > maxSize);
    if (oversizedFiles.length > 0) {
      alert(`Some files exceed the 50MB limit: ${oversizedFiles.map(f => f.name).join(', ')}`);
      return false;
    }

    if (uploadMode === 'batch') {
      setSelectedFiles(files);
    } else {
      setSelectedFile(files[0]);
      if (!documentTitle) {
        setDocumentTitle(files[0].name);
      }
    }
    return true;
  }, [uploadMode, documentTitle]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (validateAndSetFiles(files)) {
      e.target.value = '';
    }
  };

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      validateAndSetFiles(files);
    }
  }, [validateAndSetFiles]);

  const handleBatchUpload = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedKB || selectedFiles.length === 0) return;

    addDocumentsBatchMutation.mutate({
      kbId: selectedKB.id,
      files: selectedFiles,
      category: documentCategory || undefined,
      defaultTitle: documentTitle || undefined,
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">Loading knowledge bases...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Knowledge Bases</h2>
        <button onClick={openCreateModal} className="btn-primary flex items-center gap-2">
          <Plus size={18} />
          Create Knowledge Base
        </button>
      </div>

      {knowledgeBases && knowledgeBases.length > 0 ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {knowledgeBases.map((kb: KnowledgeBase) => (
            <div
              key={kb.id}
              className="bg-white border border-gray-200 rounded-xl shadow-sm hover:shadow-md transition-all duration-200 flex flex-col h-full overflow-hidden"
            >
              {/* Header */}
              <div className="p-5 bg-gradient-to-br from-primary-50 to-primary-100/50 border-b border-gray-200">
                <div className="flex items-start justify-between mb-3">
                  <div className="p-2.5 bg-white rounded-lg shadow-sm">
                    <Book className="text-primary-600" size={20} />
                  </div>
                  <span
                    className={`px-2.5 py-1 rounded-full text-xs font-medium flex items-center gap-1.5 ${
                      kb.active 
                        ? 'bg-green-100 text-green-700' 
                        : 'bg-gray-100 text-gray-600'
                    }`}
                  >
                    {kb.active ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
                    {kb.active ? 'Active' : 'Inactive'}
                  </span>
                </div>
                <h3 className="font-bold text-lg text-gray-900 mb-1 line-clamp-1">{kb.name}</h3>
                <p className="text-sm text-gray-600 line-clamp-2 min-h-[2.5rem]">
                  {kb.description || 'No description provided'}
                </p>
              </div>

              {/* Stats */}
              <div className="p-5 flex-1">
                {kb.stats ? (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between p-3 bg-blue-50 rounded-lg">
                      <div className="flex items-center gap-2">
                        <FileText className="text-blue-600" size={18} />
                        <span className="text-sm font-medium text-gray-700">Documents</span>
                      </div>
                      <div className="text-right">
                        <div className="text-lg font-bold text-gray-900">
                          {kb.stats.documents.completed}
                        </div>
                        <div className="text-xs text-gray-500">
                          / {kb.stats.documents.total} total
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center justify-between p-3 bg-purple-50 rounded-lg">
                      <div className="flex items-center gap-2">
                        <Sparkles className="text-purple-600" size={18} />
                        <span className="text-sm font-medium text-gray-700">Embeddings</span>
                      </div>
                      <div className="text-lg font-bold text-gray-900">
                        {kb.stats.embeddings.total.toLocaleString()}
                      </div>
                    </div>

                    {/* Status indicators */}
                    <div className="space-y-2 pt-2 border-t border-gray-200">
                      {kb.stats.documents.processing > 0 && (
                        <div className="flex items-center gap-2 text-sm text-amber-700 bg-amber-50 p-2 rounded-lg">
                          <Loader2 size={16} className="animate-spin" />
                          <span className="font-medium">{kb.stats.documents.processing} processing</span>
                        </div>
                      )}
                      {kb.stats.documents.failed > 0 && (
                        <div className="flex items-center gap-2 text-sm text-red-700 bg-red-50 p-2 rounded-lg">
                          <AlertCircle size={16} />
                          <span className="font-medium">{kb.stats.documents.failed} failed</span>
                        </div>
                      )}
                      {kb.stats.documents.processing === 0 && kb.stats.documents.failed === 0 && (
                        <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 p-2 rounded-lg">
                          <CheckCircle2 size={16} />
                          <span className="font-medium">All documents ready</span>
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-6 text-gray-500">
                    <FileText size={32} className="mx-auto mb-3 opacity-40" />
                    <p className="text-sm font-medium text-gray-600 mb-1">No documents yet</p>
                    <p className="text-xs text-gray-500 mb-4">
                      Add documents to start building your knowledge base
                    </p>
                    <button
                      onClick={() => openDocumentModal(kb)}
                      className="text-xs px-3 py-1.5 bg-primary-50 text-primary-600 rounded-lg hover:bg-primary-100 transition-colors font-medium"
                    >
                      Add First Document
                    </button>
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="p-4 bg-gray-50 border-t border-gray-200 flex gap-2">
                <button
                  onClick={() => openDocumentsView(kb)}
                  className="flex-1 px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium flex items-center justify-center gap-2"
                  title="View Documents"
                >
                  <FolderOpen size={16} />
                  View
                </button>
                <button
                  onClick={() => openDocumentModal(kb)}
                  className="flex-1 px-3 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors text-sm font-medium flex items-center justify-center gap-2"
                  title="Add Document"
                >
                  <Upload size={16} />
                  Add
                </button>
                <button
                  onClick={() => openEditModal(kb)}
                  className="px-3 py-2 border border-gray-300 rounded-lg hover:bg-gray-100 transition-colors"
                  title="Edit"
                >
                  <Edit size={16} className="text-gray-600" />
                </button>
                <button
                  onClick={() => {
                    if (confirm('Are you sure you want to delete this knowledge base? This will delete all documents and embeddings.')) {
                      deleteMutation.mutate(kb.id);
                    }
                  }}
                  className="px-3 py-2 border border-red-300 text-red-600 rounded-lg hover:bg-red-50 transition-colors"
                  title="Delete"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-lg p-12 text-center">
          <Book className="mx-auto text-gray-400 mb-4" size={48} />
          <h3 className="text-lg font-semibold text-gray-900 mb-2">No knowledge bases</h3>
          <p className="text-gray-600 mb-6">
            Create your first knowledge base to start using RAG with your agents.
          </p>
          <button
            onClick={openCreateModal}
            className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
          >
            Create Knowledge Base
          </button>
        </div>
      )}

      {/* Create/Edit Knowledge Base Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={closeModal}
        title={editingKB ? 'Edit Knowledge Base' : 'Create Knowledge Base'}
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
              placeholder="e.g., Celerity Knowledge Base"
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
              placeholder="Describe the purpose of this knowledge base"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Embedding Model</label>
            <select
              value={formData.embedding_model_id || ''}
              onChange={(e) => setFormData({ ...formData, embedding_model_id: e.target.value })}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
              required
            >
              <option value="">Select a model</option>
              {embeddingModels?.map((model: EmbeddingModel) => (
                <option key={model.id} value={model.id}>
                  {model.name} ({model.dimensions}D)
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Chunk Size</label>
              <input
                type="number"
                value={formData.chunk_size}
                onChange={(e) => setFormData({ ...formData, chunk_size: parseInt(e.target.value) })}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
                placeholder="1000"
                required
                min="100"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Chunk Overlap</label>
              <input
                type="number"
                value={formData.chunk_overlap}
                onChange={(e) => setFormData({ ...formData, chunk_overlap: parseInt(e.target.value) })}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
                placeholder="200"
                required
                min="0"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Chunking Strategy</label>
            <select
              value={formData.chunking_strategy}
              onChange={(e) => setFormData({ ...formData, chunking_strategy: e.target.value })}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
            >
              <option value="recursive">Recursive (Smart)</option>
              <option value="fixed">Fixed Size</option>
              <option value="semantic">Semantic (Coming Soon)</option>
            </select>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={formData.active}
              onChange={(e) => setFormData({ ...formData, active: e.target.checked })}
              className="rounded"
            />
            <label className="text-sm">Active</label>
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
              {editingKB ? 'Update' : 'Create'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Add Document Modal */}
      <Modal
        isOpen={isDocumentModalOpen}
        onClose={() => {
          setIsDocumentModalOpen(false);
          setDocumentContent('');
          setDocumentTitle('');
          setSelectedFile(null);
          setSelectedFiles([]);
          setDocumentCategory('');
          setUploadMode('single');
        }}
        title="Add Document"
        maxWidth="lg"
      >
        <div className="space-y-4">
          {/* Upload Mode Toggle */}
          <div className="flex gap-2 p-1 bg-gray-100 rounded-lg">
            <button
              type="button"
              onClick={() => {
                setUploadMode('single');
                setSelectedFiles([]);
              }}
              className={`flex-1 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                uploadMode === 'single'
                  ? 'bg-white text-primary-600 shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Single Upload
            </button>
            <button
              type="button"
              onClick={() => {
                setUploadMode('batch');
                setSelectedFile(null);
              }}
              className={`flex-1 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                uploadMode === 'batch'
                  ? 'bg-white text-primary-600 shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Batch Upload
            </button>
          </div>

          {uploadMode === 'batch' ? (
            <form onSubmit={handleBatchUpload} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Category/Group (Optional)</label>
                <input
                  type="text"
                  value={documentCategory}
                  onChange={(e) => setDocumentCategory(e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
                  placeholder="e.g., Product Manuals, FAQs, Policies"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Group documents by category for easier organization. Documents will be tagged with this category.
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Default Title Prefix (Optional)</label>
                <input
                  type="text"
                  value={documentTitle}
                  onChange={(e) => setDocumentTitle(e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
                  placeholder="e.g., Manual -"
                />
                <p className="text-xs text-gray-500 mt-1">
                  If provided, will be prepended to each file name. Leave empty to use file names as-is.
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Select Multiple Files</label>
                <div
                  ref={dropZoneRef}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  className={`relative border-2 border-dashed rounded-xl p-8 text-center transition-all duration-200 ${
                    isDragging
                      ? 'border-primary-500 bg-primary-50 scale-[1.02]'
                      : 'border-gray-300 bg-gray-50 hover:border-primary-400 hover:bg-primary-50/50'
                  }`}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    onChange={handleFileUpload}
                    className="hidden"
                    accept=".pdf,.docx,.xlsx,.xls,.txt,.md,.csv"
                    multiple
                  />
                  <div className="flex flex-col items-center">
                    <div className={`p-4 rounded-full mb-4 transition-colors ${
                      isDragging ? 'bg-primary-100' : 'bg-white'
                    }`}>
                      <Upload size={32} className={`${isDragging ? 'text-primary-600' : 'text-gray-400'}`} />
                    </div>
                    <p className="text-sm font-medium text-gray-700 mb-1">
                      {isDragging ? 'Drop files here' : 'Drag & drop files here'}
                    </p>
                    <p className="text-xs text-gray-500 mb-4">
                      or{' '}
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="text-primary-600 hover:text-primary-700 font-medium underline"
                      >
                        browse files
                      </button>
                    </p>
                    <p className="text-xs text-gray-500">
                      PDF, DOCX, XLSX, XLS, TXT, MD, CSV (max 50MB per file)
                    </p>
                  </div>
                </div>
                {selectedFiles.length > 0 && (
                  <div className="mt-4 p-4 bg-green-50 border border-green-200 rounded-lg">
                    <p className="text-sm font-medium text-green-800 mb-3 flex items-center gap-2">
                      <CheckCircle2 size={18} />
                      {selectedFiles.length} file(s) selected
                    </p>
                    <div className="max-h-48 overflow-y-auto space-y-2">
                      {selectedFiles.map((file, idx) => (
                        <div key={idx} className="flex items-center justify-between p-2 bg-white rounded border border-green-200">
                          <div className="flex items-center gap-2 flex-1 min-w-0">
                            <File size={16} className="text-gray-400 flex-shrink-0" />
                            <span className="text-sm text-gray-700 truncate">{file.name}</span>
                          </div>
                          <span className="text-xs text-gray-500 ml-2 flex-shrink-0">
                            {(file.size / 1024 / 1024).toFixed(2)} MB
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              const newFiles = selectedFiles.filter((_, i) => i !== idx);
                              setSelectedFiles(newFiles);
                            }}
                            className="ml-2 p-1 hover:bg-red-50 rounded transition-colors"
                          >
                            <X size={14} className="text-red-600" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setIsDocumentModalOpen(false);
                    setSelectedFiles([]);
                    setDocumentCategory('');
                    setDocumentTitle('');
                  }}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={selectedFiles.length === 0 || addDocumentsBatchMutation.isPending}
                  className="flex-1 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 font-medium"
                >
                  {addDocumentsBatchMutation.isPending ? (
                    <>
                      <Loader2 size={18} className="animate-spin" />
                      Uploading...
                    </>
                  ) : (
                    <>
                      <Upload size={18} />
                      Upload {selectedFiles.length} File{selectedFiles.length !== 1 ? 's' : ''}
                    </>
                  )}
                </button>
              </div>
            </form>
          ) : (
            <form onSubmit={handleAddDocument} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Category/Group (Optional)</label>
                <input
                  type="text"
                  value={documentCategory}
                  onChange={(e) => setDocumentCategory(e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
                  placeholder="e.g., Product Manuals, FAQs, Policies"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Group documents by category for easier organization.
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Title (Optional)</label>
                <input
                  type="text"
                  value={documentTitle}
                  onChange={(e) => setDocumentTitle(e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
                  placeholder="Document title"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Upload File</label>
                <div
                  ref={dropZoneRef}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  className={`relative border-2 border-dashed rounded-xl p-6 text-center transition-all duration-200 ${
                    isDragging
                      ? 'border-primary-500 bg-primary-50 scale-[1.02]'
                      : 'border-gray-300 bg-gray-50 hover:border-primary-400 hover:bg-primary-50/50'
                  }`}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    onChange={handleFileUpload}
                    className="hidden"
                    accept=".pdf,.docx,.xlsx,.xls,.txt,.md,.csv"
                  />
                  <div className="flex flex-col items-center">
                    <div className={`p-3 rounded-full mb-3 transition-colors ${
                      isDragging ? 'bg-primary-100' : 'bg-white'
                    }`}>
                      <Upload size={24} className={`${isDragging ? 'text-primary-600' : 'text-gray-400'}`} />
                    </div>
                    <p className="text-sm font-medium text-gray-700 mb-1">
                      {isDragging ? 'Drop file here' : 'Drag & drop file here'}
                    </p>
                    <p className="text-xs text-gray-500 mb-3">
                      or{' '}
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="text-primary-600 hover:text-primary-700 font-medium underline"
                      >
                        browse file
                      </button>
                    </p>
                    <p className="text-xs text-gray-500">
                      PDF, DOCX, XLSX, XLS, TXT, MD, CSV (max 50MB)
                    </p>
                  </div>
                </div>
                {selectedFile && (
                  <div className="mt-3 p-3 bg-green-50 border border-green-200 rounded-lg flex items-center justify-between">
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <File size={18} className="text-green-600 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-green-800 truncate">{selectedFile.name}</p>
                        <p className="text-xs text-green-600">
                          {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelectedFile(null)}
                      className="p-1 hover:bg-red-50 rounded transition-colors ml-2"
                    >
                      <X size={16} className="text-red-600" />
                    </button>
                  </div>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">
                  Or Paste Content
                </label>
                <textarea
                  value={documentContent}
                  onChange={(e) => setDocumentContent(e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500 font-mono text-sm"
                  rows={15}
                  placeholder="Paste document content here...&#10;&#10;Tip: You can also upload PDF, Word, or Excel files above.&#10;Markdown format is recommended for better structure."
                />
                <p className="text-xs text-gray-500 mt-1">
                  Paste content from any source, or upload files above. Use Markdown format (## Headers, **bold**, *lists*) for better structure.
                </p>
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setIsDocumentModalOpen(false);
                    setDocumentContent('');
                    setDocumentTitle('');
                    setSelectedFile(null);
                    setDocumentCategory('');
                  }}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={(!documentContent.trim() && !selectedFile) || addDocumentMutation.isPending}
                  className="flex-1 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 font-medium"
                >
                  {addDocumentMutation.isPending ? (
                    <>
                      <Loader2 size={18} className="animate-spin" />
                      Uploading...
                    </>
                  ) : (
                    <>
                      <Upload size={18} />
                      Add Document
                    </>
                  )}
                </button>
              </div>
            </form>
          )}
        </div>
      </Modal>

      {/* Documents View Modal */}
      <Modal
        isOpen={isDocumentsViewOpen}
        onClose={closeDocumentsView}
        title={`Documents - ${selectedKB?.name || ''}`}
        maxWidth="lg"
      >
        <div className="space-y-4">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm text-gray-600">
                Manage documents in this knowledge base. Delete documents to upload new versions.
              </p>
              <button
                onClick={() => {
                  if (selectedKB) {
                    openDocumentModal(selectedKB);
                    setIsDocumentsViewOpen(false);
                  }
                }}
                className="flex items-center gap-2 px-3 py-2 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
              >
                <Plus size={16} />
                Add Document
              </button>
            </div>
            
            {/* Status info banner */}
            {documents && documents.some((d: Document) => d.status === 'pending' || d.status === 'processing') && (
              <div className="flex items-start gap-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                <Info size={18} className="text-blue-600 flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-blue-900 mb-1">
                    Documents are being processed
                  </p>
                  <p className="text-xs text-blue-700">
                    Documents are processed asynchronously in the background. The status will update automatically. 
                    Processing includes chunking the document and generating embeddings, which may take a few moments.
                  </p>
                </div>
              </div>
            )}
          </div>

          {documents && documents.length > 0 ? (
            <div className="space-y-6">
              {(() => {
                // Group documents by category
                const groupedDocs = documents.reduce((acc: Record<string, Document[]>, doc: Document) => {
                  const category = (doc.metadata as any)?.category || 'uncategorized';
                  if (!acc[category]) {
                    acc[category] = [];
                  }
                  acc[category].push(doc);
                  return acc;
                }, {});

                // Sort categories (uncategorized last)
                const sortedCategories = Object.keys(groupedDocs).sort((a, b) => {
                  if (a === 'uncategorized') return 1;
                  if (b === 'uncategorized') return -1;
                  return a.localeCompare(b);
                });

                // If only one category and it's uncategorized, don't show category header
                const hasMultipleCategories = sortedCategories.length > 1;
                const onlyUncategorized = sortedCategories.length === 1 && sortedCategories[0] === 'uncategorized';

                return sortedCategories.map((category) => (
                  <div key={category} className="space-y-3">
                    {/* Only show category header if there are multiple categories or if it's a named category */}
                    {(hasMultipleCategories || !onlyUncategorized) && (
                      <div className="flex items-center gap-2 pb-2 border-b border-gray-300">
                        <h3 className="font-semibold text-gray-900">
                          {category === 'uncategorized' ? '📄 Documents without Category' : `📁 ${category}`}
                        </h3>
                        <span className="text-xs text-gray-500">
                          ({groupedDocs[category].length} {groupedDocs[category].length === 1 ? 'document' : 'documents'})
                        </span>
                      </div>
                    )}
                    {groupedDocs[category].map((doc: Document) => (
                      <div
                        key={doc.id}
                        className="flex items-start justify-between p-4 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-2">
                            <FileText size={18} className="text-gray-400 flex-shrink-0" />
                            <h4 className="font-medium text-gray-900 truncate">
                              {doc.title || doc.file_name || 'Untitled Document'}
                            </h4>
                            <span
                              className={`px-2.5 py-1 rounded-full text-xs font-medium flex-shrink-0 flex items-center gap-1.5 ${
                                doc.status === 'completed'
                                  ? 'bg-green-100 text-green-800'
                                  : doc.status === 'processing'
                                  ? 'bg-yellow-100 text-yellow-800'
                                  : doc.status === 'pending'
                                  ? 'bg-blue-100 text-blue-800'
                                  : doc.status === 'failed'
                                  ? 'bg-red-100 text-red-800'
                                  : 'bg-gray-100 text-gray-800'
                              }`}
                            >
                              {(doc.status === 'processing' || doc.status === 'pending') && (
                                <Loader2 size={12} className="animate-spin" />
                              )}
                              {doc.status === 'completed' && (
                                <CheckCircle2 size={12} />
                              )}
                              {doc.status === 'failed' && (
                                <XCircle size={12} />
                              )}
                              {doc.status === 'pending' ? 'Queued' : 
                               doc.status === 'processing' ? 'Processing' :
                               doc.status === 'completed' ? 'Ready' :
                               doc.status === 'failed' ? 'Failed' : doc.status}
                            </span>
                          </div>
                    <div className="text-xs text-gray-500 space-y-1 ml-7">
                      {doc.file_name && (
                        <div>
                          <span className="font-medium">File:</span> {doc.file_name}
                          {doc.file_size && ` (${(doc.file_size / 1024).toFixed(2)} KB)`}
                        </div>
                      )}
                      <div>
                        <span className="font-medium">Type:</span> {doc.source_type}
                        {doc.file_type && ` • ${doc.file_type}`}
                      </div>
                      <div>
                        <span className="font-medium">Content:</span>{' '}
                        {doc.content.length.toLocaleString()} characters
                      </div>
                      {doc.embeddings_count !== undefined && (
                        <div className={`flex items-center gap-2 ${
                          doc.status === 'completed' && doc.embeddings_count === 0 
                            ? 'text-red-600 font-medium' 
                            : 'text-gray-600'
                        }`}>
                          <span className="font-medium">Embeddings:</span>
                          <span>
                            {doc.embeddings_count.toLocaleString()}
                            {doc.estimated_chunks && doc.estimated_chunks > 0 && (
                              <span className="text-gray-500">
                                {' '}/ ~{doc.estimated_chunks.toLocaleString()} expected
                              </span>
                            )}
                          </span>
                          {doc.status === 'completed' && doc.embeddings_count === 0 && (
                            <span className="text-xs text-red-600 ml-2">
                              ⚠️ No embeddings found - document may not be fully processed
                            </span>
                          )}
                        </div>
                      )}
                      {(doc.status === 'processing' || doc.status === 'pending') && (
                        <div className="mt-2 p-2 bg-blue-50 rounded-lg border border-blue-200">
                          <div className="flex items-center gap-2 text-xs text-blue-700">
                            {doc.status === 'pending' ? (
                              <>
                                <Clock size={12} />
                                <span className="font-medium">Queued for processing...</span>
                              </>
                            ) : (
                              <>
                                <Loader2 size={12} className="animate-spin" />
                                <span className="font-medium">Processing embeddings...</span>
                              </>
                            )}
                          </div>
                          <p className="text-xs text-blue-600 mt-1 ml-4">
                            {doc.status === 'pending' 
                              ? 'Document is in the queue and will be processed shortly.'
                              : 'Generating embeddings and chunking document. This may take a few moments.'}
                          </p>
                        </div>
                      )}
                      <div>
                        <span className="font-medium">Created:</span>{' '}
                        {new Date(doc.created_at).toLocaleString()}
                      </div>
                      {doc.error_message && (
                        <div className="text-red-600 mt-2">
                          <span className="font-medium">Error:</span> {doc.error_message}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 ml-4">
                    {doc.status === 'processing' && (
                      <Loader2 size={16} className="animate-spin text-yellow-600" />
                    )}
                    <button
                      onClick={() => {
                        if (
                          confirm(
                            `Are you sure you want to delete "${doc.title || doc.file_name || 'this document'}"? This will also delete all its embeddings.`
                          )
                        ) {
                          deleteDocumentMutation.mutate({
                            kbId: selectedKB!.id,
                            docId: doc.id,
                          });
                        }
                      }}
                      className="flex items-center gap-1 px-3 py-2 text-sm border border-red-300 text-red-600 rounded-lg hover:bg-red-50 transition-colors"
                      disabled={deleteDocumentMutation.isPending}
                    >
                      <Trash2 size={14} />
                      Delete
                    </button>
                  </div>
                </div>
                    ))}
                  </div>
                ));
              })()}
            </div>
          ) : (
            <div className="text-center py-12 border border-gray-200 rounded-lg">
              <FileText className="mx-auto text-gray-400 mb-4" size={48} />
              <h3 className="text-lg font-semibold text-gray-900 mb-2">No documents</h3>
              <p className="text-gray-600 mb-6">
                Add your first document to start building the knowledge base.
              </p>
              <button
                onClick={() => {
                  if (selectedKB) {
                    openDocumentModal(selectedKB);
                    setIsDocumentsViewOpen(false);
                  }
                }}
                className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
              >
                <Plus size={16} className="inline mr-2" />
                Add Document
              </button>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}

