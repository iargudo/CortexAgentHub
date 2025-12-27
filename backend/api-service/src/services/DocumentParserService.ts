import mammoth from 'mammoth';
import * as XLSX from 'xlsx';
import { createLogger } from '@cortex/shared';

const logger = createLogger('DocumentParserService');

// Import pdf-parse using TypeScript's import = require syntax for CommonJS modules
// pdf-parse v2.4.5 exports an object where PDFParse is a class that needs to be instantiated
import pdfParseModule = require('pdf-parse');

// Extract the PDFParse class from the module
// In v2.4.5, the module exports an object with PDFParse as a property
// We need to extract it at runtime to ensure it works in both dev and production
let PDFParse: any;
try {
  PDFParse = (pdfParseModule as any).PDFParse;
  if (!PDFParse || typeof PDFParse !== 'function') {
    throw new Error('PDFParse class not found in pdf-parse module');
  }
} catch (error: any) {
  throw new Error(`Failed to load PDFParse from pdf-parse: ${error.message}`);
}

export interface ParseResult {
  content: string;
  metadata?: {
    pageCount?: number;
    wordCount?: number;
    sheetNames?: string[];
    rowCount?: number;
  };
}

/**
 * Document Parser Service
 * Handles parsing of various document formats (PDF, Word, Excel)
 */
export class DocumentParserService {
  /**
   * Parse a document from buffer based on file type
   */
  async parseDocument(buffer: Buffer, fileName: string, mimeType?: string): Promise<ParseResult> {
    const extension = this.getFileExtension(fileName);
    const type = mimeType || this.getMimeTypeFromExtension(extension);

    logger.info('Parsing document', {
      fileName,
      extension,
      mimeType: type,
      size: buffer.length,
    });

    try {
      switch (extension.toLowerCase()) {
        case '.pdf':
          return await this.parsePDF(buffer);
        case '.docx':
          return await this.parseDOCX(buffer);
        case '.xlsx':
        case '.xls':
          return await this.parseExcel(buffer);
        case '.txt':
        case '.md':
        case '.csv':
          // Text files are already in UTF-8, just convert to string
          return {
            content: buffer.toString('utf-8'),
            metadata: {
              wordCount: buffer.toString('utf-8').split(/\s+/).length,
            },
          };
        default:
          // Fallback: try to parse as text
          logger.warn('Unknown file type, attempting to parse as text', { extension });
          return {
            content: buffer.toString('utf-8'),
            metadata: {},
          };
      }
    } catch (error: any) {
      logger.error('Document parsing failed', {
        fileName,
        extension,
        error: error.message,
      });
      throw new Error(`Failed to parse document ${fileName}: ${error.message}`);
    }
  }

  /**
   * Parse PDF file
   */
  private async parsePDF(buffer: Buffer): Promise<ParseResult> {
    let parser: any = null;
    try {
      // Verify PDFParse class is available (should be set at module load, but double-check)
      if (!PDFParse || typeof PDFParse !== 'function') {
        // Try to reload it in case module structure changed
        PDFParse = (pdfParseModule as any).PDFParse;
        if (!PDFParse || typeof PDFParse !== 'function') {
          logger.error('PDFParse class is not available', {
            type: typeof PDFParse,
            hasPDFParse: !!(pdfParseModule as any).PDFParse,
            moduleKeys: Object.keys(pdfParseModule || {}),
            moduleType: typeof pdfParseModule,
          });
          throw new Error('PDFParse class is not available');
        }
      }
      
      logger.info('Instantiating PDFParse with buffer', { bufferSize: buffer.length });
      
      // In v2.4.5, PDFParse is a class that must be instantiated with { data: buffer }
      parser = new PDFParse({ data: buffer });
      
      // Call getText() to extract text from the PDF
      logger.info('Calling getText() on PDFParse instance');
      const result = await parser.getText();
      
      // Clean up resources
      if (parser && typeof parser.destroy === 'function') {
        await parser.destroy();
      }
      parser = null;
      
      const content = result?.text?.trim() || '';
      
      // Clean up the text - remove excessive whitespace
      const cleanedContent = content
        .replace(/\n{3,}/g, '\n\n') // Replace 3+ newlines with 2
        .replace(/[ \t]+/g, ' ') // Replace multiple spaces/tabs with single space
        .trim();

      return {
        content: cleanedContent,
        metadata: {
          pageCount: result?.total || result?.pages?.length || 0,
          wordCount: cleanedContent.split(/\s+/).filter((w: string) => w.length > 0).length,
        },
      };
    } catch (error: any) {
      // Ensure parser is destroyed even if there's an error
      if (parser && typeof parser.destroy === 'function') {
        try {
          await parser.destroy();
        } catch (destroyError) {
          logger.warn('Error destroying PDFParse instance', { error: destroyError });
        }
      }
      logger.error('PDF parsing failed', {
        error: error.message,
        errorStack: error.stack,
        errorName: error.name,
      });
      throw new Error(`PDF parsing failed: ${error.message}`);
    }
  }

  /**
   * Parse DOCX file
   */
  private async parseDOCX(buffer: Buffer): Promise<ParseResult> {
    try {
      const result = await mammoth.extractRawText({ buffer });
      
      let content = result.value;
      
      // Clean up the text
      content = content
        .replace(/\n{3,}/g, '\n\n') // Replace 3+ newlines with 2
        .replace(/[ \t]+/g, ' ') // Replace multiple spaces/tabs with single space
        .trim();

      // If there are messages, log them but don't fail
      if (result.messages.length > 0) {
        logger.warn('DOCX parsing warnings', {
          messages: result.messages.map((m: any) => m.message),
        });
      }

      return {
        content,
        metadata: {
          wordCount: content.split(/\s+/).filter(w => w.length > 0).length,
        },
      };
    } catch (error: any) {
      throw new Error(`DOCX parsing failed: ${error.message}`);
    }
  }

  /**
   * Parse Excel file (XLSX, XLS)
   */
  private async parseExcel(buffer: Buffer): Promise<ParseResult> {
    try {
      const workbook = XLSX.read(buffer, { type: 'buffer' });
      
      const sheets: string[] = [];
      let allContent = '';
      let totalRows = 0;

      // Process each sheet
      workbook.SheetNames.forEach((sheetName) => {
        const sheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
        
        sheets.push(sheetName);
        
        // Convert sheet to readable text format
        allContent += `\n## Sheet: ${sheetName}\n\n`;
        
        jsonData.forEach((row: any, rowIndex: number) => {
          if (Array.isArray(row) && row.some((cell: any) => cell !== '' && cell != null)) {
            // Only include non-empty rows
            const rowText = row
              .map((cell: any) => String(cell || '').trim())
              .filter((cell: string) => cell.length > 0)
              .join(' | ');
            
            if (rowText) {
              allContent += `${rowText}\n`;
              totalRows++;
            }
          }
        });
        
        allContent += '\n';
      });

      return {
        content: allContent.trim(),
        metadata: {
          sheetNames: sheets,
          rowCount: totalRows,
        },
      };
    } catch (error: any) {
      throw new Error(`Excel parsing failed: ${error.message}`);
    }
  }

  /**
   * Get file extension from filename
   */
  private getFileExtension(fileName: string): string {
    const lastDot = fileName.lastIndexOf('.');
    if (lastDot === -1) return '';
    return fileName.substring(lastDot);
  }

  /**
   * Get MIME type from file extension
   */
  private getMimeTypeFromExtension(extension: string): string {
    const mimeTypes: Record<string, string> = {
      '.pdf': 'application/pdf',
      '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      '.doc': 'application/msword',
      '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      '.xls': 'application/vnd.ms-excel',
      '.txt': 'text/plain',
      '.md': 'text/markdown',
      '.csv': 'text/csv',
    };
    
    return mimeTypes[extension.toLowerCase()] || 'application/octet-stream';
  }

  /**
   * Check if file type is supported
   */
  isSupported(fileName: string, mimeType?: string): boolean {
    const extension = this.getFileExtension(fileName);
    const supportedExtensions = ['.pdf', '.docx', '.xlsx', '.xls', '.txt', '.md', '.csv'];
    return supportedExtensions.includes(extension.toLowerCase());
  }

  /**
   * Get maximum file size (in bytes) for a given file type
   */
  getMaxFileSize(fileName: string): number {
    const extension = this.getFileExtension(fileName).toLowerCase();
    
    // PDFs and Excel files can be larger, Word docs are usually smaller
    switch (extension) {
      case '.pdf':
        return 50 * 1024 * 1024; // 50 MB
      case '.xlsx':
      case '.xls':
        return 20 * 1024 * 1024; // 20 MB
      case '.docx':
        return 10 * 1024 * 1024; // 10 MB
      default:
        return 5 * 1024 * 1024; // 5 MB for text files
    }
  }
}

