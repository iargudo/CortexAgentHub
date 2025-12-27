import { useState, useCallback, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Node,
  Edge,
  useNodesState,
  useEdgesState,
  addEdge,
  Connection,
  MarkerType,
  ReactFlowInstance,
} from 'reactflow';
import { api } from '@/services/api';
import { Agent, Tool, LLM, Channel } from '@/types/agent';

interface UseAgentCanvasProps {
  agent: Agent | null;
  tools?: Tool[];
  llms?: LLM[];
  channels?: Channel[];
}

export function useAgentCanvas({ agent, tools, llms, channels }: UseAgentCanvasProps) {
  const queryClient = useQueryClient();
  
  // React Flow state
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [reactFlowInstance, setReactFlowInstance] = useState<ReactFlowInstance | null>(null);

  // Advanced features state
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [validationIssues, setValidationIssues] = useState<string[]>([]);

  // Load agent into canvas
  const loadAgentIntoCanvas = useCallback(async (agentToLoad: Agent) => {
    // Load saved flow configuration or create default layout
    if (agentToLoad.flow_config?.nodes && agentToLoad.flow_config?.edges) {
      // Ensure all loaded nodes use default type and preserve styles
      // Also update tool node labels to reflect current tool status
      const loadedNodes = agentToLoad.flow_config.nodes.map((node: Node) => {
        const updatedNode = {
          ...node,
          type: node.type || 'default', // Use default type for custom node component
          data: {
            ...node.data,
            style: node.data?.style || node.style || {},
          },
        };
        
        // If this is a tool node, update its label with current tool status
        if (node.id?.startsWith('tool-')) {
          const toolIndex = parseInt(node.id.replace('tool-', ''));
          const toolName = agentToLoad.enabled_tools?.[toolIndex];
          if (toolName) {
            const tool = tools?.find((t: any) => t.name === toolName);
            if (tool) {
              // Check enabled first (backend field), then fallback to active
              const isActive = tool.enabled === true || 
                             (tool.enabled === undefined && tool.active === true);
              // Update the label to reflect current status
              const currentLabel = updatedNode.data.label || '';
              // Replace the status line (last line) with current status
              const labelLines = currentLabel.split('\n');
              if (labelLines.length > 0) {
                // Replace the last line (status line)
                labelLines[labelLines.length - 1] = isActive ? '✅ Activo' : '❌ Inactivo';
                updatedNode.data.label = labelLines.join('\n');
              }
            }
          }
        }
        
        return updatedNode;
      });
      setNodes(loadedNodes);
      // Ensure all loaded edges have animation
      const loadedEdges = agentToLoad.flow_config.edges.map((edge: Edge) => ({
        ...edge,
        animated: true,
      }));
      setEdges(loadedEdges);
    } else {
      // Create default layout with better organization
      // Get all channels for this agent
      const agentChannelIds = agentToLoad.channels?.map(c => c.id) || [];
      const agentChannels = channels?.filter((c: any) => agentChannelIds.includes(c.id)) || [];
      const llm = llms?.find((l: any) => l.id === agentToLoad.llm_id);

      // Fetch knowledge bases for this agent
      let kbs: any[] = [];
      try {
        const response = await api.getFlowKnowledgeBases(agentToLoad.id);
        kbs = response || [];
      } catch (error) {
        console.error('Error loading knowledge bases:', error);
      }

      // Fetch widgets if any webchat channel exists
      let widgets: any[] = [];
      const hasWebchat = agentChannels.some((c: any) => c.channel_type === 'webchat');
      if (hasWebchat) {
        try {
          const response = await api.getWidgets();
          widgets = (response || []).filter((w: any) => agentChannelIds.includes(w.channel_id));
        } catch (error) {
          console.error('Error loading widgets:', error);
        }
      }

      // Layout por capas: Input (0-200) → Left Side (200-400) → Process (400-600) → Right Side (600-800) → Output (800+)
      const LAYER = {
        INPUT: 100,
        LEFT: 300,      // Routing a la izquierda del LLM
        PROCESS: 500,   // LLM en el centro
        RIGHT: 650,     // Knowledge bases a la derecha del LLM
        OUTPUT: 800,
      };

      const initialNodes: Node[] = [];

      // ========== INPUT LAYER ==========
      
      // Widget Nodes (if webchat) - Left side of input layer
      const widgetNodes: Node[] = widgets.map((widget: any, index: number) => ({
        id: `widget-${index}`,
        type: 'default',
        data: { 
          label: `🌐 Widget\n${widget.name || widget.widget_key}\n─────────\nKey: ${widget.widget_key}\n${widget.active ? '✅ Activo' : '❌ Inactivo'}`,
          style: {
            background: 'linear-gradient(135deg, #E0E7FF 0%, #C7D2FE 100%)', 
            border: '3px solid #6366F1', 
            borderRadius: '12px', 
            padding: '14px', 
            fontSize: '11px', 
            maxWidth: '180px', 
            whiteSpace: 'pre-line',
            boxShadow: '0 4px 6px rgba(99, 102, 241, 0.2)',
          },
        },
        position: { x: 50, y: 100 + index * 140 },
      }));

      // Channel Nodes - Create one node for each channel
      agentChannels.forEach((channel: any, index: number) => {
        initialNodes.push({
          id: `channel-${channel.id}`,
          type: 'default',
          data: { 
            label: `📱 CANAL ${index + 1}\n${channel.name || 'Sin nombre'}\n─────────\nTipo: ${channel.channel_type?.toUpperCase() || 'N/A'}\nID: ${channel.id}\n${channel.is_active ? '✅ Activo' : '❌ Inactivo'}`,
            style: {
              background: 'linear-gradient(135deg, #DBEAFE 0%, #BFDBFE 100%)', 
              border: '3px solid #0EA5E9', 
              borderRadius: '12px', 
              padding: '16px', 
              minWidth: '200px', 
              fontSize: '13px', 
              fontWeight: '600',
              whiteSpace: 'pre-line',
              boxShadow: '0 8px 16px rgba(14, 165, 233, 0.3)',
            },
          },
          position: { x: LAYER.INPUT, y: 200 + (index * 150) },
        });
      });
        
      // Routing Conditions Node (if exists) - A la izquierda del LLM
      if (agentToLoad.routing_conditions?.messagePattern || agentToLoad.routing_conditions?.description) {
        initialNodes.push({
          id: 'routing',
          type: 'default',
          data: { 
            label: `🎯 ROUTING\n${agentToLoad.routing_conditions.description || 'Condiciones de enrutamiento'}\n─────────\nPattern: ${agentToLoad.routing_conditions.messagePattern?.substring(0, 30) || 'N/A'}...\nPrioridad: ${agentToLoad.priority}`,
            style: {
              background: 'linear-gradient(135deg, #DBEAFE 0%, #BFDBFE 100%)', 
              border: '3px solid #3B82F6', 
              borderRadius: '12px', 
              padding: '14px', 
              fontSize: '11px', 
              maxWidth: '200px', 
              whiteSpace: 'pre-line',
              boxShadow: '0 4px 6px rgba(59, 130, 246, 0.3)',
            },
          },
          position: { x: LAYER.LEFT, y: 280 }, // Misma altura que el LLM
        });
      }

      // ========== CONTEXT LAYER ==========

      // System Prompt Node (if exists) - Arriba del LLM
      if (agentToLoad.flow_config?.systemPrompt) {
        const promptLength = agentToLoad.flow_config.systemPrompt.length;
        const promptPreview = agentToLoad.flow_config.systemPrompt.substring(0, 100);
        initialNodes.push({
          id: 'system-prompt',
          type: 'default',
          data: { 
            label: `📝 SYSTEM PROMPT\n─────────\n${promptPreview}...\n─────────\nLongitud: ${promptLength} chars\nTemperature: ${agentToLoad.flow_config?.temperature || 0.7}`,
            style: {
              background: 'linear-gradient(135deg, #FEF3C7 0%, #FDE68A 100%)', 
              border: '3px solid #F59E0B', 
              borderRadius: '12px', 
              padding: '14px', 
              fontSize: '11px', 
              maxWidth: '250px', 
              whiteSpace: 'pre-wrap',
              boxShadow: '0 4px 6px rgba(245, 158, 11, 0.3)',
            },
          },
          position: { x: LAYER.PROCESS, y: 50 }, // Arriba del LLM, mismo X
        });
      }

      // Knowledge Base Nodes - A la derecha del LLM, organizadas verticalmente
      const kbNodes: Node[] = kbs.map((kb: any, index: number) => {
        const threshold = parseFloat(kb.similarity_threshold || 0.7);
        const totalKBs = kbs.length;
        const centerY = 280; // Misma altura central que el LLM
        const startY = centerY - ((totalKBs - 1) * 80); // Centrar verticalmente alrededor del LLM
        
        return {
          id: `kb-${index}`,
          type: 'default',
          data: { 
            label: `📚 KNOWLEDGE BASE\n${kb.kb_name || 'Sin nombre'}\n─────────\n🎯 Threshold: ${threshold.toFixed(2)}\n📊 Max Results: ${kb.max_results || 5}\n⭐ Priority: ${kb.priority || 0}`,
            style: {
              background: 'linear-gradient(135deg, #D1FAE5 0%, #A7F3D0 100%)', 
              border: '3px solid #10B981', 
              borderRadius: '12px', 
              padding: '14px', 
              fontSize: '11px', 
              maxWidth: '220px', 
              whiteSpace: 'pre-line',
              boxShadow: '0 4px 6px rgba(16, 185, 129, 0.3)',
            },
          },
          position: { x: LAYER.RIGHT, y: startY + index * 160 },
        };
      });

      // ========== PROCESSING LAYER ==========
      
      // LLM Node (center) - Main processing unit
      initialNodes.push({
        id: 'llm',
        type: 'default',
        data: { 
          label: `🧠 LLM ENGINE\n${llm?.provider?.toUpperCase() || 'PROVIDER'}\n─────────\nModel: ${llm?.model || 'model'}\n🌡️ Temp: ${agentToLoad.flow_config?.temperature || 0.7}\n📝 Max Tokens: ${agentToLoad.flow_config?.maxTokens || 2000}\n${llm?.active ? '✅ Activo' : '❌ Inactivo'}`,
          style: {
            background: 'linear-gradient(135deg, #F3E8FF 0%, #E9D5FF 100%)', 
            border: '4px solid #A855F7', 
            borderRadius: '16px', 
            padding: '20px', 
            minWidth: '220px', 
            fontSize: '13px', 
            fontWeight: '600',
            whiteSpace: 'pre-line',
            boxShadow: '0 10px 20px rgba(168, 85, 247, 0.4)',
          },
        },
        position: { x: LAYER.PROCESS, y: 280 },
      });

      // ========== OUTPUT LAYER ==========
      
      // Tool Nodes - Organized vertically
      const toolNodes: Node[] = (agentToLoad.enabled_tools || []).map((toolName: string, index: number) => {
        const tool = tools?.find((t: any) => t.name === toolName);
        const totalTools = agentToLoad.enabled_tools?.length || 0;
        const startY = Math.max(100, 350 - (totalTools * 60));
        // Backend returns 'enabled' field (boolean), check both 'enabled' and 'active' for compatibility
        // Handle cases where enabled might be undefined, null, or false
        // Debug: log tool info to help diagnose
        if (!tool) {
          console.warn(`[AgentCanvas] Tool not found: "${toolName}". Available tools:`, tools?.map((t: any) => t.name));
        } else {
          console.log(`[AgentCanvas] Tool "${toolName}":`, { 
            enabled: tool.enabled, 
            enabledType: typeof tool.enabled,
            active: tool.active,
            activeType: typeof tool.active,
            allFields: Object.keys(tool) 
          });
        }
        // Check enabled first (backend field), then fallback to active, default to false if tool not found
        const isActive = tool 
          ? (tool.enabled === true || (tool.enabled === undefined && tool.active === true))
          : false;
        
        return {
          id: `tool-${index}`,
          type: 'default',
          data: { 
            label: `🔧 TOOL\n${toolName}\n─────────\n${tool?.description ? tool.description.substring(0, 60) + '...' : 'Sin descripción'}\n${isActive ? '✅ Activo' : '❌ Inactivo'}`,
            style: {
              background: 'linear-gradient(135deg, #FFEDD5 0%, #FED7AA 100%)', 
              border: '3px solid #F97316', 
              borderRadius: '12px', 
              padding: '14px', 
              fontSize: '11px', 
              maxWidth: '220px', 
              whiteSpace: 'pre-line',
              boxShadow: '0 4px 6px rgba(249, 115, 22, 0.3)',
            },
          },
          position: { x: LAYER.OUTPUT, y: startY + index * 140 },
        };
      });

      // All nodes
      const allNodes = [...initialNodes, ...kbNodes, ...toolNodes, ...widgetNodes];

      // Create edges with better styling
      const initialEdges: Edge[] = [];

      // Widgets to Channels
      widgets.forEach((widget: any, index: number) => {
        const targetChannelId = agentChannels.find((c: any) => c.id === widget.channel_id)?.id;
        if (targetChannelId) {
          initialEdges.push({
            id: `widget-channel-${index}`,
            source: `widget-${index}`,
            target: `channel-${targetChannelId}`,
            type: 'smoothstep',
            animated: true,
            style: { stroke: '#6366F1', strokeWidth: 2.5 },
            label: 'Web Interface',
            labelStyle: { fontSize: 10, fill: '#6366F1', fontWeight: 600 },
            markerEnd: { type: MarkerType.ArrowClosed, color: '#6366F1' },
          });
        }
      });

      // Channels to Routing or LLM
      agentChannels.forEach((channel: any, index: number) => {
        const targetId = agentToLoad.routing_conditions?.messagePattern || agentToLoad.routing_conditions?.description ? 'routing' : 'llm';
        initialEdges.push({
          id: `channel-next-${index}`,
          source: `channel-${channel.id}`,
          target: targetId,
          type: 'smoothstep',
          animated: true,
          style: { stroke: '#0EA5E9', strokeWidth: 3 },
          label: 'User Message',
          labelStyle: { fontSize: 11, fill: '#0EA5E9', fontWeight: 700 },
          markerEnd: { type: MarkerType.ArrowClosed, color: '#0EA5E9' },
        });
      });
        
      // Routing to LLM (if routing exists)
      if (agentToLoad.routing_conditions?.messagePattern || agentToLoad.routing_conditions?.description) {
        initialEdges.push({
          id: 'routing-llm',
          source: 'routing',
          target: 'llm',
          type: 'smoothstep',
          animated: true,
          style: { stroke: '#3B82F6', strokeWidth: 3 },
          label: 'Routed',
          labelStyle: { fontSize: 11, fill: '#3B82F6', fontWeight: 700 },
          markerEnd: { type: MarkerType.ArrowClosed, color: '#3B82F6' },
        });
      }

      // System Prompt to LLM
      if (agentToLoad.flow_config?.systemPrompt) {
        initialEdges.push({
          id: 'prompt-llm',
          source: 'system-prompt',
          target: 'llm',
          type: 'smoothstep',
          animated: true,
          style: { stroke: '#F59E0B', strokeWidth: 2.5, strokeDasharray: '8,4' },
          label: 'Instructions',
          labelStyle: { fontSize: 10, fill: '#F59E0B', fontWeight: 600 },
          markerEnd: { type: MarkerType.ArrowClosed, color: '#F59E0B' },
        });
      }

      // Knowledge Bases to LLM
      kbs.forEach((kb: any, index: number) => {
        initialEdges.push({
          id: `kb-llm-${index}`,
          source: `kb-${index}`,
          target: 'llm',
          type: 'smoothstep',
          animated: true,
          style: { stroke: '#10B981', strokeWidth: 2.5 },
          label: `RAG (${kb.max_results || 5})`,
          labelStyle: { fontSize: 10, fill: '#10B981', fontWeight: 600 },
          markerEnd: { type: MarkerType.ArrowClosed, color: '#10B981' },
        });
      });

      // LLM to Tools
      (agentToLoad.enabled_tools || []).forEach((_toolName: string, index: number) => {
        initialEdges.push({
          id: `llm-tool-${index}`,
          source: 'llm',
          target: `tool-${index}`,
          type: 'smoothstep',
          animated: true,
          style: { stroke: '#A855F7', strokeWidth: 2.5 },
          label: 'Function Call',
          labelStyle: { fontSize: 10, fill: '#A855F7', fontWeight: 600 },
          markerEnd: { type: MarkerType.ArrowClosed, color: '#A855F7' },
        });
      });

      setNodes(allNodes);
      setEdges(initialEdges);
    }
  }, [channels, llms, tools, setNodes, setEdges]);

  // Save canvas layout
  const saveCanvas = useCallback(async () => {
    if (!agent) return;
    
    try {
      const updatedFlowConfig = {
        ...agent.flow_config,
        nodes: nodes,
        edges: edges,
      };

      await api.updateFlow(agent.id, {
        flow_config: updatedFlowConfig,
      });

      queryClient.invalidateQueries({ queryKey: ['agents'] });
      queryClient.invalidateQueries({ queryKey: ['flows'] });
      
      alert('Layout guardado exitosamente');
      return true;
    } catch (error: any) {
      console.error('Error saving canvas layout:', error);
      alert('Error al guardar el layout: ' + error.message);
      return false;
    }
  }, [agent, nodes, edges, queryClient]);

  // Export as image
  const exportAsImage = useCallback(async () => {
    if (!agent) return;
    
    try {
      const { getRectOfNodes, getTransformForBounds } = await import('reactflow');
      const { toPng } = await import('html-to-image');
      
      const viewport = document.querySelector('.react-flow__viewport') as HTMLElement;
      if (!viewport) {
        alert('No se pudo acceder al canvas');
        return;
      }

      const nodesBounds = getRectOfNodes(nodes);
      const imageWidth = 2400;
      const imageHeight = 1600;
      const transform = getTransformForBounds(nodesBounds, imageWidth, imageHeight, 0.5, 2, 0.1);

      const dataUrl = await toPng(viewport, {
        backgroundColor: '#ffffff',
        width: imageWidth,
        height: imageHeight,
        style: {
          width: `${imageWidth}px`,
          height: `${imageHeight}px`,
          transform: `translate(${transform[0]}px, ${transform[1]}px) scale(${transform[2]})`,
        },
      });

      const link = document.createElement('a');
      link.download = `${agent.name.replace(/\s+/g, '_')}_flow_diagram.png`;
      link.href = dataUrl;
      link.click();
    } catch (error) {
      console.error('Error exporting image:', error);
      alert('Error al exportar imagen. Intenta de nuevo.');
    }
  }, [agent, nodes]);

  // Handle connections
  const onConnect = useCallback(
    (params: Connection) => {
      if (!params.source || !params.target) return;
      
      const edgeId = `${params.source}-${params.sourceHandle || 'default'}-${params.target}-${params.targetHandle || 'default'}`;
      
      setEdges((eds) => {
        const filteredEdges = eds.filter(
          (edge) => !(edge.source === params.source && edge.target === params.target)
        );
        
        return addEdge(
          {
            ...params,
            id: edgeId,
            animated: true, // All new connections are animated
            type: 'smoothstep',
          },
          filteredEdges
        );
      });
    },
    [setEdges]
  );

  // Fit view
  const handleFitView = useCallback(() => {
    if (reactFlowInstance) {
      reactFlowInstance.fitView({ padding: 0.2, duration: 800 });
    }
  }, [reactFlowInstance]);

  // Auto-layout
  const autoLayout = useCallback(() => {
    if (!agent) return;
    loadAgentIntoCanvas(agent);
  }, [agent, loadAgentIntoCanvas]);

  // Validate configuration
  const validateConfiguration = useCallback(() => {
    const issues: string[] = [];

    if (!agent) return issues;

    const llm = llms?.find((l: any) => l.id === agent.llm_id);
    if (!llm?.active) {
      issues.push('⚠️ El LLM seleccionado está inactivo');
    }

    const agentChannelIds = agent.channels?.map(c => c.id) || [];
    const agentChannels = channels?.filter((c: any) => agentChannelIds.includes(c.id)) || [];
    const inactiveChannels = agentChannels.filter((c: any) => !c.is_active);
    if (inactiveChannels.length > 0) {
      issues.push(`⚠️ ${inactiveChannels.length} canal(es) inactivo(s)`);
    }
    if (agentChannels.length === 0) {
      issues.push('⚠️ No hay canales asignados');
    }

    agent.enabled_tools?.forEach((toolName: string) => {
      const tool = tools?.find((t: any) => t.name === toolName);
      if (!tool) {
        issues.push(`⚠️ La herramienta "${toolName}" no se encuentra en el sistema`);
      } else {
        // Backend returns 'enabled', frontend type expects 'active' - check both for compatibility
        const isActive = tool?.enabled !== undefined ? tool.enabled : (tool?.active ?? false);
        if (!isActive) {
          issues.push(`⚠️ La herramienta "${toolName}" está inactiva`);
        }
      }
    });

    if (!agent.flow_config?.systemPrompt || agent.flow_config.systemPrompt.length < 50) {
      issues.push('💡 Se recomienda agregar un system prompt más detallado');
    }

    if (!agent.routing_conditions?.messagePattern && !agent.routing_conditions?.description) {
      issues.push('💡 Se recomienda agregar condiciones de routing para mejor control');
    }

    setValidationIssues(issues);
    return issues;
  }, [agent, llms, channels, tools]);

  // Highlight searched nodes
  useEffect(() => {
    if (searchTerm) {
      setNodes((nds) =>
        nds.map((node) => ({
          ...node,
          style: {
            ...node.style,
            opacity: node.data.label.toLowerCase().includes(searchTerm.toLowerCase())
              ? 1
              : 0.3,
          },
        }))
      );
    } else {
      setNodes((nds) =>
        nds.map((node) => ({
          ...node,
          style: {
            ...node.style,
            opacity: 1,
          },
        }))
      );
    }
  }, [searchTerm, setNodes]);

  // Validate on agent change
  useEffect(() => {
    if (agent) {
      validateConfiguration();
    }
  }, [agent, validateConfiguration]);

  return {
    // State
    nodes,
    edges,
    reactFlowInstance,
    isDarkMode,
    searchTerm,
    validationIssues,
    
    // Setters
    setReactFlowInstance,
    setIsDarkMode,
    setSearchTerm,
    
    // Handlers
    onNodesChange,
    onEdgesChange,
    onConnect,
    handleFitView,
    autoLayout,
    validateConfiguration,
    saveCanvas,
    exportAsImage,
    loadAgentIntoCanvas,
  };
}

