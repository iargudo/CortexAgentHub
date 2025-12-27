import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/services/api';
import { AlertCircle, AlertTriangle, Info, Bug, Server, Trash2 } from 'lucide-react';
import { useState, useEffect } from 'react';
import { format } from 'date-fns';

const levelIcons = {
  error: AlertCircle,
  warn: AlertTriangle,
  info: Info,
  debug: Bug,
};

const levelColors = {
  error: 'text-red-600 bg-red-50 border-red-200',
  warn: 'text-yellow-600 bg-yellow-50 border-yellow-200',
  info: 'text-blue-600 bg-blue-50 border-blue-200',
  debug: 'text-gray-600 bg-gray-50 border-gray-200',
};

const levelBadgeColors = {
  error: 'bg-red-100 text-red-800',
  warn: 'bg-yellow-100 text-yellow-800',
  info: 'bg-blue-100 text-blue-800',
  debug: 'bg-gray-100 text-gray-800',
};

export function Logs() {
  const [level, setLevel] = useState<string>('');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [hasToken, setHasToken] = useState(false);
  const queryClient = useQueryClient();
  
  // Check for token and update state when it becomes available
  useEffect(() => {
    const checkToken = () => {
      const token = typeof window !== 'undefined' && !!localStorage.getItem('auth_token');
      setHasToken(token);
    };
    
    // Check immediately
    checkToken();
    
    // Also check after a short delay to catch auto-login completion
    const timeout = setTimeout(checkToken, 2000);
    
    // Listen for storage changes (in case token is set in another tab/window)
    window.addEventListener('storage', checkToken);
    
    return () => {
      clearTimeout(timeout);
      window.removeEventListener('storage', checkToken);
    };
  }, []);

  const { data: logs, isLoading } = useQuery({
    queryKey: ['logs', level],
    queryFn: () => api.getLogs({ level: level || undefined, limit: 100 }),
    refetchInterval: autoRefresh ? 5000 : false,
    enabled: hasToken, // Only run query if we have a token
    retry: (failureCount, error: any) => {
      // Don't retry on 401 errors - let the interceptor handle it
      if (error?.response?.status === 401) {
        return false;
      }
      return failureCount < 2;
    },
  });

  const deleteLogsMutation = useMutation({
    mutationFn: () => api.deleteLogs(),
    onSuccess: () => {
      // Invalidar todas las variantes de la query (con diferentes niveles)
      queryClient.invalidateQueries({ queryKey: ['logs'] });
      // Establecer los datos directamente a un array vacío para actualización inmediata
      queryClient.setQueryData(['logs', level], []);
      queryClient.setQueryData(['logs', ''], []);
      // Refrescar todas las queries relacionadas
      queryClient.refetchQueries({ queryKey: ['logs'] });
    },
    onError: (error: any) => {
      console.error('Error al borrar logs:', error);
      alert(`Error al borrar logs: ${error.message || 'Error desconocido'}`);
    },
  });

  const handleDeleteLogs = async () => {
    if (window.confirm('¿Estás seguro de que deseas borrar todos los logs? Esta acción no se puede deshacer.')) {
      try {
        await deleteLogsMutation.mutateAsync();
      } catch (error) {
        // El error ya se maneja en onError
      }
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">System Logs</h2>
        <div className="flex items-center gap-4">
          <select
            value={level}
            onChange={(e) => setLevel(e.target.value)}
            className="input w-auto"
          >
            <option value="">All Levels</option>
            <option value="error">Errors Only</option>
            <option value="warn">Warnings</option>
            <option value="info">Info</option>
            <option value="debug">Debug</option>
          </select>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="rounded"
            />
            Auto-refresh (5s)
          </label>

          <button
            onClick={handleDeleteLogs}
            disabled={deleteLogsMutation.isPending}
            className="btn btn-danger flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            title="Borrar todos los logs"
          >
            <Trash2 size={16} />
            {deleteLogsMutation.isPending ? 'Borrando...' : 'Borrar Logs'}
          </button>
        </div>
      </div>

      {/* Stats Summary */}
      <div className="grid grid-cols-4 gap-4">
        {['error', 'warn', 'info', 'debug'].map((lvl) => {
          const count = logs?.filter((log: any) => log.level === lvl).length || 0;
          const Icon = levelIcons[lvl as keyof typeof levelIcons];
          return (
            <div key={lvl} className="card">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600 capitalize">{lvl}</p>
                  <p className="text-2xl font-bold mt-1">{count}</p>
                </div>
                <div className={`p-3 rounded-lg ${levelColors[lvl as keyof typeof levelColors]}`}>
                  <Icon size={20} />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="card">
        <div className="space-y-2 max-h-[600px] overflow-y-auto">
          {!logs || logs.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <Info className="mx-auto mb-2" size={48} />
              <p>No logs found</p>
              <p className="text-sm mt-1">Logs will appear here as system events occur</p>
            </div>
          ) : (
            logs.map((log: any) => {
              const Icon = levelIcons[log.level as keyof typeof levelIcons];
              const colorClass = levelColors[log.level as keyof typeof levelColors];
              const badgeColor = levelBadgeColors[log.level as keyof typeof levelBadgeColors];

              return (
                <div
                  key={log.id}
                  className={`flex items-start gap-3 p-3 rounded-lg hover:bg-gray-50 border ${colorClass}`}
                >
                  <div className={`p-2 rounded ${colorClass}`}>
                    <Icon size={16} />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs text-gray-500">
                        {format(new Date(log.timestamp), 'yyyy-MM-dd HH:mm:ss')}
                      </span>
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${badgeColor}`}>
                        {log.level.toUpperCase()}
                      </span>
                      {log.service && (
                        <span className="flex items-center gap-1 text-xs text-gray-600 bg-gray-100 px-2 py-0.5 rounded">
                          <Server size={12} />
                          {log.service}
                        </span>
                      )}
                    </div>

                    <p className="text-sm font-medium mt-1">{log.message}</p>

                    {log.metadata && Object.keys(log.metadata).length > 0 && (
                      <details className="mt-2">
                        <summary className="text-xs text-gray-500 cursor-pointer hover:text-gray-700">
                          Show metadata
                        </summary>
                        <pre className="text-xs bg-gray-50 p-2 rounded mt-1 overflow-x-auto border">
                          {JSON.stringify(log.metadata, null, 2)}
                        </pre>
                      </details>
                    )}

                    {log.stackTrace && (
                      <details className="mt-2">
                        <summary className="text-xs text-red-500 cursor-pointer hover:text-red-700">
                          Show stack trace
                        </summary>
                        <pre className="text-xs bg-red-50 p-2 rounded mt-1 overflow-x-auto border border-red-200 text-red-900">
                          {log.stackTrace}
                        </pre>
                      </details>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
