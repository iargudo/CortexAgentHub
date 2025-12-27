import { Job } from 'bullmq';
import { BaseWorker } from './BaseWorker';
import { QueueName, DocumentProcessingJob } from '../jobs/types';
import { createLogger } from '@cortex/shared';

const logger = createLogger('DocumentProcessingWorker');

/**
 * Document Processing Worker
 * Processes knowledge base documents asynchronously (chunking and embedding generation)
 */
export class DocumentProcessingWorker extends BaseWorker<DocumentProcessingJob> {
  private processDocumentFn?: (documentId: string, knowledgeBaseId: string) => Promise<void>;

  constructor(concurrency: number = 3) {
    super(QueueName.DOCUMENT_PROCESSING, concurrency);
  }

  /**
   * Set the document processing function (injected from KnowledgeBaseService)
   */
  setProcessDocumentFn(fn: (documentId: string, knowledgeBaseId: string) => Promise<void>): void {
    this.processDocumentFn = fn;
  }

  protected async process(job: Job<DocumentProcessingJob>): Promise<any> {
    const { documentId, knowledgeBaseId } = job.data;

    logger.info('Processing document', {
      jobId: job.id,
      documentId,
      knowledgeBaseId,
      attempt: job.attemptsMade + 1,
    });

    if (!this.processDocumentFn) {
      throw new Error('Document processing function not set. Call setProcessDocumentFn() first.');
    }

    try {
      await this.processDocumentFn(documentId, knowledgeBaseId);

      logger.info('Document processed successfully', {
        jobId: job.id,
        documentId,
        knowledgeBaseId,
      });

      return {
        documentId,
        knowledgeBaseId,
        status: 'completed',
        timestamp: new Date().toISOString(),
      };
    } catch (error: any) {
      logger.error('Document processing failed', {
        jobId: job.id,
        documentId,
        knowledgeBaseId,
        error: error.message,
        attempt: job.attemptsMade + 1,
      });

      throw error; // Re-throw to trigger retry mechanism
    }
  }
}

