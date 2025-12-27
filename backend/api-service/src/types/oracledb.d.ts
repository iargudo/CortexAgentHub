// Type declarations for oracledb
declare module 'oracledb' {
  export interface ConnectionAttributes {
    user?: string;
    password?: string;
    connectString?: string;
    [key: string]: any;
  }

  export interface Connection {
    execute<T = any>(
      sql: string,
      bindParams?: any,
      options?: any
    ): Promise<{ rows?: T[]; rowsAffected?: number; [key: string]: any }>;
    close(): Promise<void>;
    commit(): Promise<void>;
    rollback(): Promise<void>;
    [key: string]: any;
  }

  export function getConnection(
    attributes: ConnectionAttributes
  ): Promise<Connection>;

  export const OUT_FORMAT_ARRAY: number;
  export const OUT_FORMAT_OBJECT: number;
}

