import { useQuery } from '@tanstack/react-query';
import { api } from '@/services/api';
import {
  Activity,
  MessageSquare,
  DollarSign,
  Users,
  Calendar,
} from 'lucide-react';
import {
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
  Legend,
} from 'recharts';
import { useState, useMemo } from 'react';

const COLORS = ['#0ea5e9', '#8b5cf6', '#f59e0b', '#10b981', '#ef4444'];

// Format date for query with Ecuador timezone (UTC-5)
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

// Get current date in Ecuador timezone (UTC-5)
const getEcuadorDate = () => {
  const now = new Date();
  // Convert to Ecuador time (UTC-5)
  // Get UTC time and subtract 5 hours
  const utcTime = now.getTime() + (now.getTimezoneOffset() * 60 * 1000);
  const ecuadorTime = utcTime - (5 * 60 * 60 * 1000); // Subtract 5 hours
  const ecuadorDate = new Date(ecuadorTime);
  
  // Format as YYYY-MM-DD
  const year = ecuadorDate.getUTCFullYear();
  const month = String(ecuadorDate.getUTCMonth() + 1).padStart(2, '0');
  const day = String(ecuadorDate.getUTCDate()).padStart(2, '0');
  
  return `${year}-${month}-${day}`;
};

// Get default date range (last 7 days in Ecuador timezone)
const getDefaultDateRange = () => {
  const today = getEcuadorDate();
  const [year, month, day] = today.split('-').map(Number);
  
  // Calculate start date (7 days ago)
  const startDateObj = new Date(Date.UTC(year, month - 1, day));
  startDateObj.setUTCDate(startDateObj.getUTCDate() - 7);
  
  const startYear = startDateObj.getUTCFullYear();
  const startMonth = String(startDateObj.getUTCMonth() + 1).padStart(2, '0');
  const startDay = String(startDateObj.getUTCDate()).padStart(2, '0');
  
  return {
    startDate: `${startYear}-${startMonth}-${startDay}`,
    endDate: today,
  };
};

export function Dashboard() {
  const defaultRange = useMemo(() => getDefaultDateRange(), []);
  const [dateFilterType, setDateFilterType] = useState<'preset' | 'custom'>('preset');
  const [presetRange, setPresetRange] = useState('7d');
  const [customStartDate, setCustomStartDate] = useState(defaultRange.startDate);
  const [customEndDate, setCustomEndDate] = useState(defaultRange.endDate);

  const { data: stats, isLoading } = useQuery({
    queryKey: ['dashboard-stats'],
    queryFn: () => api.getDashboardStats(),
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  const { data: health } = useQuery({
    queryKey: ['health'],
    queryFn: () => api.getHealth(),
    refetchInterval: 10000,
  });

  // Calculate date range based on filter type
  const dateRangeParams = useMemo(() => {
    if (dateFilterType === 'preset') {
      const today = getEcuadorDate();
      const [year, month, day] = today.split('-').map(Number);
      
      let startDateStr: string;
      switch (presetRange) {
        case '24h':
          // Today
          startDateStr = today;
          break;
        case '7d':
          // 7 days ago
          const date7d = new Date(Date.UTC(year, month - 1, day));
          date7d.setUTCDate(date7d.getUTCDate() - 7);
          startDateStr = `${date7d.getUTCFullYear()}-${String(date7d.getUTCMonth() + 1).padStart(2, '0')}-${String(date7d.getUTCDate()).padStart(2, '0')}`;
          break;
        case '30d':
          // 30 days ago
          const date30d = new Date(Date.UTC(year, month - 1, day));
          date30d.setUTCDate(date30d.getUTCDate() - 30);
          startDateStr = `${date30d.getUTCFullYear()}-${String(date30d.getUTCMonth() + 1).padStart(2, '0')}-${String(date30d.getUTCDate()).padStart(2, '0')}`;
          break;
        default:
          // Default to 7 days
          const dateDefault = new Date(Date.UTC(year, month - 1, day));
          dateDefault.setUTCDate(dateDefault.getUTCDate() - 7);
          startDateStr = `${dateDefault.getUTCFullYear()}-${String(dateDefault.getUTCMonth() + 1).padStart(2, '0')}-${String(dateDefault.getUTCDate()).padStart(2, '0')}`;
      }
      
      return {
        startDate: formatDateForQuery(startDateStr, true),
        endDate: formatDateForQuery(today, false),
      };
    } else {
      return {
        startDate: formatDateForQuery(customStartDate, true),
        endDate: formatDateForQuery(customEndDate, false),
      };
    }
  }, [dateFilterType, presetRange, customStartDate, customEndDate]);

  const { data: analytics } = useQuery({
    queryKey: ['analytics', dateRangeParams],
    queryFn: () => api.getAnalytics({
      granularity: 'day',
      startDate: dateRangeParams.startDate,
      endDate: dateRangeParams.endDate,
    }),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  const statCards = [
    {
      title: 'Total Conversations',
      value: stats?.overview.totalConversations || 0,
      icon: MessageSquare,
      color: 'blue',
      change: '+12%',
    },
    {
      title: 'Total Messages',
      value: stats?.overview.totalMessages || 0,
      icon: Activity,
      color: 'purple',
      change: '+8%',
    },
    {
      title: 'Active Users (24h)',
      value: stats?.overview.activeUsers24h || 0,
      icon: Users,
      color: 'green',
      change: '+5%',
    },
    {
      title: 'Cost (24h)',
      value: `$${stats?.overview.totalCost24h?.toFixed(2) || '0.00'}`,
      icon: DollarSign,
      color: 'orange',
      change: '-3%',
    },
  ];

  const channelData = Object.entries(stats?.channelDistribution || {}).map(
    ([name, value]) => ({
      name,
      value,
    })
  );

  const llmData = Object.entries(stats?.llmProviderUsage || {}).map(
    ([name, value]) => ({
      name,
      value,
    })
  );

  return (
    <div className="space-y-6">
      {/* System Health Banner */}
      {health && (
        <div
          className={`card ${
            health.status === 'healthy' ? 'bg-green-50' : 'bg-yellow-50'
          }`}
        >
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold">System Status</h3>
              <p className="text-sm text-gray-600 mt-1">
                {health.status === 'healthy'
                  ? 'All systems operational'
                  : 'Some services degraded'}
              </p>
            </div>
            <div className="flex gap-4">
              {Object.entries(health.services).map(([service, status]) => (
                <div key={service} className="text-center">
                  <p className="text-xs text-gray-500 capitalize">{service}</p>
                  <span
                    className={`inline-block w-3 h-3 rounded-full mt-1 ${
                      status === 'up' ? 'bg-green-500' : 'bg-red-500'
                    }`}
                  ></span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Stat Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {statCards.map((stat) => {
          const Icon = stat.icon;
          return (
            <div key={stat.title} className="card">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">{stat.title}</p>
                  <p className="text-2xl font-bold mt-1">{stat.value}</p>
                  <p className="text-xs text-green-600 mt-1">{stat.change}</p>
                </div>
                <div className={`p-3 rounded-lg bg-${stat.color}-100`}>
                  <Icon className={`text-${stat.color}-600`} size={24} />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Real-time Metrics and Top Tools Row */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Real-time Metrics */}
        <div className="lg:col-span-3 grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="card text-center">
            <p className="text-sm text-gray-600">Messages/Minute</p>
            <p className="text-3xl font-bold mt-2 text-primary-600">
              {stats?.messagesPerMinute?.toFixed(1) || '0.0'}
            </p>
          </div>

          <div className="card text-center">
            <p className="text-sm text-gray-600">Avg Response Time</p>
            <p className="text-3xl font-bold mt-2 text-primary-600">
              {stats?.avgResponseTime?.toFixed(2) || '0.00'}s
            </p>
          </div>

          <div className="card text-center">
            <p className="text-sm text-gray-600">System Uptime</p>
            <p className="text-3xl font-bold mt-2 text-green-600">99.9%</p>
          </div>
        </div>

        {/* Top Tools Table */}
        <div className="card">
          <h3 className="text-lg font-semibold mb-4">Top Tools</h3>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2 px-2 text-xs font-medium text-gray-600">
                    Tool
                  </th>
                  <th className="text-right py-2 px-2 text-xs font-medium text-gray-600">
                    #
                  </th>
                </tr>
              </thead>
              <tbody>
                {stats?.topTools?.slice(0, 5).map((tool: any) => (
                  <tr key={tool.name} className="border-b hover:bg-gray-50">
                    <td className="py-2 px-2 text-xs truncate">{tool.name}</td>
                    <td className="py-2 px-2 text-xs text-right font-medium">
                      {tool.executions}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Channel Distribution */}
        <div className="card">
          <h3 className="text-lg font-semibold mb-4">Channel Distribution</h3>
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie
                data={channelData}
                cx="50%"
                cy="50%"
                labelLine={false}
                label={({ name, percent }) =>
                  `${name} ${(percent * 100).toFixed(0)}%`
                }
                outerRadius={80}
                fill="#8884d8"
                dataKey="value"
              >
                {channelData.map((_entry, index) => (
                  <Cell
                    key={`cell-${index}`}
                    fill={COLORS[index % COLORS.length]}
                  />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* LLM Usage */}
        <div className="card">
          <h3 className="text-lg font-semibold mb-4">LLM Provider Usage</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={llmData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" />
              <YAxis />
              <Tooltip />
              <Bar dataKey="value" fill="#0ea5e9" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Analytics Section */}
      <div className="space-y-6">
        <div className="flex items-center justify-between border-b border-gray-200 pb-4">
          <h2 className="text-2xl font-bold">Analytics</h2>
          <div className="flex items-center gap-4">
            {/* Filter Type Toggle */}
            <div className="flex items-center gap-2 bg-gray-100 rounded-lg p-1">
              <button
                onClick={() => setDateFilterType('preset')}
                className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                  dateFilterType === 'preset'
                    ? 'bg-white text-primary-600 shadow-sm'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                Rápido
              </button>
              <button
                onClick={() => setDateFilterType('custom')}
                className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors flex items-center gap-1 ${
                  dateFilterType === 'custom'
                    ? 'bg-white text-primary-600 shadow-sm'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                <Calendar size={14} />
                Personalizado
              </button>
            </div>

            {/* Preset Filter */}
            {dateFilterType === 'preset' && (
              <select
                value={presetRange}
                onChange={(e) => setPresetRange(e.target.value)}
                className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
              >
                <option value="24h">Últimas 24 horas</option>
                <option value="7d">Últimos 7 días</option>
                <option value="30d">Últimos 30 días</option>
              </select>
            )}

            {/* Custom Date Range Filter */}
            {dateFilterType === 'custom' && (
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-2">
                  <label className="text-sm text-gray-600">Desde:</label>
                  <input
                    type="date"
                    value={customStartDate}
                    onChange={(e) => setCustomStartDate(e.target.value)}
                    max={customEndDate}
                    className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-sm text-gray-600">Hasta:</label>
                  <input
                    type="date"
                    value={customEndDate}
                    onChange={(e) => setCustomEndDate(e.target.value)}
                    min={customStartDate}
                    max={getEcuadorDate()}
                    className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                  />
                </div>
                <span className="text-xs text-gray-500">(Hora Ecuador UTC-5)</span>
              </div>
            )}
          </div>
        </div>

        {/* Analytics Charts Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Message Volume Chart */}
          <div className="card">
            <h3 className="text-lg font-semibold mb-4">Message Volume</h3>
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={analytics?.metrics?.messageVolume || []}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="timestamp" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="count" stroke="#0ea5e9" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Response Time Chart */}
          <div className="card">
            <h3 className="text-lg font-semibold mb-4">Response Time</h3>
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={analytics?.metrics?.responseTime || []}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="timestamp" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="avg" stroke="#8b5cf6" name="Average" strokeWidth={2} />
                <Line type="monotone" dataKey="p95" stroke="#f59e0b" name="P95" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Cost Chart - Full Width */}
        <div className="card">
          <h3 className="text-lg font-semibold mb-4">Daily Costs</h3>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={analytics?.metrics?.costs || []}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="timestamp" />
              <YAxis />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="amount" stroke="#10b981" name="Cost ($)" strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
