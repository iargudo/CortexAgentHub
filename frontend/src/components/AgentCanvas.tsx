import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import ReactFlow, {
  Controls,
  Background,
  Panel,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { useAgentCanvas } from '@/hooks/useAgentCanvas';
import { Agent, Tool, LLM, Channel } from '@/types/agent';
import { FlowNode } from './FlowNode';
import {
  X,
  Layers,
  RefreshCw,
  Sun,
  Moon,
  Download,
  Save,
  Search,
  AlertCircle,
  Bot,
  Info,
  Maximize2,
} from 'lucide-react';

interface AgentCanvasProps {
  agent: Agent | null;
  tools?: Tool[];
  llms?: LLM[];
  channels?: Channel[];
  onClose: () => void;
}

export function AgentCanvas({ agent, tools, llms, channels, onClose }: AgentCanvasProps) {
  const {
    nodes,
    edges,
    isDarkMode,
    searchTerm,
    validationIssues,
    setReactFlowInstance,
    setIsDarkMode,
    setSearchTerm,
    onNodesChange,
    onEdgesChange,
    onConnect,
    handleFitView,
    autoLayout,
    saveCanvas,
    exportAsImage,
    loadAgentIntoCanvas,
  } = useAgentCanvas({ agent, tools, llms, channels });

  // Load agent when it changes
  useEffect(() => {
    if (agent) {
      loadAgentIntoCanvas(agent);
    }
  }, [agent, loadAgentIntoCanvas]);

  // Handle save success - close modal
  const handleSave = async () => {
    const success = await saveCanvas();
    if (success) {
      onClose();
    }
  };

  if (!agent) return null;

  const modalContent = (
    <div className="fixed top-0 left-0 right-0 bottom-0 w-screen h-screen bg-black bg-opacity-50 z-[9999] overflow-hidden" style={{ margin: 0, padding: 0 }}>
      <div className="absolute top-0 left-0 right-0 bottom-0 bg-white flex flex-col overflow-hidden" style={{ margin: 0, padding: 0 }}>
        {/* Header */}
        <div className="p-5 border-b bg-gradient-to-r from-blue-50 to-purple-50">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                <Layers className="text-blue-600" size={24} />
                Visualización de Orquestación
              </h2>
              <p className="text-sm text-gray-600 mt-1">{agent.name}</p>
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-white rounded-lg transition-colors"
            >
              <X size={22} />
            </button>
          </div>
              
          {/* Toolbar */}
          <div className="flex items-center gap-2 flex-wrap">
            {/* Search */}
            <div className="relative flex-1 min-w-[200px] max-w-[300px]">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={16} />
              <input
                type="text"
                placeholder="Buscar en diagrama..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
              {searchTerm && (
                <button
                  onClick={() => setSearchTerm('')}
                  className="absolute right-2 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  <X size={14} />
                </button>
              )}
            </div>

            {/* Auto-layout */}
            <button
              onClick={autoLayout}
              className="px-3 py-2 text-sm bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors flex items-center gap-2"
              title="Reorganizar automáticamente"
            >
              <RefreshCw size={16} />
              Auto-Layout
            </button>

            {/* Toggle Dark Mode */}
            <button
              onClick={() => setIsDarkMode(!isDarkMode)}
              className="px-3 py-2 text-sm bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
              title={isDarkMode ? 'Modo claro' : 'Modo oscuro'}
            >
              {isDarkMode ? <Sun size={16} /> : <Moon size={16} />}
            </button>

            {/* Export PNG */}
            <button
              onClick={exportAsImage}
              className="px-3 py-2 text-sm bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors flex items-center gap-2"
              title="Exportar como imagen PNG (2400x1600)"
            >
              <Download size={16} />
              Exportar PNG
            </button>

            {/* Save Layout */}
            <button
              onClick={handleSave}
              className="px-3 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2"
              title="Guardar el layout del diagrama"
            >
              <Save size={16} />
              Guardar Layout
            </button>
          </div>
        </div>
            
        {/* Canvas */}
        <div className="flex-1 overflow-hidden relative min-h-0">
          <div className={`h-full w-full relative ${isDarkMode ? 'bg-gray-900' : 'bg-white'}`}>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onInit={setReactFlowInstance}
              nodeTypes={{ default: FlowNode }}
              deleteKeyCode={['Backspace', 'Delete']}
              fitView
              fitViewOptions={{ padding: 0.2, includeHiddenNodes: false }}
              minZoom={0.1}
              maxZoom={2}
              defaultViewport={{ x: 0, y: 0, zoom: 0.65 }}
              className={isDarkMode ? 'dark' : ''}
            >
              <Background 
                color={isDarkMode ? '#374151' : '#e5e7eb'} 
                gap={16} 
                size={1} 
              />
              <Controls className={`${isDarkMode ? 'bg-gray-800 border-gray-600' : 'bg-white border-gray-200'} border-2 rounded-lg shadow-lg`} />
              
              {/* Overview Panel */}
              <div 
                className={`${isDarkMode ? 'bg-gray-800 border-gray-600' : 'bg-white border-gray-300'} rounded-xl shadow-2xl p-4 border-4 border-blue-600`}
                style={{ 
                  position: 'absolute',
                  bottom: '20px', 
                  right: '20px',
                  width: '280px',
                  zIndex: 9999,
                }}
              >
                <div className="space-y-3">
                  <div className="flex items-center justify-between border-b border-gray-300 pb-2">
                    <div className="flex items-center gap-2">
                      <Layers size={16} className="text-blue-600" />
                      <span className="font-bold text-sm">Vista General</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                      <span className="text-xs text-gray-500">Live</span>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className={`p-2 rounded ${isDarkMode ? 'bg-gray-700' : 'bg-gray-100'}`}>
                      <div className="text-gray-500">Total Nodos</div>
                      <div className="text-lg font-bold">{nodes.length}</div>
                    </div>
                    <div className={`p-2 rounded ${isDarkMode ? 'bg-gray-700' : 'bg-gray-100'}`}>
                      <div className="text-gray-500">Conexiones</div>
                      <div className="text-lg font-bold">{edges.length}</div>
                    </div>
                  </div>
                  
                  <div className="space-y-1 text-xs">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded bg-sky-400"></div>
                        <span>Canales</span>
                      </div>
                      <span className="font-bold">{nodes.filter(n => n.id.includes('channel') || n.id.includes('widget')).length}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded bg-purple-400"></div>
                        <span>LLM</span>
                      </div>
                      <span className="font-bold">{nodes.filter(n => n.id === 'llm').length}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded bg-emerald-400"></div>
                        <span>KBs</span>
                      </div>
                      <span className="font-bold">{nodes.filter(n => n.id.startsWith('kb-')).length}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded bg-orange-400"></div>
                        <span>Tools</span>
                      </div>
                      <span className="font-bold">{nodes.filter(n => n.id.startsWith('tool-')).length}</span>
                    </div>
                  </div>
                  
                  <button
                    onClick={handleFitView}
                    className="w-full py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium flex items-center justify-center gap-2"
                  >
                    <Maximize2 size={14} />
                    Centrar Todo
                  </button>
                </div>
              </div>
              
              {/* Legend */}
              <Panel position="top-left" className={`${isDarkMode ? 'bg-gray-800 border-gray-600 text-white' : 'bg-white border-gray-200 text-gray-900'} rounded-lg shadow-lg p-4 border-2 m-4`}>
                <div className="space-y-2">
                  <div className="flex items-center gap-2 mb-3">
                    <Info size={16} className="text-blue-600" />
                    <h3 className="font-bold text-sm">Leyenda</h3>
                  </div>
                  <div className="space-y-1.5 text-xs">
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full bg-sky-400 border-2 border-sky-600"></div>
                      <span>Canal / Entrada</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full bg-indigo-400 border-2 border-indigo-600"></div>
                      <span>Widget / Routing</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full bg-amber-400 border-2 border-amber-600"></div>
                      <span>System Prompt</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full bg-emerald-400 border-2 border-emerald-600"></div>
                      <span>Knowledge Base</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full bg-purple-400 border-2 border-purple-600"></div>
                      <span>LLM (Motor)</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full bg-orange-400 border-2 border-orange-600"></div>
                      <span>Tools / Salida</span>
                    </div>
                  </div>
                </div>
              </Panel>

              {/* Validation Panel */}
              {validationIssues.length > 0 && (
                <Panel position="bottom-left" className={`${isDarkMode ? 'bg-gray-800 border-gray-600' : 'bg-white border-gray-200'} rounded-lg shadow-lg p-4 border-2 m-4 max-w-md`}>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 mb-2">
                      <AlertCircle size={16} className="text-amber-600" />
                      <h3 className={`font-bold text-sm ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                        Validación ({validationIssues.length})
                      </h3>
                    </div>
                    <div className="space-y-1.5 text-xs max-h-32 overflow-y-auto">
                      {validationIssues.map((issue, index) => (
                        <div 
                          key={index} 
                          className={`p-2 rounded ${
                            issue.startsWith('⚠️') 
                              ? isDarkMode ? 'bg-red-900/30 text-red-200' : 'bg-red-50 text-red-800'
                              : isDarkMode ? 'bg-blue-900/30 text-blue-200' : 'bg-blue-50 text-blue-800'
                          }`}
                        >
                          {issue}
                        </div>
                      ))}
                    </div>
                  </div>
                </Panel>
              )}

              {/* Agent Info Panel */}
              <Panel position="top-right" className={`${isDarkMode ? 'bg-gray-800 border-gray-600' : 'bg-white border-gray-200'} rounded-lg shadow-lg p-4 border-2 m-4`}>
                <div className="space-y-2">
                  <div className="flex items-center gap-2 mb-2">
                    <Bot size={16} className="text-purple-600" />
                    <h3 className={`font-bold text-sm ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Info del Agente</h3>
                  </div>
                  <div className="text-xs space-y-1">
                    <div className="flex justify-between gap-4">
                      <span className={isDarkMode ? 'text-gray-300' : 'text-gray-600'}>Estado:</span>
                      <span className={`font-semibold ${agent?.active ? 'text-green-600' : 'text-red-600'}`}>
                        {agent?.active ? '✅ Activo' : '❌ Inactivo'}
                      </span>
                    </div>
                    <div className="flex justify-between gap-4">
                      <span className={isDarkMode ? 'text-gray-300' : 'text-gray-600'}>Prioridad:</span>
                      <span className={`font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{agent?.priority}</span>
                    </div>
                    <div className="flex justify-between gap-4">
                      <span className={isDarkMode ? 'text-gray-300' : 'text-gray-600'}>Tools:</span>
                      <span className={`font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{agent?.enabled_tools?.length || 0}</span>
                    </div>
                    <div className="flex justify-between gap-4">
                      <span className={isDarkMode ? 'text-gray-300' : 'text-gray-600'}>KBs:</span>
                      <span className={`font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{nodes.filter(n => n.id.startsWith('kb-')).length}</span>
                    </div>
                    <div className="flex justify-between gap-4">
                      <span className={isDarkMode ? 'text-gray-300' : 'text-gray-600'}>Nodos:</span>
                      <span className={`font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{nodes.length}</span>
                    </div>
                    <div className="flex justify-between gap-4">
                      <span className={isDarkMode ? 'text-gray-300' : 'text-gray-600'}>Conexiones:</span>
                      <span className={`font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{edges.length}</span>
                    </div>
                  </div>
                </div>
              </Panel>
            </ReactFlow>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}

