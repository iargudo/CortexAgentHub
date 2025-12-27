import { createLogger } from '@cortex/shared';

const logger = createLogger('RESTService');

export type HTTPMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD' | 'OPTIONS';

export type AuthType = 'none' | 'bearer' | 'basic' | 'apikey' | 'custom';

export interface RESTConfig {
  baseUrl: string;
  auth?: {
    type: AuthType;
    bearerToken?: string;
    basicAuth?: {
      username: string;
      password: string;
    };
    apiKey?: {
      key: string;
      value: string;
      location: 'header' | 'query';
    };
    customHeaders?: Record<string, string>;
  };
  defaultHeaders?: Record<string, string>;
  timeout?: number;
}

export interface RESTCallParams {
  method: HTTPMethod;
  endpoint: string;
  headers?: Record<string, string>;
  queryParams?: Record<string, string>;
  body?: any;
  bodyType?: 'json' | 'form-data' | 'x-www-form-urlencoded' | 'raw';
}

export interface RESTResponse {
  success: boolean;
  status?: number;
  statusText?: string;
  headers?: Record<string, string>;
  data?: any;
  error?: string;
  executionTime?: number;
}

/**
 * REST Service for calling REST APIs
 * Supports all standard HTTP methods and various authentication types
 */
export class RESTService {
  /**
   * Make a REST API call
   */
  static async call(
    config: RESTConfig,
    params: RESTCallParams
  ): Promise<RESTResponse> {
    const startTime = Date.now();

    try {
      // Validate configuration
      if (!config.baseUrl) {
        throw new Error('Base URL is required');
      }

      if (!params.method || !params.endpoint) {
        throw new Error('HTTP method and endpoint are required');
      }

      // Build full URL
      const baseUrl = config.baseUrl.endsWith('/') 
        ? config.baseUrl.slice(0, -1) 
        : config.baseUrl;
      const endpoint = params.endpoint.startsWith('/')
        ? params.endpoint
        : `/${params.endpoint}`;
      
      let url = `${baseUrl}${endpoint}`;

      // Add query parameters
      if (params.queryParams && Object.keys(params.queryParams).length > 0) {
        const queryString = new URLSearchParams(params.queryParams).toString();
        url += `?${queryString}`;
      }

      // Build headers
      const headers: Record<string, string> = {
        ...config.defaultHeaders,
        ...params.headers,
      };

      // Add authentication headers
      if (config.auth) {
        switch (config.auth.type) {
          case 'bearer':
            if (config.auth.bearerToken) {
              headers['Authorization'] = `Bearer ${config.auth.bearerToken}`;
            }
            break;

          case 'basic':
            if (config.auth.basicAuth) {
              const credentials = Buffer.from(
                `${config.auth.basicAuth.username}:${config.auth.basicAuth.password}`
              ).toString('base64');
              headers['Authorization'] = `Basic ${credentials}`;
            }
            break;

          case 'apikey':
            if (config.auth.apiKey) {
              if (config.auth.apiKey.location === 'header') {
                headers[config.auth.apiKey.key] = config.auth.apiKey.value;
              } else {
                // Will be added to query string later
              }
            }
            break;

          case 'custom':
            if (config.auth.customHeaders) {
              Object.entries(config.auth.customHeaders).forEach(([key, value]) => {
                headers[key] = value;
              });
            }
            break;
        }

        // Add API key to query if needed
        if (config.auth.type === 'apikey' && config.auth.apiKey?.location === 'query') {
          const queryString = new URLSearchParams({
            ...params.queryParams,
            [config.auth.apiKey.key]: config.auth.apiKey.value,
          }).toString();
          url = `${baseUrl}${endpoint}?${queryString}`;
        }
      }

      // Prepare request options
      const requestOptions: RequestInit = {
        method: params.method,
        headers: {
          ...headers,
          // Set Content-Type based on body type
          ...(params.body && params.method !== 'GET' && params.method !== 'HEAD' && params.method !== 'OPTIONS'
            ? this.getContentTypeHeader(params.bodyType || 'json')
            : {}),
        },
        signal: config.timeout ? AbortSignal.timeout(config.timeout * 1000) : undefined,
      };

      // Add body for methods that support it
      if (params.body && ['POST', 'PUT', 'PATCH'].includes(params.method)) {
        if (params.bodyType === 'json' || !params.bodyType) {
          requestOptions.body = typeof params.body === 'string' 
            ? params.body 
            : JSON.stringify(params.body);
        } else if (params.bodyType === 'form-data') {
          const formData = new FormData();
          if (typeof params.body === 'object') {
            Object.entries(params.body).forEach(([key, value]) => {
              formData.append(key, String(value));
            });
          }
          requestOptions.body = formData;
          // Remove Content-Type header to let browser set it with boundary
          delete (requestOptions.headers as Record<string, string>)['Content-Type'];
        } else if (params.bodyType === 'x-www-form-urlencoded') {
          const formParams = new URLSearchParams();
          if (typeof params.body === 'object') {
            Object.entries(params.body).forEach(([key, value]) => {
              formParams.append(key, String(value));
            });
          }
          requestOptions.body = formParams.toString();
        } else if (params.bodyType === 'raw') {
          requestOptions.body = typeof params.body === 'string' 
            ? params.body 
            : String(params.body);
        }
      }

      logger.info('Making REST API call', {
        method: params.method,
        url: url.replace(/([?&])(api[_-]?key|password|token|bearer)=[^&]+/gi, '$1$2=***'),
      });

      // Make the request
      const response = await fetch(url, requestOptions);

      // Read response
      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });

      let responseData: any;
      const contentType = response.headers.get('content-type') || '';

      if (contentType.includes('application/json')) {
        responseData = await response.json();
      } else if (contentType.includes('application/xml') || contentType.includes('text/xml')) {
        responseData = await response.text();
      } else if (contentType.includes('text/')) {
        responseData = await response.text();
      } else {
        // Try to parse as JSON, fallback to text
        try {
          responseData = await response.json();
        } catch {
          responseData = await response.text();
        }
      }

      const executionTime = Date.now() - startTime;

      if (!response.ok) {
        logger.warn('REST API call returned error status', {
          status: response.status,
          url: url.replace(/([?&])(api[_-]?key|password|token|bearer)=[^&]+/gi, '$1$2=***'),
        });

        return {
          success: false,
          status: response.status,
          statusText: response.statusText,
          headers: responseHeaders,
          data: responseData,
          error: `HTTP ${response.status}: ${response.statusText}`,
          executionTime,
        };
      }

      logger.info('REST API call successful', {
        status: response.status,
        executionTime,
      });

      return {
        success: true,
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
        data: responseData,
        executionTime,
      };
    } catch (error: any) {
      const executionTime = Date.now() - startTime;

      logger.error('REST API call failed', {
        error: error.message,
        method: params.method,
      });

      return {
        success: false,
        error: error.message,
        executionTime,
      };
    }
  }

  /**
   * Get Content-Type header based on body type
   */
  private static getContentTypeHeader(bodyType: string): Record<string, string> {
    switch (bodyType) {
      case 'json':
        return { 'Content-Type': 'application/json' };
      case 'form-data':
        // Don't set Content-Type, let fetch handle it with boundary
        return {};
      case 'x-www-form-urlencoded':
        return { 'Content-Type': 'application/x-www-form-urlencoded' };
      case 'raw':
        return { 'Content-Type': 'text/plain' };
      default:
        return { 'Content-Type': 'application/json' };
    }
  }

  /**
   * Validate REST configuration
   */
  static async validateConfig(config: RESTConfig): Promise<{
    valid: boolean;
    error?: string;
  }> {
    try {
      if (!config.baseUrl) {
        return {
          valid: false,
          error: 'Base URL is required',
        };
      }

      // Try to make a simple HEAD or OPTIONS request
      try {
        const testUrl = config.baseUrl.endsWith('/') 
          ? config.baseUrl.slice(0, -1) 
          : config.baseUrl;
        
        const headers: Record<string, string> = { ...config.defaultHeaders };

        // Add auth headers
        if (config.auth) {
          if (config.auth.type === 'bearer' && config.auth.bearerToken) {
            headers['Authorization'] = `Bearer ${config.auth.bearerToken}`;
          } else if (config.auth.type === 'basic' && config.auth.basicAuth) {
            const credentials = Buffer.from(
              `${config.auth.basicAuth.username}:${config.auth.basicAuth.password}`
            ).toString('base64');
            headers['Authorization'] = `Basic ${credentials}`;
          } else if (config.auth.type === 'apikey' && config.auth.apiKey?.location === 'header') {
            headers[config.auth.apiKey.key] = config.auth.apiKey.value;
          } else if (config.auth.type === 'custom' && config.auth.customHeaders) {
            Object.entries(config.auth.customHeaders).forEach(([key, value]) => {
              headers[key] = value;
            });
          }
        }

        const response = await fetch(testUrl, {
          method: 'HEAD',
          headers,
          signal: AbortSignal.timeout(5000),
        });

        // Any response (even error) means the endpoint is reachable
        return { valid: true };
      } catch (error: any) {
        // Network errors mean invalid config
        return {
          valid: false,
          error: `Connection failed: ${error.message}`,
        };
      }
    } catch (error: any) {
      return {
        valid: false,
        error: error.message,
      };
    }
  }
}

