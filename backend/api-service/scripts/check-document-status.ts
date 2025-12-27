#!/usr/bin/env tsx
/**
 * Script para verificar el estado de procesamiento de documentos en Knowledge Bases
 * Uso: pnpm tsx scripts/check-document-status.ts [document_id]
 */

import { Pool } from 'pg';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL no está configurada en las variables de entorno');
  process.exit(1);
}

async function checkDocumentStatus(documentId?: string) {
  const pool = new Pool({
    connectionString: DATABASE_URL,
  });

  try {
    console.log('🔍 Verificando estado de documentos...\n');

    if (documentId) {
      // Check specific document
      const docResult = await pool.query(
        `SELECT 
          d.id,
          d.title,
          d.file_name,
          d.status,
          d.error_message,
          d.created_at,
          d.updated_at,
          kb.name as kb_name,
          (SELECT COUNT(*) FROM knowledge_base_embeddings WHERE document_id = d.id) as embeddings_count
        FROM knowledge_base_documents d
        LEFT JOIN knowledge_bases kb ON d.knowledge_base_id = kb.id
        WHERE d.id = $1`,
        [documentId]
      );

      if (docResult.rows.length === 0) {
        console.log(`❌ Documento ${documentId} no encontrado`);
        process.exit(1);
      }

      const doc = docResult.rows[0];
      console.log('📄 Información del documento:');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log(`ID: ${doc.id}`);
      console.log(`Título: ${doc.title || doc.file_name || 'Sin título'}`);
      console.log(`Archivo: ${doc.file_name || 'N/A'}`);
      console.log(`Knowledge Base: ${doc.kb_name || 'N/A'}`);
      console.log(`Estado: ${doc.status}`);
      console.log(`Embeddings creados: ${doc.embeddings_count}`);
      console.log(`Creado: ${new Date(doc.created_at).toLocaleString()}`);
      console.log(`Actualizado: ${new Date(doc.updated_at).toLocaleString()}`);
      
      if (doc.error_message) {
        console.log(`\n❌ Error: ${doc.error_message}`);
      }

      if (doc.status === 'processing') {
        const timeDiff = Date.now() - new Date(doc.updated_at).getTime();
        const minutes = Math.floor(timeDiff / 60000);
        console.log(`\n⏳ Procesando desde hace: ${minutes} minutos`);
        
        if (minutes > 10) {
          console.log('⚠️  El proceso lleva más de 10 minutos. Puede estar bloqueado.');
        }
      }
    } else {
      // List all documents with their status
      const result = await pool.query(
        `SELECT 
          d.id,
          d.title,
          d.file_name,
          d.status,
          d.error_message,
          d.created_at,
          d.updated_at,
          kb.name as kb_name,
          (SELECT COUNT(*) FROM knowledge_base_embeddings WHERE document_id = d.id) as embeddings_count
        FROM knowledge_base_documents d
        LEFT JOIN knowledge_bases kb ON d.knowledge_base_id = kb.id
        ORDER BY d.created_at DESC
        LIMIT 20`
      );

      console.log('📋 Últimos 20 documentos:\n');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      
      for (const doc of result.rows) {
        const statusIcon = 
          doc.status === 'completed' ? '✅' :
          doc.status === 'processing' ? '⏳' :
          doc.status === 'failed' ? '❌' : '⏸️';
        
        const timeDiff = Date.now() - new Date(doc.updated_at).getTime();
        const minutes = Math.floor(timeDiff / 60000);
        
        console.log(`${statusIcon} ${(doc.title || doc.file_name || 'Sin título').substring(0, 40).padEnd(40)} | ${doc.status.padEnd(12)} | ${doc.embeddings_count} embeddings`);
        
        if (doc.status === 'processing' && minutes > 5) {
          console.log(`   ⚠️  Procesando desde hace ${minutes} minutos`);
        }
        
        if (doc.error_message) {
          console.log(`   ❌ Error: ${doc.error_message.substring(0, 80)}`);
        }
      }
    }

    // Check processing documents
    const processingResult = await pool.query(
      `SELECT COUNT(*) as count 
       FROM knowledge_base_documents 
       WHERE status = 'processing'`
    );
    
    const processingCount = parseInt(processingResult.rows[0].count, 10);
    
    if (processingCount > 0) {
      console.log(`\n⏳ Documentos en procesamiento: ${processingCount}`);
      
      const processingDocs = await pool.query(
        `SELECT 
          id,
          title,
          file_name,
          created_at,
          updated_at,
          (SELECT COUNT(*) FROM knowledge_base_embeddings WHERE document_id = knowledge_base_documents.id) as embeddings_count
        FROM knowledge_base_documents
        WHERE status = 'processing'
        ORDER BY updated_at ASC`
      );
      
      console.log('\n📊 Detalle de documentos en procesamiento:');
      for (const doc of processingDocs.rows) {
        const timeDiff = Date.now() - new Date(doc.updated_at).getTime();
        const minutes = Math.floor(timeDiff / 60000);
        const seconds = Math.floor((timeDiff % 60000) / 1000);
        console.log(`   - ${doc.title || doc.file_name || doc.id}: ${minutes}m ${seconds}s | ${doc.embeddings_count} embeddings`);
      }
    }

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  } catch (error: any) {
    console.error('❌ Error al verificar documentos:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

const documentId = process.argv[2];
checkDocumentStatus(documentId);

