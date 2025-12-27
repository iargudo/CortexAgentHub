/**
 * CortexAgentHub Chat Widget
 * Embeddable chat widget for websites
 */
(function() {
  'use strict';

  // Get widget key from script src or data attribute
  const script = document.currentScript || document.querySelector('script[data-widget-key]');
  const widgetKey = (script && script.getAttribute('data-widget-key')) || 
                    (script && script.src && new URLSearchParams(script.src.split('?')[1] || '').get('key')) ||
                    'default';
  
  // Get API base URL from script src or use default
  const scriptSrc = (script && script.src) || '';
  const apiBaseUrl = scriptSrc.includes('http') 
    ? scriptSrc.substring(0, scriptSrc.indexOf('/widget.js'))
    : (window.CORTEX_WIDGET_API_URL || 'http://localhost:3000');

  // Widget state
  let config = null;
  let ws = null;
  let userId = null;
  let isOpen = false;
  let messages = [];
  let reconnectAttempts = 0;
  const maxReconnectAttempts = 5;

  // Generate or retrieve user ID
  function getUserId() {
    const storageKey = `cortex_widget_user_${widgetKey}`;
    let id = localStorage.getItem(storageKey);
    
    if (!id) {
      // Generate a simple fingerprint-based ID
      const fingerprint = [
        navigator.userAgent,
        navigator.language,
        screen.width + 'x' + screen.height,
        new Date().getTimezoneOffset(),
      ].join('|');
      
      // Simple hash
      let hash = 0;
      for (let i = 0; i < fingerprint.length; i++) {
        const char = fingerprint.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32bit integer
      }
      
      id = `user_${Math.abs(hash)}_${Date.now()}`;
      localStorage.setItem(storageKey, id);
    }
    
    return id;
  }

  // Load widget configuration
  async function loadConfig() {
    try {
      const response = await fetch(`${apiBaseUrl}/api/widgets/${widgetKey}/config`);
      if (!response.ok) {
        throw new Error(`Failed to load widget config: ${response.status}`);
      }
      const result = await response.json();
      config = result.data;
      console.log('Widget config loaded:', { ws_port: config.ws_port, apiBaseUrl });
      return config;
    } catch (error) {
      console.error('Error loading widget config:', error);
      return null;
    }
  }

  // Connect to WebSocket
  function connectWebSocket() {
    if (!config) return;

    // Get JWT token for authentication
    // Use instance_identifier from config for routing to correct channel/agent
    const instanceId = config.instance_identifier || widgetKey;
    fetch(`${apiBaseUrl}/api/v1/webchat/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: userId,
        websiteId: instanceId, // Use instance_identifier for routing
      }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (!data.token) {
          console.error('Failed to get auth token');
          return;
        }

        // Determine WebSocket URL
        // Use the same host as API, but with WebSocket protocol
        const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const apiUrlObj = new URL(apiBaseUrl);
        // Get WebSocket port from config or use default
        const wsPort = config.ws_port || 8081;
        const wsUrl = `${wsProtocol}//${apiUrlObj.hostname}:${wsPort}`;
        
        console.log('Connecting to WebSocket:', wsUrl);

        ws = new WebSocket(wsUrl);

        ws.onopen = () => {
          reconnectAttempts = 0;
          // Authenticate
          ws.send(JSON.stringify({
            type: 'auth',
            token: data.token,
          }));
        };

        ws.onmessage = (event) => {
          const message = JSON.parse(event.data);
          handleWebSocketMessage(message);
        };

        ws.onerror = (error) => {
          console.error('WebSocket error:', error);
          console.error('WebSocket error details:', {
            url: wsUrl,
            readyState: ws.readyState,
            protocol: ws.protocol,
          });
        };

        ws.onclose = (event) => {
          console.log('WebSocket closed:', {
            code: event.code,
            reason: event.reason,
            wasClean: event.wasClean,
          });
          // Attempt to reconnect
          if (reconnectAttempts < maxReconnectAttempts && isOpen) {
            reconnectAttempts++;
            console.log(`Reconnecting in ${1000 * reconnectAttempts}ms (attempt ${reconnectAttempts}/${maxReconnectAttempts})`);
            setTimeout(() => {
              connectWebSocket();
            }, 1000 * reconnectAttempts);
          } else if (reconnectAttempts >= maxReconnectAttempts) {
            console.error('Max reconnection attempts reached. WebSocket connection failed.');
          }
        };
      })
      .catch((error) => {
        console.error('Error getting auth token:', error);
      });
  }

  // Handle WebSocket messages
  function handleWebSocketMessage(message) {
    switch (message.type) {
      case 'auth_success':
        console.log('Widget authenticated');
        break;
      case 'message':
        addMessage(message.content, 'assistant', message.timestamp);
        break;
      case 'message_received':
        // Acknowledgment
        break;
      case 'error':
        console.error('Widget error:', message.error);
        break;
      default:
        console.log('Unknown message type:', message.type);
    }
  }

  // Send message
  function sendMessage(content) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      console.error('WebSocket not connected');
      return;
    }

    const messageId = `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    ws.send(JSON.stringify({
      type: 'message',
      content: content,
      messageId: messageId,
      timestamp: new Date().toISOString(),
    }));

    addMessage(content, 'user');
  }

  // Add message to chat
  function addMessage(content, role, timestamp = null) {
    messages.push({
      content,
      role,
      timestamp: timestamp || new Date().toISOString(),
    });
    renderMessages();
  }

  // Clear conversation
  function clearConversation() {
    messages = [];
    renderMessages();
    // Optionally notify server
    if (ws && ws.readyState === WebSocket.OPEN) {
      // Could send a clear event if server supports it
    }
  }

  // Create widget HTML
  function createWidget() {
    if (!config) return;

    // Get widget title from config or use default
    const widgetTitle = config.title || config.name || 'Chat de Soporte';

    // Create button
    const button = document.createElement('div');
    button.id = 'cortex-widget-button';
    button.innerHTML = `
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
      </svg>
    `;
    button.style.cssText = `
      position: fixed;
      ${config.position.includes('right') ? 'right: 20px;' : 'left: 20px;'}
      ${config.position.includes('bottom') ? 'bottom: 20px;' : 'top: 20px;'}
      width: ${config.button_size}px;
      height: ${config.button_size}px;
      background-color: ${config.button_color};
      color: ${config.button_text_color};
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      z-index: 9998;
      transition: transform 0.2s;
    `;
    button.addEventListener('mouseenter', () => {
      button.style.transform = 'scale(1.1)';
    });
    button.addEventListener('mouseleave', () => {
      button.style.transform = 'scale(1)';
    });
    button.addEventListener('click', toggleChat);
    document.body.appendChild(button);

    // Create chat window
    const chatWindow = document.createElement('div');
    chatWindow.id = 'cortex-widget-chat';
    chatWindow.style.cssText = `
      position: fixed;
      ${config.position.includes('right') ? 'right: 20px;' : 'left: 20px;'}
      ${config.position.includes('bottom') ? 'bottom: 80px;' : 'top: 80px;'}
      width: ${config.chat_width}px;
      height: ${config.chat_height}px;
      background: white;
      border-radius: 12px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
      display: none;
      flex-direction: column;
      z-index: 9999;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    `;
    chatWindow.innerHTML = `
      <div style="
        padding: 16px 20px;
        border-bottom: 1px solid #e5e7eb;
        display: flex;
        justify-content: space-between;
        align-items: center;
        background: ${config.primary_color};
        color: white;
        border-radius: 12px 12px 0 0;
      ">
        <div style="
          font-weight: 600;
          font-size: 16px;
          display: flex;
          align-items: center;
          gap: 10px;
        ">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
            <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/>
          </svg>
          ${widgetTitle}
        </div>
        <div style="display: flex; gap: 8px;">
          <button id="cortex-clear-btn" style="
            background: rgba(255, 255, 255, 0.2);
            border: none;
            color: white;
            padding: 6px;
            border-radius: 6px;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: background 0.2s;
          " onmouseover="this.style.background='rgba(255,255,255,0.3)'" onmouseout="this.style.background='rgba(255,255,255,0.2)'" title="Limpiar conversación">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
              <line x1="10" y1="11" x2="10" y2="17"></line>
              <line x1="14" y1="11" x2="14" y2="17"></line>
            </svg>
          </button>
          <button id="cortex-close-btn" style="
            background: none;
            border: none;
            color: white;
            cursor: pointer;
            padding: 4px;
            display: flex;
            align-items: center;
            transition: opacity 0.2s;
          " onmouseover="this.style.opacity='0.7'" onmouseout="this.style.opacity='1'" title="Cerrar chat">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
      </div>
      <div id="cortex-messages" style="
        flex: 1;
        overflow-y: auto;
        padding: 16px;
        display: flex;
        flex-direction: column;
        gap: 12px;
      "></div>
      <div id="cortex-typing" style="
        padding: 8px 16px;
        display: none;
        color: #6b7280;
        font-size: 14px;
        font-style: italic;
      ">Escribiendo...</div>
      <div style="
        padding: 16px;
        border-top: 1px solid #e5e7eb;
        display: flex;
        gap: 10px;
        align-items: center;
      ">
        <input
          id="cortex-input"
          type="text"
          placeholder="${config.placeholder_text}"
          style="
            flex: 1;
            padding: 12px 16px;
            border: 1px solid #d1d5db;
            border-radius: 8px;
            font-size: 14px;
            outline: none;
            transition: border-color 0.2s;
          "
          onfocus="this.style.borderColor='${config.primary_color}'"
          onblur="this.style.borderColor='#d1d5db'"
        />
        <button id="cortex-send-btn" style="
          width: 44px;
          height: 44px;
          padding: 0;
          background: ${config.primary_color};
          color: white;
          border: none;
          border-radius: 50%;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: transform 0.2s, box-shadow 0.2s;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
        " onmouseover="this.style.transform='scale(1.05)'; this.style.boxShadow='0 4px 12px rgba(0,0,0,0.15)'" onmouseout="this.style.transform='scale(1)'; this.style.boxShadow='0 2px 8px rgba(0,0,0,0.1)'">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="22" y1="2" x2="11" y2="13"></line>
            <polygon points="22 2 15 22 11 13 2 9 22 2" fill="currentColor"></polygon>
          </svg>
        </button>
      </div>
    `;
    document.body.appendChild(chatWindow);

    // Event listeners
    const closeBtn = document.getElementById('cortex-close-btn');
    if (closeBtn) closeBtn.addEventListener('click', toggleChat);
    
    const clearBtn = document.getElementById('cortex-clear-btn');
    if (clearBtn) clearBtn.addEventListener('click', clearConversation);
    
    const sendBtn = document.getElementById('cortex-send-btn');
    if (sendBtn) sendBtn.addEventListener('click', handleSend);
    
    const input = document.getElementById('cortex-input');
    if (input) {
      input.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
          handleSend();
        }
      });
    }

    // Show welcome message if configured
    if (config.welcome_message) {
      addMessage(config.welcome_message, 'assistant');
    }
  }

  // Toggle chat window
  function toggleChat() {
    isOpen = !isOpen;
    const chatWindow = document.getElementById('cortex-widget-chat');
    if (chatWindow) {
      chatWindow.style.display = isOpen ? 'flex' : 'none';
      if (isOpen) {
        const input = document.getElementById('cortex-input');
        if (input) input.focus();
        connectWebSocket();
      }
    }
  }

  // Handle send
  function handleSend() {
    const input = document.getElementById('cortex-input');
    if (input && input.value && input.value.trim()) {
      sendMessage(input.value.trim());
      input.value = '';
    }
  }

  // Render messages
  function renderMessages() {
    const container = document.getElementById('cortex-messages');
    if (!container) return;

    container.innerHTML = messages.map((msg) => {
      const isUser = msg.role === 'user';
      return `
        <div style="
          display: flex;
          justify-content: ${isUser ? 'flex-end' : 'flex-start'};
        ">
          <div style="
            max-width: 75%;
            padding: 10px 14px;
            border-radius: 12px;
            background: ${isUser ? config.primary_color : '#f3f4f6'};
            color: ${isUser ? 'white' : '#1f2937'};
            font-size: 14px;
            line-height: 1.5;
          ">
            ${msg.content}
          </div>
        </div>
      `;
    }).join('');

    // Scroll to bottom
    container.scrollTop = container.scrollHeight;
  }

  // Initialize widget
  async function init() {
    userId = getUserId();
    const loadedConfig = await loadConfig();
    
    if (!loadedConfig) {
      console.error('Failed to load widget configuration');
      return;
    }

    createWidget();
  }

  // Start when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

