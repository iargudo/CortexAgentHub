#!/usr/bin/env tsx
/**
 * Script para verificar si las tablas de Knowledge Bases existen en la base de datos
 * Uso: pnpm tsx scripts/check-kb-tables.ts
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

async function checkTables() {
  const pool = new Pool({
    connectionString: DATABASE_URL,
  });

  try {
    console.log('🔍 Verificando tablas de Knowledge Bases...\n');

    const requiredTables = [
      'embedding_models',
      'knowledge_bases',
      'knowledge_base_documents',
      'knowledge_base_embeddings',
      'flow_knowledge_bases',
      'rag_queries',
    ];

    const results: { table: string; exists: boolean; rowCount?: number }[] = [];

    for (const table of requiredTables) {
      try {
        // Check if table exists
        const tableCheck = await pool.query(
          `SELECT EXISTS (
            SELECT FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_name = $1
          )`,
          [table]
        );

        const exists = tableCheck.rows[0].exists;

        if (exists) {
          // Get row count
          const countResult = await pool.query(`SELECT COUNT(*) as count FROM ${table}`);
          const rowCount = parseInt(countResult.rows[0].count, 10);
          results.push({ table, exists: true, rowCount });
        } else {
          results.push({ table, exists: false });
        }
      } catch (error: any) {
        console.error(`Error checking table ${table}:`, error.message);
        results.push({ table, exists: false });
      }
    }

    // Check pgvector extension
    console.log('📊 Resultados:\n');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    let allExist = true;
    for (const result of results) {
      if (result.exists) {
        console.log(`✅ ${result.table.padEnd(30)} Existe (${result.rowCount || 0} filas)`);
      } else {
        console.log(`❌ ${result.table.padEnd(30)} NO EXISTE`);
        allExist = false;
      }
    }

    // Check pgvector extension
    console.log('\n🔌 Verificando extensión pgvector...\n');
    try {
      const extResult = await pool.query(
        `SELECT EXISTS (
          SELECT FROM pg_extension 
          WHERE extname = 'vector'
        )`
      );
      const vectorExists = extResult.rows[0].exists;
      
      if (vectorExists) {
        console.log('✅ pgvector extension está habilitada');
      } else {
        console.log('❌ pgvector extension NO está habilitada');
        console.log('   Necesitas ejecutar: CREATE EXTENSION IF NOT EXISTS vector;');
        allExist = false;
      }
    } catch (error: any) {
      console.log('⚠️  No se pudo verificar pgvector:', error.message);
    }

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    if (allExist) {
      console.log('✅ Todas las tablas existen. Knowledge Bases está listo para usar.');
    } else {
      console.log('❌ Faltan tablas o extensiones. Necesitas ejecutar las migraciones:');
      console.log('   1. packages/database/migrations/005_add_embeddings_table.sql');
      console.log('   2. packages/database/migrations/006_knowledge_bases_rag.sql');
      console.log('\n   Y habilitar pgvector en Azure PostgreSQL.');
      process.exit(1);
    }
  } catch (error: any) {
    console.error('❌ Error al verificar tablas:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

checkTables();

