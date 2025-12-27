/**
 * CortexAgentHub Chat Widget
 * Embeddable chat widget for websites
 */
(function() {
  'use strict';

  // Simple Markdown parser (lightweight implementation)
  function parseMarkdown(text) {
    if (!text) return '';
    
    // Split by code blocks first to preserve them
    const codeBlockRegex = /```[\s\S]*?```/g;
    const codeBlocks = [];
    let html = text.replace(codeBlockRegex, function(match) {
      const id = 'CODE_BLOCK_' + codeBlocks.length;
      codeBlocks.push(match);
      return id;
    });
    
    // Split by inline code
    const inlineCodeRegex = /`[^`\n]+`/g;
    const inlineCodes = [];
    html = html.replace(inlineCodeRegex, function(match) {
      const id = 'INLINE_CODE_' + inlineCodes.length;
      inlineCodes.push(match);
      return id;
    });
    
    // Escape HTML
    html = html
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    
    // Headers
    html = html.replace(/^### (.*$)/gim, '<h3 style="font-size: 16px; font-weight: bold; margin: 8px 0 4px 0;">$1</h3>');
    html = html.replace(/^## (.*$)/gim, '<h2 style="font-size: 18px; font-weight: bold; margin: 10px 0 6px 0;">$1</h2>');
    html = html.replace(/^# (.*$)/gim, '<h1 style="font-size: 20px; font-weight: bold; margin: 12px 0 8px 0;">$1</h1>');
    
    // Bold
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/__([^_]+)__/g, '<strong>$1</strong>');
    
    // Italic
    html = html.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
    html = html.replace(/_([^_\n]+)_/g, '<em>$1</em>');
    
    // Links
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" style="color: inherit; text-decoration: underline;">$1</a>');
    
    // Simple lists (process line by line)
    const lines = html.split('\n');
    let inList = false;
    let listType = null;
    const processedLines = [];
    
    lines.forEach(function(line) {
      const ulMatch = line.match(/^(\* |\- )(.*)$/);
      const olMatch = line.match(/^(\d+\. )(.*)$/);
      
      if (ulMatch) {
        if (!inList || listType !== 'ul') {
          if (inList) {
            processedLines.push('</' + listType + '>');
          }
          processedLines.push('<ul style="margin: 8px 0; padding-left: 20px; list-style-type: disc;">');
          inList = true;
          listType = 'ul';
        }
        processedLines.push('<li style="margin: 2px 0;">' + ulMatch[2] + '</li>');
      } else if (olMatch) {
        if (!inList || listType !== 'ol') {
          if (inList) {
            processedLines.push('</' + listType + '>');
          }
          processedLines.push('<ol style="margin: 8px 0; padding-left: 20px; list-style-type: decimal;">');
          inList = true;
          listType = 'ol';
        }
        processedLines.push('<li style="margin: 2px 0;">' + olMatch[2] + '</li>');
      } else {
        if (inList) {
          processedLines.push('</' + listType + '>');
          inList = false;
          listType = null;
        }
        if (line.trim()) {
          processedLines.push(line);
        }
      }
    });
    
    if (inList) {
      processedLines.push('</' + listType + '>');
    }
    
    html = processedLines.join('\n');
    
    // Blockquotes
    html = html.replace(/^&gt; (.*$)/gim, '<blockquote style="border-left: 3px solid rgba(0,0,0,0.2); padding-left: 12px; margin: 8px 0; font-style: italic;">$1</blockquote>');
    
    // Restore inline code
    inlineCodes.forEach(function(code, index) {
      const codeContent = code.slice(1, -1)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      html = html.replace('INLINE_CODE_' + index, '<code style="background: rgba(0,0,0,0.1); padding: 2px 4px; border-radius: 3px; font-size: 12px; font-family: monospace;">' + codeContent + '</code>');
    });
    
    // Restore code blocks
    codeBlocks.forEach(function(block, index) {
      const codeContent = block.slice(3, -3).trim()
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      html = html.replace('CODE_BLOCK_' + index, '<pre style="background: rgba(0,0,0,0.1); padding: 8px; border-radius: 4px; overflow-x: auto; font-size: 12px; margin: 8px 0; white-space: pre-wrap;"><code>' + codeContent + '</code></pre>');
    });
    
    // Line breaks
    html = html.replace(/\n/g, '<br>');
    
    return html;
  }

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
    // Use channel_id from config for routing to correct channel/agent
    const channelId = config.channel_id || widgetKey;
    fetch(`${apiBaseUrl}/api/v1/webchat/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: userId,
        websiteId: channelId, // Use channel_id (UUID) for routing
      }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (!data.token) {
          console.error('Failed to get auth token');
          return;
        }

        // Determine WebSocket URL
        // ALWAYS use Fastify WebSocket route (works both locally and in Azure)
        const apiUrlObj = new URL(apiBaseUrl);
        const wsProtocol = apiUrlObj.protocol === 'https:' ? 'wss:' : 'ws:';
        // Always use the same host as API with /api/v1/webchat/ws path
        // This works both locally and in Azure App Service
        const wsUrl = `${wsProtocol}//${apiUrlObj.hostname}${apiUrlObj.port && apiUrlObj.port !== '80' && apiUrlObj.port !== '443' ? ':' + apiUrlObj.port : ''}/api/v1/webchat/ws`;
        
        console.log('Connecting to WebSocket:', wsUrl);

        ws = new WebSocket(wsUrl);

        ws.onopen = () => {
          console.log('WebSocket connection opened successfully', {
            readyState: ws.readyState,
            protocol: ws.protocol,
            url: wsUrl,
          });
          reconnectAttempts = 0;
          
          // Send authentication immediately - WebSocket is ready when onopen fires
          // No need to wait, as the socket is already in OPEN state
          if (ws.readyState === WebSocket.OPEN) {
            try {
              console.log('Sending authentication token immediately...');
              ws.send(JSON.stringify({
                type: 'auth',
                token: data.token,
              }));
              console.log('Authentication token sent successfully');
            } catch (error) {
              console.error('Error sending authentication token:', error);
              // Don't close immediately, let the server timeout handle it
              console.warn('Will retry authentication on next message or let server timeout');
            }
          } else {
            console.error('WebSocket not open when trying to authenticate', {
              readyState: ws.readyState,
            });
            // If not open, wait a brief moment and retry once
            setTimeout(() => {
              if (ws.readyState === WebSocket.OPEN) {
                try {
                  console.log('Retrying authentication token send...');
                  ws.send(JSON.stringify({
                    type: 'auth',
                    token: data.token,
                  }));
                  console.log('Authentication token sent successfully (retry)');
                } catch (error) {
                  console.error('Error sending authentication token on retry:', error);
                }
              }
            }, 100);
          }
        };

        ws.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data);
            console.log('WebSocket message received:', {
              type: message.type,
              readyState: ws.readyState,
            });
            
            // Handle initial connection message
            if (message.type === 'connected') {
              console.log('WebSocket connection confirmed:', message.message);
              return;
            }
            
            // Handle authentication success
            if (message.type === 'auth_success') {
              console.log('WebSocket authenticated successfully:', {
                userId: message.userId,
                websiteId: message.websiteId,
              });
            }
            
            handleWebSocketMessage(message);
          } catch (error) {
            console.error('Error parsing WebSocket message:', error, {
              rawData: event.data,
              readyState: ws.readyState,
            });
          }
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
          const closeCodeMeanings = {
            1000: 'Normal closure',
            1001: 'Going away',
            1002: 'Protocol error',
            1003: 'Unsupported data',
            1006: 'Abnormal closure (no close frame received)',
            1008: 'Policy violation',
            1009: 'Message too big',
            1011: 'Server error',
          };
          
          console.warn('WebSocket closed:', {
            code: event.code,
            reason: event.reason,
            wasClean: event.wasClean,
            meaning: closeCodeMeanings[event.code] || `Unknown (${event.code})`,
            url: wsUrl,
          });
          
          // Attempt to reconnect
          if (reconnectAttempts < maxReconnectAttempts && isOpen) {
            reconnectAttempts++;
            const delay = 1000 * reconnectAttempts;
            console.log(`Reconnecting in ${delay}ms (attempt ${reconnectAttempts}/${maxReconnectAttempts})`);
            setTimeout(() => {
              if (isOpen) {
                connectWebSocket();
              }
            }, delay);
          } else if (reconnectAttempts >= maxReconnectAttempts) {
            console.error('Max reconnection attempts reached. WebSocket connection failed.', {
              totalAttempts: reconnectAttempts,
              finalCode: event.code,
              finalReason: event.reason,
            });
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
    showTypingIndicator();
  }

  // Show typing indicator
  function showTypingIndicator() {
    const typingDiv = document.getElementById('cortex-typing');
    if (typingDiv) {
      typingDiv.style.display = 'block';
      const messagesContainer = document.getElementById('cortex-messages');
      if (messagesContainer) {
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
      }
    }
  }

  // Hide typing indicator
  function hideTypingIndicator() {
    const typingDiv = document.getElementById('cortex-typing');
    if (typingDiv) {
      typingDiv.style.display = 'none';
    }
  }

  // Add message to chat
  function addMessage(content, role, timestamp = null) {
    // Hide typing indicator when assistant message arrives
    if (role === 'assistant') {
      hideTypingIndicator();
    }
    
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

  // Add animation styles to document
  function addAnimationStyles() {
    if (!document.getElementById('cortex-widget-styles')) {
      const style = document.createElement('style');
      style.id = 'cortex-widget-styles';
      style.textContent = `
        @keyframes typing-bounce {
          0%, 60%, 100% {
            transform: translateY(0);
          }
          30% {
            transform: translateY(-10px);
          }
        }
      `;
      document.head.appendChild(style);
    }
  }

  // Create widget HTML
  function createWidget() {
    if (!config) return;

    // Add animation styles
    addAnimationStyles();

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
      font-family: 'Segoe UI', 'Helvetica Neue', Helvetica, 'Lucida Grande', Arial, Ubuntu, Cantarell, 'Fira Sans', sans-serif;
    `;
    chatWindow.innerHTML = `
      <div style="
        padding: 10px 16px;
        background: ${config.primary_color || '#075E54'};
        color: white;
        border-radius: 12px 12px 0 0;
        position: relative;
      ">
        <div style="display: flex; justify-content: flex-end; margin-bottom: 8px;">
          <div style="display: flex; gap: 6px;">
            <button id="cortex-clear-btn" style="
              background: rgba(255, 255, 255, 0.2);
              border: none;
              color: white;
              padding: 5px;
              border-radius: 5px;
              cursor: pointer;
              display: flex;
              align-items: center;
              justify-content: center;
              transition: background 0.2s;
            " onmouseover="this.style.background='rgba(255,255,255,0.3)'" onmouseout="this.style.background='rgba(255,255,255,0.2)'" title="Limpiar conversación">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
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
              padding: 3px;
              display: flex;
              align-items: center;
              transition: opacity 0.2s;
            " onmouseover="this.style.opacity='0.7'" onmouseout="this.style.opacity='1'" title="Cerrar chat">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>
        </div>
        <div style="display: flex; align-items: center; gap: 10px;">
          <div style="
            width: 40px;
            height: 40px;
            border-radius: 50%;
            background: white;
            display: flex;
            align-items: center;
            justify-content: center;
            flex-shrink: 0;
            box-shadow: 0 2px 6px rgba(0,0,0,0.1);
          ">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${config.primary_color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
              <circle cx="9" cy="10" r="0.5" fill="${config.primary_color}"></circle>
              <circle cx="15" cy="10" r="0.5" fill="${config.primary_color}"></circle>
              <path d="M9 14h6" stroke="${config.primary_color}" stroke-width="1.5"></path>
            </svg>
          </div>
          <div style="flex: 1;">
            <div style="font-weight: 600; font-size: 17px;">
              ${widgetTitle}
            </div>
          </div>
        </div>
      </div>
      <div id="cortex-messages" style="
        flex: 1;
        overflow-y: auto;
        padding: 16px 8px;
        display: flex;
        flex-direction: column;
        gap: 2px;
        background: #ECE5DD;
        background-image: url('data:image/svg+xml,%3Csvg width=\'60\' height=\'60\' viewBox=\'0 0 60 60\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cg fill=\'none\' fill-rule=\'evenodd\'%3E%3Cg fill=\'%23000000\' fill-opacity=\'0.02\'%3E%3Cpath d=\'M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z\'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E');
        min-height: 0;
      "></div>
      <div id="cortex-typing" style="
        padding: 8px 20px;
        display: none;
      ">
        <div style="
          display: inline-flex;
          padding: 6px 7px 8px 9px;
          border-radius: 0 7.5px 7.5px 7.5px;
          background: white;
          box-shadow: 0 1px 0.5px rgba(0,0,0,0.13), 0 1px 1px rgba(0,0,0,0.2);
          gap: 4px;
          align-items: center;
        ">
          <div class="typing-dot" style="
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background: #8696A0;
            animation: typing-bounce 1.4s infinite ease-in-out;
          "></div>
          <div class="typing-dot" style="
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background: #8696A0;
            animation: typing-bounce 1.4s infinite ease-in-out 0.2s;
          "></div>
          <div class="typing-dot" style="
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background: #8696A0;
            animation: typing-bounce 1.4s infinite ease-in-out 0.4s;
          "></div>
        </div>
      </div>
      <div style="
        padding: 12px 16px;
        background: white;
        border-top: 1px solid #e5e7eb;
        display: flex;
        flex-direction: column;
        gap: 10px;
      ">
        <div style="display: flex; gap: 10px; align-items: center;">
          <input
            id="cortex-input"
            type="text"
            placeholder="${config.placeholder_text || 'Mensaje'}"
            style="
              flex: 1;
              padding: 9px 12px;
              border: none;
              border-radius: 21px;
              font-size: 15px;
              outline: none;
              background: #F0F2F5;
              color: #111111;
              font-family: 'Segoe UI', 'Helvetica Neue', Helvetica, 'Lucida Grande', Arial, Ubuntu, Cantarell, 'Fira Sans', sans-serif;
            "
            onfocus="this.style.background='#F0F2F5'"
            onblur="this.style.background='#F0F2F5'"
          />
          <button id="cortex-send-btn" style="
            width: 44px;
            height: 44px;
            padding: 0;
            background: #25D366;
            color: white;
            border: none;
            border-radius: 50%;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: opacity 0.2s;
            flex-shrink: 0;
          ">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M1.101 21.757L23.8 12.028 1.101 2.3l.011 7.912 13.623 1.816-13.623 1.817-.011 7.912z"/>
            </svg>
          </button>
        </div>
        <div style="
          text-align: center;
          font-size: 11px;
          color: #999;
          padding-top: 4px;
        ">
          Powered by <span style="font-weight: 600; color: #666;">CortexAgentHub</span>
        </div>
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

  // Render messages - WhatsApp style
  function renderMessages() {
    const container = document.getElementById('cortex-messages');
    if (!container) return;

    container.innerHTML = messages.map((msg) => {
      const isUser = msg.role === 'user';
      const markdownContent = parseMarkdown(msg.content);
      const timestamp = new Date(msg.timestamp || new Date()).toLocaleTimeString('es-ES', { 
        hour: '2-digit', 
        minute: '2-digit' 
      });
      
      return `
        <div style="
          display: flex;
          justify-content: ${isUser ? 'flex-end' : 'flex-start'};
          margin-bottom: 2px;
          padding: 0 8px;
        ">
          <div style="
            max-width: 65%;
            min-width: 60px;
            padding: 6px 7px 8px 9px;
            border-radius: ${isUser ? '7.5px 0 7.5px 7.5px' : '0 7.5px 7.5px 7.5px'};
            background: ${isUser ? '#DCF8C6' : '#FFFFFF'};
            color: #111111;
            font-size: 14.2px;
            line-height: 19px;
            font-weight: 400;
            font-family: 'Segoe UI', 'Helvetica Neue', Helvetica, 'Lucida Grande', Arial, Ubuntu, Cantarell, 'Fira Sans', sans-serif;
            box-shadow: 0 1px 0.5px rgba(0,0,0,0.13), 0 1px 1px rgba(0,0,0,0.2);
            word-wrap: break-word;
            overflow-wrap: break-word;
            position: relative;
          ">
            <div style="margin-bottom: 2px;">
              ${markdownContent}
            </div>
            <div style="
              display: flex;
              justify-content: flex-end;
              align-items: center;
              gap: 4px;
              margin-top: 2px;
              margin-left: 4px;
            ">
              <span style="
                font-size: 11px;
                color: ${isUser ? 'rgba(0,0,0,0.45)' : '#667781'};
                font-family: 'Segoe UI', 'Helvetica Neue', Helvetica, 'Lucida Grande', Arial, Ubuntu, Cantarell, 'Fira Sans', sans-serif;
              ">${timestamp}</span>
              ${isUser ? `
                <svg width="16" height="10" viewBox="0 0 16 10" style="margin-left: 2px;">
                  <path d="M15.05.47l-.71.71a.5.5 0 0 1-.7 0L6.7 7.17a.5.5 0 0 1-.7 0L2.36 4.18a.5.5 0 0 1 0-.7l-.71-.71a.5.5 0 0 1 .7 0L6 5.76l6.65-6.65a.5.5 0 0 1 .7 0zm0 4l-.71.71a.5.5 0 0 1-.7 0L6.7 11.17a.5.5 0 0 1-.7 0L2.36 8.18a.5.5 0 0 1 0-.7l-.71-.71a.5.5 0 0 1 .7 0L6 9.76l6.65-6.65a.5.5 0 0 1 .7 0z" fill="#53BDEB"/>
                </svg>
              ` : ''}
            </div>
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

