import { Editor, OnMount } from '@monaco-editor/react';

interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  height?: string;
  language?: string;
  readOnly?: boolean;
}

export function CodeEditor({
  value,
  onChange,
  height = '400px',
  language = 'javascript',
  readOnly = false,
}: CodeEditorProps) {
  const handleEditorMount: OnMount = (_editor, monaco) => {
    // Configure TypeScript/JavaScript language features
    monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({
      noSemanticValidation: false,
      noSyntaxValidation: false,
    });

    monaco.languages.typescript.javascriptDefaults.setCompilerOptions({
      target: monaco.languages.typescript.ScriptTarget.ES2020,
      allowNonTsExtensions: true,
      moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
      module: monaco.languages.typescript.ModuleKind.CommonJS,
      noEmit: true,
      esModuleInterop: true,
      allowJs: true,
    });

    // Add type definitions for available utilities
    const utilsTypeDef = `
      declare interface Parameters {
        [key: string]: any;
      }

      declare interface MCPContext {
        sessionId: string;
        userId: string;
        channel: 'whatsapp' | 'telegram' | 'webchat' | 'email';
        metadata?: Record<string, any>;
      }

      declare interface Logger {
        info(message: string, meta?: any): void;
        warn(message: string, meta?: any): void;
        error(message: string, meta?: any): void;
      }

      declare interface Database {
        query(sql: string, values?: any[]): Promise<{ rows: any[] }>;
      }

      declare interface Utils {
        sleep(ms: number): Promise<void>;
        formatDate(date: Date): string;
        parseJSON(str: string): any;
        stringifyJSON(obj: any): string;
      }

      declare const parameters: Parameters;
      declare const context: MCPContext;
      declare const logger: Logger;
      declare const db: Database;
      declare function fetch(url: string, options?: any): Promise<Response>;
      declare const utils: Utils;

      /**
       * Tool handler function - must be defined in your implementation
       * @param parameters - Tool parameters passed by the user
       * @param context - MCP context with session and user information
       * @returns Tool execution result
       */
      declare function handler(parameters: Parameters, context: MCPContext): Promise<{
        success: boolean;
        data?: any;
        message?: string;
        error?: string;
      }>;
    `;

    monaco.languages.typescript.javascriptDefaults.addExtraLib(
      utilsTypeDef,
      'ts:filename/cortex-utils.d.ts'
    );

    // Add snippets
    monaco.languages.registerCompletionItemProvider('javascript', {
      provideCompletionItems: (model, position) => {
        const word = model.getWordUntilPosition(position);
        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn,
        };
        
        const suggestions = [
          {
            label: 'handler',
            kind: monaco.languages.CompletionItemKind.Snippet,
            range: range,
            insertText: [
              'async function handler(parameters, context) {',
              '  const { ${1:param} } = parameters;',
              '  ',
              '  logger.info("Executing tool", { ${1:param} });',
              '  ',
              '  // Your implementation here',
              '  ${2}',
              '  ',
              '  return {',
              '    success: true,',
              '    data: {},',
              '    message: "Operation completed"',
              '  };',
              '}',
            ].join('\n'),
            insertTextRules:
              monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            documentation: 'Basic tool handler template',
          },
          {
            label: 'handler-with-fetch',
            kind: monaco.languages.CompletionItemKind.Snippet,
            range: range,
            insertText: [
              'async function handler(parameters, context) {',
              '  const { ${1:param} } = parameters;',
              '  ',
              '  logger.info("Calling API", { ${1:param} });',
              '  ',
              '  try {',
              '    const response = await fetch(`https://api.example.com/\\${${1:param}}`);',
              '    const data = await response.json();',
              '    ',
              '    return {',
              '      success: true,',
              '      data: data,',
              '      message: "Data retrieved successfully"',
              '    };',
              '  } catch (error) {',
              '    logger.error("API call failed", { error: error.message });',
              '    return {',
              '      success: false,',
              '      error: error.message',
              '    };',
              '  }',
              '}',
            ].join('\n'),
            insertTextRules:
              monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            documentation: 'Tool handler with API fetch',
          },
          {
            label: 'handler-with-db',
            kind: monaco.languages.CompletionItemKind.Snippet,
            range: range,
            insertText: [
              'async function handler(parameters, context) {',
              '  const { ${1:param} } = parameters;',
              '  ',
              '  logger.info("Querying database", { ${1:param} });',
              '  ',
              '  try {',
              '    const result = await db.query(',
              '      "SELECT * FROM ${2:table_name} WHERE ${3:column} = \\$1",',
              '      [${1:param}]',
              '    );',
              '    ',
              '    return {',
              '      success: true,',
              '      data: result.rows,',
              '      message: `Found \\${result.rows.length} records`',
              '    };',
              '  } catch (error) {',
              '    logger.error("Database query failed", { error: error.message });',
              '    return {',
              '      success: false,',
              '      error: error.message',
              '    };',
              '  }',
              '}',
            ].join('\n'),
            insertTextRules:
              monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            documentation: 'Tool handler with database query',
          },
        ];

        return { suggestions };
      },
    });
  };

  return (
    <div className="border rounded-lg overflow-hidden">
      <Editor
        height={height}
        language={language}
        value={value}
        onChange={(value) => onChange(value || '')}
        onMount={handleEditorMount}
        theme="vs-dark"
        options={{
          minimap: { enabled: false },
          fontSize: 13,
          lineNumbers: 'on',
          roundedSelection: true,
          scrollBeyondLastLine: false,
          readOnly,
          automaticLayout: true,
          tabSize: 2,
          wordWrap: 'on',
          formatOnPaste: true,
          formatOnType: true,
          suggestOnTriggerCharacters: true,
          quickSuggestions: true,
          parameterHints: {
            enabled: true,
          },
          suggest: {
            showMethods: true,
            showFunctions: true,
            showVariables: true,
            showKeywords: true,
            showSnippets: true,
          },
        }}
      />
    </div>
  );
}
