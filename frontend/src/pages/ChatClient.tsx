import { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

/**
 * Generate a persistent user ID based on browser fingerprinting
 * This ID will remain consistent across sessions on the same device
 */
function generatePersistentUserId(agentId: string): string {
  const storageKey = `cortex_chat_user_${agentId}`;
  
  // Try to get existing ID from localStorage
  let userId = localStorage.getItem(storageKey);
  
  if (userId) {
    return userId;
  }
  
  // Generate fingerprint based on browser characteristics
  const fingerprint = [
    navigator.userAgent,
    navigator.language,
    navigator.platform,
    screen.width + 'x' + screen.height,
    screen.colorDepth,
    new Date().getTimezoneOffset(),
    navigator.hardwareConcurrency || 0,
    (navigator as any).deviceMemory || 0, // deviceMemory is not in all browsers
  ].join('|');
  
  // Create a hash from the fingerprint
  let hash = 0;
  for (let i = 0; i < fingerprint.length; i++) {
    const char = fingerprint.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  
  // Generate unique ID with timestamp for additional uniqueness
  userId = `user_${Math.abs(hash)}_${Date.now()}`;
  
  // Store in localStorage for persistence
  localStorage.setItem(storageKey, userId);
  
  return userId;
}

export function ChatClient() {
  const { agentId } = useParams<{ agentId: string }>();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [agentName, setAgentName] = useState('Agente');
  const [error, setError] = useState<string | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);
  const [greetingReceived, setGreetingReceived] = useState(false);
  const greetingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  const wsRef = useRef<WebSocket | null>(null);
  const userIdRef = useRef<string>('');
  const instanceIdRef = useRef<string>('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const reconnectAttemptsRef = useRef(0);
  const maxReconnectAttempts = 5;
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Get API base URL
  const apiBaseUrl = import.meta.env.VITE_API_URL || 
    (window.location.origin.includes('localhost') 
      ? 'http://localhost:3000' 
      : window.location.origin);

  // Initialize user ID and load configuration
  useEffect(() => {
    if (!agentId) {
      setError('Se requiere agentId en la URL');
      setIsInitializing(false);
      return;
    }

    const initialize = async () => {
      try {
        setIsInitializing(true);
        
        // Generate persistent user ID
        userIdRef.current = generatePersistentUserId(agentId);
        
        // Fetch agent info to get the webchat channel_id
        const agentResponse = await fetch(`${apiBaseUrl}/api/agents/${agentId}/public`);
        if (!agentResponse.ok) {
          throw new Error('Agente no encontrado o no tiene canal webchat configurado');
        }
        const agentResult = await agentResponse.json();
        console.log('Agent info received:', {
          name: agentResult.data.name,
          channel_id: agentResult.data.channel_id,
          flow_id: agentResult.data.flow_id,
          id: agentResult.data.id,
          greeting_message: agentResult.data.greeting_message,
        });
        setAgentName(agentResult.data.name || 'Agente');
        const channelId = agentResult.data.channel_id;
        const flowId = agentResult.data.flow_id || agentResult.data.id; // Use flow_id or fallback to id
        
        if (!channelId) {
          throw new Error('Canal webchat no encontrado para este agente');
        }
        
        console.log('Connecting WebSocket with:', { channelId, flowId });
        instanceIdRef.current = channelId;
        
        // Connect WebSocket with flowId
        await connectWebSocket(channelId, flowId);
        
        setIsInitializing(false);
      } catch (err: any) {
        setError(err.message || 'Error al inicializar el chat');
        setIsInitializing(false);
        console.error('Initialization error:', err);
      }
    };

    initialize();

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (greetingTimeoutRef.current) {
        clearTimeout(greetingTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [agentId]);

  const connectWebSocket = async (instanceId: string, flowId?: string) => {
    try {
      // Get auth token
      console.log('Requesting auth token with:', { userId: userIdRef.current, websiteId: instanceId, flowId });
      const authResponse = await fetch(`${apiBaseUrl}/api/v1/webchat/auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: userIdRef.current,
          websiteId: instanceId,
          flowId: flowId, // Include flowId for direct greeting lookup
        }),
      });
      
      console.log('Auth response status:', authResponse.status);

      if (!authResponse.ok) {
        const errorData = await authResponse.json().catch(() => ({}));
        throw new Error(errorData.message || 'Error de autenticación');
      }

      const authData = await authResponse.json();
      if (!authData.token) {
        throw new Error('No se recibió token de autenticación');
      }

      // Connect WebSocket
      const apiUrlObj = new URL(apiBaseUrl);
      const wsProtocol = apiUrlObj.protocol === 'https:' ? 'wss:' : 'ws:';
      const port = apiUrlObj.port && apiUrlObj.port !== '80' && apiUrlObj.port !== '443' 
        ? `:${apiUrlObj.port}` 
        : '';
      const wsUrl = `${wsProtocol}//${apiUrlObj.hostname}${port}/api/v1/webchat/ws`;

      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('WebSocket connected');
        reconnectAttemptsRef.current = 0;
        setError(null);
        
        // Send auth token
        setTimeout(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
              type: 'auth',
              token: authData.token,
            }));
          }
        }, 50);
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          
          if (message.type === 'connected') {
            console.log('WebSocket connection confirmed');
          } else if (message.type === 'auth_success') {
            setIsConnected(true);
            setError(null);
            console.log('WebSocket authenticated successfully', {
              userId: message.userId,
              websiteId: message.websiteId,
            });
            // Reset greeting received flag when reconnecting
            setGreetingReceived(false);
            
            // Set timeout to check if greeting arrives (5 seconds)
            if (greetingTimeoutRef.current) {
              clearTimeout(greetingTimeoutRef.current);
            }
            greetingTimeoutRef.current = setTimeout(() => {
              if (messages.length === 0 && !greetingReceived) {
                console.warn('Greeting message timeout - no greeting received after 5 seconds');
              }
            }, 5000);
          } else if (message.type === 'message') {
            console.log('Message received from server:', {
              content: message.content?.substring(0, 50),
              timestamp: message.timestamp,
              isFirstMessage: messages.length === 0,
            });
            setMessages(prev => {
              // Check if this is the first message (greeting)
              if (prev.length === 0) {
                setGreetingReceived(true);
                console.log('✅ Greeting message received:', message.content);
                // Clear timeout since greeting arrived
                if (greetingTimeoutRef.current) {
                  clearTimeout(greetingTimeoutRef.current);
                  greetingTimeoutRef.current = null;
                }
              }
              return [...prev, {
                role: 'assistant',
                content: message.content,
                timestamp: message.timestamp || new Date().toISOString(),
              }];
            });
            setIsLoading(false);
          } else if (message.type === 'error') {
            setError(message.error || 'Error en el servidor');
            setIsLoading(false);
          }
        } catch (err) {
          console.error('Error parsing message:', err);
        }
      };

      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        setError('Error de conexión. Intentando reconectar...');
        setIsConnected(false);
      };

      ws.onclose = (event) => {
        setIsConnected(false);
        
        // Only attempt reconnect if it wasn't a clean close and we haven't exceeded max attempts
        if (event.code !== 1000 && reconnectAttemptsRef.current < maxReconnectAttempts) {
          reconnectAttemptsRef.current++;
          const delay = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current), 10000); // Exponential backoff, max 10s
          console.log(`Reconnecting in ${delay}ms (attempt ${reconnectAttemptsRef.current}/${maxReconnectAttempts})...`);
          
          reconnectTimeoutRef.current = setTimeout(() => {
            if (instanceIdRef.current) {
              connectWebSocket(instanceIdRef.current);
            }
          }, delay);
        } else if (reconnectAttemptsRef.current >= maxReconnectAttempts) {
          setError('No se pudo conectar después de varios intentos. Por favor recarga la página.');
        }
      };
    } catch (err: any) {
      setError(err.message || 'Error al conectar');
      setIsConnected(false);
      console.error('Connection error:', err);
      
      // Retry connection after delay
      if (reconnectAttemptsRef.current < maxReconnectAttempts) {
        reconnectAttemptsRef.current++;
        const delay = 2000 * reconnectAttemptsRef.current;
        reconnectTimeoutRef.current = setTimeout(() => {
          if (instanceIdRef.current) {
            connectWebSocket(instanceIdRef.current);
          }
        }, delay);
      }
    }
  };

  const sendMessage = () => {
    if (!input.trim() || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN || isLoading) {
      return;
    }

    const messageContent = input.trim();
    setInput('');
    
    // Add user message
    setMessages(prev => [...prev, {
      role: 'user',
      content: messageContent,
      timestamp: new Date().toISOString(),
    }]);

    setIsLoading(true);

    // Send via WebSocket
    try {
      wsRef.current.send(JSON.stringify({
        type: 'message',
        content: messageContent,
        messageId: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        timestamp: new Date().toISOString(),
      }));
    } catch (err) {
      console.error('Error sending message:', err);
      setError('Error al enviar mensaje. Intentando reconectar...');
      setIsLoading(false);
      // Remove the user message if send failed
      setMessages(prev => prev.slice(0, -1));
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Focus input after AI responds
  useEffect(() => {
    // Check if the last message is from assistant and we're not loading anymore
    if (messages.length > 0 && !isLoading) {
      const lastMessage = messages[messages.length - 1];
      if (lastMessage.role === 'assistant') {
        // Small delay to ensure the message is rendered
        setTimeout(() => {
          inputRef.current?.focus();
        }, 100);
      }
    }
  }, [messages, isLoading]);

  if (isInitializing) {
    return (
      <div className="flex items-center justify-center h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-4 border-blue-200 border-t-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600 font-medium">Inicializando chat...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col sm:items-center sm:justify-center h-[100dvh] sm:min-h-screen bg-[#ECE5DD] p-0 sm:p-4 md:p-6">
      {/* Chat Container - Full screen on mobile, centered on desktop */}
      <div className="flex flex-col h-full sm:h-[calc(100vh-2rem)] md:h-[calc(100vh-3rem)] w-full sm:max-w-4xl bg-white sm:rounded-xl md:rounded-2xl sm:shadow-xl sm:border sm:border-gray-200 overflow-hidden relative">
        {/* Header - WhatsApp green */}
        <div className="bg-[#075E54] text-white px-4 sm:px-6 py-3 sm:py-4 shadow-md flex-shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 sm:gap-4">
              <div className="w-10 h-10 sm:w-12 sm:h-12 bg-white/20 rounded-full flex items-center justify-center flex-shrink-0">
                <svg className="w-5 h-5 sm:w-6 sm:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
              </div>
              <div>
                <h1 className="text-base sm:text-lg md:text-xl font-medium" style={{ fontFamily: "'Segoe UI', 'Helvetica Neue', Helvetica, 'Lucida Grande', Arial, Ubuntu, Cantarell, 'Fira Sans', sans-serif" }}>{agentName}</h1>
                <div className="flex items-center gap-2 mt-0.5">
                  <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-[#25D366]' : 'bg-gray-400'}`}></div>
                  <p className="text-xs sm:text-sm text-white/70" style={{ fontFamily: "'Segoe UI', 'Helvetica Neue', Helvetica, 'Lucida Grande', Arial, Ubuntu, Cantarell, 'Fira Sans', sans-serif" }}>
                    {isConnected ? 'En línea' : 'Conectando...'}
                  </p>
                </div>
              </div>
            </div>
            {error && (
              <div className="hidden sm:block text-xs sm:text-sm text-red-100 bg-red-500/30 backdrop-blur-sm px-3 py-2 rounded-lg border border-red-300/50 max-w-xs">
                {error}
              </div>
            )}
          </div>
          {error && (
            <div className="mt-3 sm:hidden text-xs text-red-100 bg-red-500/30 backdrop-blur-sm px-3 py-2 rounded-lg border border-red-300/50">
              {error}
            </div>
          )}
        </div>

        {/* Messages Area - WhatsApp beige background */}
        <div 
          className="flex-1 overflow-y-auto px-2 sm:px-4 md:px-6 py-4 sm:py-6 min-h-0" 
          style={{ 
            paddingBottom: 'calc(5rem + env(safe-area-inset-bottom, 0px))',
            background: '#ECE5DD',
            backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23000000' fill-opacity='0.02'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`
          }}
        >
          <div className="space-y-0.5">
            {messages.length === 0 && (
              <div className="text-center text-gray-600 py-8 sm:py-12">
                <div className="text-5xl sm:text-6xl mb-4">👋</div>
                {!isConnected ? (
                  <p className="text-sm sm:text-base text-gray-500" style={{ fontFamily: "'Segoe UI', 'Helvetica Neue', Helvetica, 'Lucida Grande', Arial, Ubuntu, Cantarell, 'Fira Sans', sans-serif" }}>
                    Conectando...
                  </p>
                ) : !greetingReceived ? (
                  <p className="text-sm sm:text-base text-gray-500" style={{ fontFamily: "'Segoe UI', 'Helvetica Neue', Helvetica, 'Lucida Grande', Arial, Ubuntu, Cantarell, 'Fira Sans', sans-serif" }}>
                    Esperando mensaje de bienvenida...
                  </p>
                ) : null}
              </div>
            )}
            
            {messages.map((msg, idx) => {
              const timestamp = new Date(msg.timestamp).toLocaleTimeString('es-ES', { 
                hour: '2-digit', 
                minute: '2-digit' 
              });
              
              return (
                <div
                  key={idx}
                  className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} px-1 animate-fade-in`}
                >
                  <div
                    className={`max-w-[65%] sm:max-w-[75%] md:max-w-[65%] lg:max-w-[60%] min-w-[60px] px-2 py-1.5 ${
                      msg.role === 'user'
                        ? 'bg-[#DCF8C6] text-[#111111] rounded-[7.5px] rounded-br-[4px]'
                        : 'bg-white text-[#111111] rounded-[7.5px] rounded-bl-[4px]'
                    }`}
                    style={{
                      boxShadow: '0 1px 0.5px rgba(0,0,0,0.13), 0 1px 1px rgba(0,0,0,0.2)',
                      fontFamily: "'Segoe UI', 'Helvetica Neue', Helvetica, 'Lucida Grande', Arial, Ubuntu, Cantarell, 'Fira Sans', sans-serif",
                      fontSize: '14.2px',
                      lineHeight: '19px',
                      fontWeight: 400,
                    }}
                  >
                    <div className="mb-0.5">
                      <ReactMarkdown
                        components={{
                          code: ({ node, inline, className, children, ...props }: any) => {
                            const match = /language-(\w+)/.exec(className || '');
                            return !inline && match ? (
                              <pre className={`${msg.role === 'user' ? 'bg-black/10 text-[#111111]' : 'bg-gray-100 text-[#111111]'} p-2 rounded my-1 text-xs overflow-x-auto`}>
                                <code className={className} {...props}>
                                  {String(children).replace(/\n$/, '')}
                                </code>
                              </pre>
                            ) : (
                              <code className={`${msg.role === 'user' ? 'bg-black/10 text-[#111111]' : 'bg-gray-100 text-[#111111]'} px-1 py-0.5 rounded text-xs font-mono`} {...props}>
                                {children}
                              </code>
                            );
                          },
                          p: ({ children }: any) => <p className="my-0.5">{children}</p>,
                          ul: ({ children }: any) => <ul className="my-0.5 ml-4 list-disc space-y-0">{children}</ul>,
                          ol: ({ children }: any) => <ol className="my-0.5 ml-4 list-decimal space-y-0">{children}</ol>,
                          li: ({ children }: any) => <li className="my-0">{children}</li>,
                          h1: ({ children }: any) => <h1 className="text-base font-semibold my-1">{children}</h1>,
                          h2: ({ children }: any) => <h2 className="text-sm font-semibold my-0.5">{children}</h2>,
                          h3: ({ children }: any) => <h3 className="text-xs font-semibold my-0.5">{children}</h3>,
                          blockquote: ({ children }: any) => <blockquote className={`border-l-2 ${msg.role === 'user' ? 'border-black/20' : 'border-gray-300'} pl-2 italic my-0.5 text-[#111111]`}>{children}</blockquote>,
                          table: ({ children }: any) => <div className="overflow-x-auto my-1"><table className={`border-collapse border ${msg.role === 'user' ? 'border-black/20' : 'border-gray-300'} w-full text-xs`}>{children}</table></div>,
                          thead: ({ children }: any) => <thead className={msg.role === 'user' ? 'bg-black/10' : 'bg-gray-100'}>{children}</thead>,
                          tbody: ({ children }: any) => <tbody>{children}</tbody>,
                          tr: ({ children }: any) => <tr className={msg.role === 'user' ? 'border-b border-black/10' : 'border-b border-gray-200'}>{children}</tr>,
                          th: ({ children }: any) => <th className={`border ${msg.role === 'user' ? 'border-black/20' : 'border-gray-300'} px-1 py-0.5 text-left font-semibold`}>{children}</th>,
                          td: ({ children }: any) => <td className={`border ${msg.role === 'user' ? 'border-black/20' : 'border-gray-300'} px-1 py-0.5`}>{children}</td>,
                          a: ({ children, href }: any) => <a href={href} className="text-blue-600 underline" target="_blank" rel="noopener noreferrer">{children}</a>,
                          strong: ({ children }: any) => <strong className="font-semibold">{children}</strong>,
                          em: ({ children }: any) => <em className="italic">{children}</em>,
                          hr: () => <hr className={`my-1 ${msg.role === 'user' ? 'border-black/20' : 'border-gray-300'}`} />,
                        }}
                      >
                        {msg.content}
                      </ReactMarkdown>
                    </div>
                    <div className={`flex justify-end items-center gap-1 mt-0.5 ml-1`}>
                      <span className={`text-[11px] ${
                        msg.role === 'user' ? 'text-[rgba(0,0,0,0.45)]' : 'text-[#667781]'
                      }`} style={{
                        fontFamily: "'Segoe UI', 'Helvetica Neue', Helvetica, 'Lucida Grande', Arial, Ubuntu, Cantarell, 'Fira Sans', sans-serif"
                      }}>
                        {timestamp}
                      </span>
                      {msg.role === 'user' && (
                        <svg width="16" height="10" viewBox="0 0 16 10" className="ml-0.5">
                          <path d="M15.05.47l-.71.71a.5.5 0 0 1-.7 0L6.7 7.17a.5.5 0 0 1-.7 0L2.36 4.18a.5.5 0 0 1 0-.7l-.71-.71a.5.5 0 0 1 .7 0L6 5.76l6.65-6.65a.5.5 0 0 1 .7 0zm0 4l-.71.71a.5.5 0 0 1-.7 0L6.7 11.17a.5.5 0 0 1-.7 0L2.36 8.18a.5.5 0 0 1 0-.7l-.71-.71a.5.5 0 0 1 .7 0L6 9.76l6.65-6.65a.5.5 0 0 1 .7 0z" fill="#53BDEB"/>
                        </svg>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}

            {isLoading && (
              <div className="flex justify-start px-1 animate-fade-in">
                <div className="bg-white rounded-[7.5px] rounded-bl-[4px] px-2.5 py-2" style={{
                  boxShadow: '0 1px 0.5px rgba(0,0,0,0.13), 0 1px 1px rgba(0,0,0,0.2)',
                }}>
                  <div className="flex space-x-1">
                    <div className="w-2 h-2 bg-[#8696A0] rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                    <div className="w-2 h-2 bg-[#8696A0] rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                    <div className="w-2 h-2 bg-[#8696A0] rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Input Area - WhatsApp style */}
        <div className="absolute sm:relative bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-3 sm:px-4 md:px-6 py-2 sm:py-3 shadow-lg flex-shrink-0 safe-area-inset-bottom z-10">
          <div className="flex gap-2 sm:gap-3 items-center">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="Mensaje"
              disabled={!isConnected || isLoading}
              className="flex-1 px-4 sm:px-5 py-2 sm:py-2.5 border-none rounded-[21px] focus:outline-none bg-[#F0F2F5] text-[#111111] placeholder:text-[#667781] disabled:bg-[#F0F2F5] disabled:cursor-not-allowed text-[15px] transition-all"
              style={{
                fontFamily: "'Segoe UI', 'Helvetica Neue', Helvetica, 'Lucida Grande', Arial, Ubuntu, Cantarell, 'Fira Sans', sans-serif"
              }}
            />
            <button
              onClick={sendMessage}
              disabled={!isConnected || !input.trim() || isLoading}
              className="w-11 h-11 flex-shrink-0 bg-[#25D366] text-white rounded-full hover:opacity-90 focus:outline-none disabled:bg-[#8696A0] disabled:cursor-not-allowed transition-all flex items-center justify-center"
              title="Enviar mensaje"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M1.101 21.757L23.8 12.028 1.101 2.3l.011 7.912 13.623 1.816-13.623 1.817-.011 7.912z"/>
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

