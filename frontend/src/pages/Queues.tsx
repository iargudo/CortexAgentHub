import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/services/api';
import {
  CheckCircle,
  XCircle,
  Clock,
  Play,
  AlertCircle,
  RefreshCw,
  Loader2,
  Database,
  Activity,
  Info,
  TrendingUp,
  TrendingDown,
  Trash2,
} from 'lucide-react';

interface QueueStats {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  total: number;
}

interface QueueData {
  success: boolean;
  healthy: boolean;
  queues: Record<string, boolean>;
  stats: Record<string, QueueStats>;
  timestamp: string;
  error?: string;
}

interface QueueJob {
  id: string;
  name: string;
  data: any;
  attemptsMade: number;
  attempts?: number;
  timestamp?: number;
  processedOn?: number;
  finishedOn?: number;
  failedReason?: string;
  returnvalue?: any;
}

const QUEUE_NAMES = [
  { value: 'whatsapp-sending', label: 'WhatsApp Sending', color: 'bg-green-500' },
  { value: 'message-processing', label: 'Message Processing', color: 'bg-blue-500' },
  { value: 'webhook-processing', label: 'Webhook Processing', color: 'bg-purple-500' },
  { value: 'email-sending', label: 'Email Sending', color: 'bg-yellow-500' },
  { value: 'document-processing', label: 'Document Processing', color: 'bg-indigo-500' },
  { value: 'analytics', label: 'Analytics', color: 'bg-pink-500' },
  { value: 'notifications', label: 'Notifications', color: 'bg-orange-500' },
];

const STATUS_OPTIONS = [
  { value: 'waiting', label: 'Waiting', icon: Clock, color: 'text-yellow-600' },
  { value: 'active', label: 'Active', icon: Play, color: 'text-blue-600' },
  { value: 'completed', label: 'Completed', icon: CheckCircle, color: 'text-green-600' },
  { value: 'failed', label: 'Failed', icon: XCircle, color: 'text-red-600' },
  { value: 'delayed', label: 'Delayed', icon: AlertCircle, color: 'text-orange-600' },
];

export function Queues() {
  const [selectedQueue, setSelectedQueue] = useState<string>('whatsapp-sending');
  const [selectedStatus, setSelectedStatus] = useState<'waiting' | 'active' | 'completed' | 'failed' | 'delayed'>('waiting');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [showDetails, setShowDetails] = useState(false);
  const [isResetting, setIsResetting] = useState(false);

  const { data: queueData, isLoading: statsLoading, refetch: refetchStats, error: statsError } = useQuery<QueueData>({
    queryKey: ['queue-stats'],
    queryFn: async () => {
      const response = await api.getQueueStats();
      return response;
    },
    refetchInterval: autoRefresh ? 5000 : false, // Refresh every 5 seconds if enabled
    retry: 2, // Retry on failure
    retryDelay: 1000,
  });

  const handleResetStatistics = async () => {
    if (!confirm('¿Estás seguro de que quieres resetear todas las estadísticas de las colas?\n\nEsto eliminará todos los trabajos completados y fallidos de todas las colas. Esta acción no se puede deshacer.')) {
      return;
    }

    setIsResetting(true);
    try {
      await api.resetQueueStatistics();
      // Refetch stats after reset
      await refetchStats();
      await refetchJobs();
      alert('Estadísticas reseteadas exitosamente');
    } catch (error: any) {
      alert(`Error al resetear estadísticas: ${error.message || 'Error desconocido'}`);
    } finally {
      setIsResetting(false);
    }
  };

  const { data: jobsData, isLoading: jobsLoading, refetch: refetchJobs, error: jobsError } = useQuery({
    queryKey: ['queue-jobs', selectedQueue, selectedStatus],
    queryFn: async () => {
      const response = await api.getQueueJobs(selectedQueue, selectedStatus, 100);
      return response;
    },
    refetchInterval: autoRefresh ? 5000 : false,
    retry: 2, // Retry on failure
    retryDelay: 1000,
    enabled: !!selectedQueue, // Only fetch if queue is selected
  });

  const formatTimestamp = (timestamp?: number) => {
    if (!timestamp) return 'N/A';
    return new Date(timestamp).toLocaleString();
  };

  const formatDuration = (start?: number, end?: number) => {
    if (!start || !end) return 'N/A';
    const duration = end - start;
    if (duration < 1000) return `${duration}ms`;
    return `${(duration / 1000).toFixed(2)}s`;
  };

  // Calculate aggregate statistics
  const aggregateStats = queueData ? Object.values(queueData.stats).reduce(
    (acc, stat) => ({
      waiting: acc.waiting + stat.waiting,
      active: acc.active + stat.active,
      completed: acc.completed + stat.completed,
      failed: acc.failed + stat.failed,
      delayed: acc.delayed + stat.delayed,
      total: acc.total + stat.total,
    }),
    { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0, total: 0 }
  ) : null;

  // Count healthy vs unhealthy queues
  const queueHealthCounts = queueData
    ? Object.values(queueData.queues).reduce(
        (acc, healthy) => ({
          healthy: acc.healthy + (healthy ? 1 : 0),
          unhealthy: acc.unhealthy + (healthy ? 0 : 1),
        }),
        { healthy: 0, unhealthy: 0 }
      )
    : { healthy: 0, unhealthy: 0 };

  if (statsLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  // Handle error state gracefully
  if (statsError || !queueData) {
    return (
      <div className="p-6">
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <div className="flex items-center">
            <AlertCircle className="w-5 h-5 text-yellow-600 mr-2" />
            <div>
              <p className="text-yellow-800 font-semibold">
                Queue service not available
              </p>
              <p className="text-yellow-700 text-sm mt-1">
                {statsError?.message || 'Unable to connect to queue service. The system will use synchronous message sending.'}
              </p>
            </div>
          </div>
        </div>
        <div className="mt-4 bg-blue-50 border border-blue-200 rounded-lg p-4">
          <p className="text-blue-800 text-sm">
            <strong>Note:</strong> WhatsApp messages will still be sent synchronously even if the queue service is unavailable.
          </p>
        </div>
      </div>
    );
  }

  const stats = queueData.stats[selectedQueue] || {
    waiting: 0,
    active: 0,
    completed: 0,
    failed: 0,
    delayed: 0,
    total: 0,
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Queue Monitoring</h1>
          <p className="text-gray-600 mt-1">
            Monitor and manage background job queues
          </p>
        </div>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="rounded"
            />
            <span className="text-sm text-gray-700">Auto-refresh</span>
          </label>
          <button
            onClick={() => {
              refetchStats();
              refetchJobs();
            }}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
          <button
            onClick={handleResetStatistics}
            disabled={isResetting || !queueData?.healthy}
            className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
            title={!queueData?.healthy ? 'El servicio de colas no está disponible' : 'Resetear todas las estadísticas'}
          >
            {isResetting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Trash2 className="w-4 h-4" />
            )}
            {isResetting ? 'Reseteando...' : 'Resetear Estadísticas'}
          </button>
        </div>
      </div>

      {/* Health Status */}
      <div className={`p-4 rounded-lg border-2 ${queueData.healthy ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {queueData.healthy ? (
              <CheckCircle className="w-5 h-5 text-green-600" />
            ) : (
              <XCircle className="w-5 h-5 text-red-600" />
            )}
            <div>
              <span className={`font-semibold ${queueData.healthy ? 'text-green-800' : 'text-red-800'}`}>
                Queue Service: {queueData.healthy ? 'Healthy' : 'Unhealthy'}
              </span>
              <p className="text-sm text-gray-600 mt-1">
                Last updated: {new Date(queueData.timestamp).toLocaleString()}
              </p>
            </div>
          </div>
          <button
            onClick={() => setShowDetails(!showDetails)}
            className="flex items-center gap-2 px-3 py-1 text-sm text-gray-600 hover:text-gray-800 hover:bg-white rounded-lg transition-colors"
          >
            <Info className="w-4 h-4" />
            {showDetails ? 'Hide' : 'Show'} Details
          </button>
        </div>

        {/* Detailed Health Information */}
        {showDetails && (
          <div className="mt-4 pt-4 border-t border-gray-200 space-y-3">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-white rounded-lg p-3">
                <div className="flex items-center gap-2 mb-1">
                  <Database className="w-4 h-4 text-blue-600" />
                  <span className="text-xs font-medium text-gray-700">Redis Connection</span>
                </div>
                <p className={`text-lg font-bold ${queueData.healthy ? 'text-green-600' : 'text-red-600'}`}>
                  {queueData.healthy ? 'Connected' : 'Disconnected'}
                </p>
              </div>
              <div className="bg-white rounded-lg p-3">
                <div className="flex items-center gap-2 mb-1">
                  <Activity className="w-4 h-4 text-purple-600" />
                  <span className="text-xs font-medium text-gray-700">Queues Status</span>
                </div>
                <p className="text-lg font-bold text-gray-900">
                  {queueHealthCounts.healthy}/{Object.keys(queueData.queues).length} Healthy
                </p>
              </div>
              <div className="bg-white rounded-lg p-3">
                <div className="flex items-center gap-2 mb-1">
                  <TrendingUp className="w-4 h-4 text-green-600" />
                  <span className="text-xs font-medium text-gray-700">Total Jobs</span>
                </div>
                <p className="text-lg font-bold text-gray-900">
                  {aggregateStats?.total || 0}
                </p>
              </div>
              <div className="bg-white rounded-lg p-3">
                <div className="flex items-center gap-2 mb-1">
                  <TrendingDown className="w-4 h-4 text-red-600" />
                  <span className="text-xs font-medium text-gray-700">Failed Jobs</span>
                </div>
                <p className="text-lg font-bold text-red-600">
                  {aggregateStats?.failed || 0}
                </p>
              </div>
            </div>

            {/* Queue Health Details */}
            <div className="bg-white rounded-lg p-3">
              <h4 className="text-sm font-semibold text-gray-700 mb-2">Queue Health Status</h4>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {Object.entries(queueData.queues).map(([queueName, healthy]) => (
                  <div
                    key={queueName}
                    className={`flex items-center gap-2 text-xs p-2 rounded ${
                      healthy ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'
                    }`}
                  >
                    {healthy ? (
                      <CheckCircle className="w-3 h-3" />
                    ) : (
                      <XCircle className="w-3 h-3" />
                    )}
                    <span className="font-medium">{queueName}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Error Information */}
            {queueData.error && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                <p className="text-sm font-semibold text-red-800 mb-1">Error:</p>
                <p className="text-xs text-red-700">{queueData.error}</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Aggregate Statistics */}
      {aggregateStats && (
        <div className="bg-gradient-to-r from-blue-50 to-purple-50 rounded-lg p-4 border border-blue-200">
          <h2 className="text-lg font-semibold text-gray-900 mb-3 flex items-center gap-2">
            <Activity className="w-5 h-5" />
            Aggregate Statistics (All Queues)
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <div className="bg-white rounded-lg p-3 shadow-sm">
              <div className="flex items-center gap-2 mb-1">
                <Clock className="w-4 h-4 text-yellow-600" />
                <span className="text-xs font-medium text-gray-700">Waiting</span>
              </div>
              <p className="text-xl font-bold text-yellow-600">{aggregateStats.waiting}</p>
            </div>
            <div className="bg-white rounded-lg p-3 shadow-sm">
              <div className="flex items-center gap-2 mb-1">
                <Play className="w-4 h-4 text-blue-600" />
                <span className="text-xs font-medium text-gray-700">Active</span>
              </div>
              <p className="text-xl font-bold text-blue-600">{aggregateStats.active}</p>
            </div>
            <div className="bg-white rounded-lg p-3 shadow-sm">
              <div className="flex items-center gap-2 mb-1">
                <CheckCircle className="w-4 h-4 text-green-600" />
                <span className="text-xs font-medium text-gray-700">Completed</span>
              </div>
              <p className="text-xl font-bold text-green-600">{aggregateStats.completed}</p>
            </div>
            <div className="bg-white rounded-lg p-3 shadow-sm">
              <div className="flex items-center gap-2 mb-1">
                <XCircle className="w-4 h-4 text-red-600" />
                <span className="text-xs font-medium text-gray-700">Failed</span>
              </div>
              <p className="text-xl font-bold text-red-600">{aggregateStats.failed}</p>
            </div>
            <div className="bg-white rounded-lg p-3 shadow-sm">
              <div className="flex items-center gap-2 mb-1">
                <AlertCircle className="w-4 h-4 text-orange-600" />
                <span className="text-xs font-medium text-gray-700">Delayed</span>
              </div>
              <p className="text-xl font-bold text-orange-600">{aggregateStats.delayed}</p>
            </div>
          </div>
        </div>
      )}

      {/* Queue Selection */}
      <div className="bg-white rounded-lg shadow p-4">
        <h2 className="text-lg font-semibold mb-4">Select Queue</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {QUEUE_NAMES.map((queue) => {
            const queueStats = queueData.stats[queue.value] || {
              waiting: 0,
              active: 0,
              completed: 0,
              failed: 0,
              delayed: 0,
              total: 0,
            };
            const isSelected = selectedQueue === queue.value;
            return (
              <button
                key={queue.value}
                onClick={() => setSelectedQueue(queue.value)}
                className={`p-4 rounded-lg border-2 text-left transition-all ${
                  isSelected
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <div className="flex items-center gap-2 mb-2">
                  <div className={`w-3 h-3 rounded-full ${queue.color}`} />
                  <span className="font-semibold text-sm">{queue.label}</span>
                </div>
                <div className="text-xs text-gray-600">
                  Total: {queueStats.total}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Queue Statistics - Selected Queue */}
      <div className="bg-white rounded-lg shadow p-4">
        <h2 className="text-lg font-semibold mb-4">
          Statistics: {QUEUE_NAMES.find(q => q.value === selectedQueue)?.label || selectedQueue}
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <div className="bg-yellow-50 rounded-lg p-4 border border-yellow-200">
            <div className="flex items-center gap-2 mb-2">
              <Clock className="w-5 h-5 text-yellow-600" />
              <span className="text-sm font-medium text-gray-700">Waiting</span>
            </div>
            <p className="text-2xl font-bold text-yellow-600">{stats.waiting}</p>
          </div>
          <div className="bg-blue-50 rounded-lg p-4 border border-blue-200">
            <div className="flex items-center gap-2 mb-2">
              <Play className="w-5 h-5 text-blue-600" />
              <span className="text-sm font-medium text-gray-700">Active</span>
            </div>
            <p className="text-2xl font-bold text-blue-600">{stats.active}</p>
          </div>
          <div className="bg-green-50 rounded-lg p-4 border border-green-200">
            <div className="flex items-center gap-2 mb-2">
              <CheckCircle className="w-5 h-5 text-green-600" />
              <span className="text-sm font-medium text-gray-700">Completed</span>
            </div>
            <p className="text-2xl font-bold text-green-600">{stats.completed}</p>
          </div>
          <div className="bg-red-50 rounded-lg p-4 border border-red-200">
            <div className="flex items-center gap-2 mb-2">
              <XCircle className="w-5 h-5 text-red-600" />
              <span className="text-sm font-medium text-gray-700">Failed</span>
            </div>
            <p className="text-2xl font-bold text-red-600">{stats.failed}</p>
          </div>
          <div className="bg-orange-50 rounded-lg p-4 border border-orange-200">
            <div className="flex items-center gap-2 mb-2">
              <AlertCircle className="w-5 h-5 text-orange-600" />
              <span className="text-sm font-medium text-gray-700">Delayed</span>
            </div>
            <p className="text-2xl font-bold text-orange-600">{stats.delayed}</p>
          </div>
        </div>
      </div>

      {/* Jobs List */}
      <div className="bg-white rounded-lg shadow">
        <div className="p-4 border-b border-gray-200">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Jobs</h2>
            <div className="flex gap-2">
              {STATUS_OPTIONS.map((status) => {
                const StatusIcon = status.icon;
                const isSelected = selectedStatus === status.value;
                return (
                  <button
                    key={status.value}
                    onClick={() => setSelectedStatus(status.value as any)}
                    className={`flex items-center gap-2 px-3 py-1 rounded-lg text-sm transition-all ${
                      isSelected
                        ? 'bg-blue-100 text-blue-700'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    <StatusIcon className={`w-4 h-4 ${status.color}`} />
                    {status.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="p-4">
          {jobsLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
            </div>
          ) : jobsError ? (
            <div className="text-center py-8">
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 inline-block">
                <p className="text-yellow-800 text-sm">
                  Unable to load jobs: {jobsError.message || 'Unknown error'}
                </p>
              </div>
            </div>
          ) : jobsData?.jobs && jobsData.jobs.length > 0 ? (
            <div className="space-y-3">
              {jobsData.jobs.map((job: QueueJob) => (
                <div
                  key={job.id}
                  className="border border-gray-200 rounded-lg p-4 hover:bg-gray-50"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="font-semibold text-sm">{job.name}</span>
                        <span className="text-xs text-gray-500">#{job.id}</span>
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs text-gray-600">
                        <div>
                          <span className="font-medium">Created:</span>{' '}
                          {formatTimestamp(job.timestamp)}
                        </div>
                        {job.processedOn && (
                          <div>
                            <span className="font-medium">Processed:</span>{' '}
                            {formatTimestamp(job.processedOn)}
                          </div>
                        )}
                        {job.finishedOn && (
                          <div>
                            <span className="font-medium">Finished:</span>{' '}
                            {formatTimestamp(job.finishedOn)}
                          </div>
                        )}
                        {job.processedOn && job.finishedOn && (
                          <div>
                            <span className="font-medium">Duration:</span>{' '}
                            {formatDuration(job.processedOn, job.finishedOn)}
                          </div>
                        )}
                      </div>
                      {job.attemptsMade !== undefined && (
                        <div className="mt-2 text-xs text-gray-600">
                          <span className="font-medium">Attempts:</span>{' '}
                          {job.attemptsMade}
                          {job.attempts && ` / ${job.attempts}`}
                        </div>
                      )}
                      {job.failedReason && (
                        <div className="mt-2 p-2 bg-red-50 border border-red-200 rounded text-xs text-red-800">
                          <span className="font-medium">Error:</span> {job.failedReason}
                        </div>
                      )}
                      {job.data && (
                        <details className="mt-2">
                          <summary className="text-xs text-gray-500 cursor-pointer hover:text-gray-700">
                            View Data
                          </summary>
                          <pre className="mt-2 p-2 bg-gray-50 rounded text-xs overflow-auto">
                            {JSON.stringify(job.data, null, 2)}
                          </pre>
                        </details>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-gray-500">
              No {selectedStatus} jobs found
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

