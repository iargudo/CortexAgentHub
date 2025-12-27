/**
 * Resource management for external integrations
 * Placeholder for future implementation
 */

export interface ResourceManager {
  connect(name: string, config: any): Promise<void>;
  query(name: string, query: any): Promise<any>;
  disconnect(name: string): Promise<void>;
}
