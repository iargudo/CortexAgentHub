#!/usr/bin/env tsx
/**
 * Script para analizar el uso de tablas en el código
 * Verifica qué tablas están siendo referenciadas en el código fuente
 */

import { Pool } from 'pg';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
import { execSync } from 'child_process';

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const LOCAL_DB_URL = process.env.DATABASE_URL || 'postgresql://postgres:cial1997@localhost:5432/cortexagenthub';

interface TableUsage {
  tableName: string;
  usedInCode: boolean;
  references: string[];
  repositoryExists: boolean;
  serviceExists: boolean;
  controllerExists: boolean;
  migrationExists: boolean;
}

/**
 * Get all tables from database
 */
async function getTables(pool: Pool): Promise<string[]> {
  const result = await pool.query(`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public' 
    AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `);
  return result.rows.map((row) => row.table_name);
}

/**
 * Search for table references in codebase
 */
function searchTableInCode(tableName: string, projectRoot: string): { found: boolean; references: string[] } {
  const references: string[] = [];
  
  // Search patterns
  const patterns = [
    `FROM ${tableName}`,
    `INTO ${tableName}`,
    `UPDATE ${tableName}`,
    `DELETE FROM ${tableName}`,
    `INSERT INTO ${tableName}`,
    `SELECT.*FROM ${tableName}`,
    `table_name.*=.*['"]${tableName}['"]`,
    `tableName.*=.*['"]${tableName}['"]`,
    `'${tableName}'`,
    `"${tableName}"`,
    `\`${tableName}\``,
  ];

  try {
    // Search in backend code
    const backendDirs = [
      'backend/api-service/src',
      'backend/packages/database/src',
      'backend/packages/core/src',
      'backend/packages/channel-adapters/src',
      'backend/packages/llm-gateway/src',
    ];

    for (const dir of backendDirs) {
      const fullPath = path.join(projectRoot, dir);
      if (!fs.existsSync(fullPath)) continue;

      for (const pattern of patterns) {
        try {
          const result = execSync(
            `grep -r -l --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" "${pattern}" "${fullPath}" 2>/dev/null || true`,
            { encoding: 'utf-8', cwd: projectRoot }
          );
          
          if (result.trim()) {
            const files = result.trim().split('\n').filter(f => f);
            files.forEach(file => {
              if (!references.includes(file)) {
                references.push(file);
              }
            });
          }
        } catch (e) {
          // Ignore errors
        }
      }
    }
  } catch (error) {
    // Ignore errors
  }

  return {
    found: references.length > 0,
    references: references.slice(0, 10), // Limit to 10 references
  };
}

/**
 * Check if repository exists for table
 */
function checkRepository(tableName: string, projectRoot: string): boolean {
  const repoPath = path.join(projectRoot, 'backend/packages/database/src/repositories');
  const repoFile = `${tableName.replace(/_/g, '')}Repository.ts`;
  const repoFileAlt = `${tableName}Repository.ts`;
  
  const files = fs.readdirSync(repoPath).filter(f => f.endsWith('.ts'));
  return files.some(f => 
    f.toLowerCase().includes(tableName.toLowerCase().replace(/_/g, '')) ||
    f.toLowerCase().includes(tableName.toLowerCase())
  );
}

/**
 * Check if service exists for table
 */
function checkService(tableName: string, projectRoot: string): boolean {
  const servicePath = path.join(projectRoot, 'backend/api-service/src/services');
  if (!fs.existsSync(servicePath)) return false;
  
  const files = fs.readdirSync(servicePath).filter(f => f.endsWith('.ts'));
  return files.some(f => 
    f.toLowerCase().includes(tableName.toLowerCase().replace(/_/g, '')) ||
    f.toLowerCase().includes(tableName.toLowerCase())
  );
}

/**
 * Check if controller exists for table
 */
function checkController(tableName: string, projectRoot: string): boolean {
  const controllerPath = path.join(projectRoot, 'backend/api-service/src/controllers');
  if (!fs.existsSync(controllerPath)) return false;
  
  const files = fs.readdirSync(controllerPath).filter(f => f.endsWith('.ts'));
  return files.some(f => 
    f.toLowerCase().includes(tableName.toLowerCase().replace(/_/g, '')) ||
    f.toLowerCase().includes(tableName.toLowerCase())
  );
}

/**
 * Check if migration exists for table
 */
function checkMigration(tableName: string, projectRoot: string): boolean {
  const migrationPath = path.join(projectRoot, 'backend/packages/database/migrations');
  if (!fs.existsSync(migrationPath)) return false;
  
  const files = fs.readdirSync(migrationPath).filter(f => f.endsWith('.sql'));
  return files.some(f => {
    try {
      const content = fs.readFileSync(path.join(migrationPath, f), 'utf-8');
      return content.includes(`CREATE TABLE`) && content.includes(tableName);
    } catch {
      return false;
    }
  });
}

/**
 * Main analysis function
 */
async function analyzeTableUsage() {
  console.log('🔍 Analizando uso de tablas en el código...\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const projectRoot = path.resolve(__dirname, '../../../');
  const pool = new Pool({ connectionString: LOCAL_DB_URL });

  try {
    // Test connection
    await pool.query('SELECT 1');
    console.log('✅ Conexión a base de datos exitosa\n');

    // Get all tables
    const tables = await getTables(pool);
    console.log(`📋 Encontradas ${tables.length} tablas en la base de datos\n`);

    const results: TableUsage[] = [];

    for (const tableName of tables) {
      console.log(`Analizando: ${tableName}...`);
      
      const codeSearch = searchTableInCode(tableName, projectRoot);
      const repositoryExists = checkRepository(tableName, projectRoot);
      const serviceExists = checkService(tableName, projectRoot);
      const controllerExists = checkController(tableName, projectRoot);
      const migrationExists = checkMigration(tableName, projectRoot);

      results.push({
        tableName,
        usedInCode: codeSearch.found || repositoryExists || serviceExists || controllerExists,
        references: codeSearch.references,
        repositoryExists,
        serviceExists,
        controllerExists,
        migrationExists,
      });
    }

    // Print results
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log('📊 RESULTADOS DEL ANÁLISIS:\n');

    const usedTables = results.filter(r => r.usedInCode);
    const unusedTables = results.filter(r => !r.usedInCode);

    console.log(`✅ Tablas USADAS en el código: ${usedTables.length}`);
    usedTables.forEach(t => {
      const indicators = [];
      if (t.repositoryExists) indicators.push('Repo');
      if (t.serviceExists) indicators.push('Service');
      if (t.controllerExists) indicators.push('Controller');
      if (t.migrationExists) indicators.push('Migration');
      console.log(`   ✓ ${t.tableName} [${indicators.join(', ')}]`);
    });

    console.log(`\n⚠️  Tablas NO USADAS en el código: ${unusedTables.length}`);
    unusedTables.forEach(t => {
      console.log(`   ✗ ${t.tableName}`);
    });

    // Detailed analysis
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log('📝 ANÁLISIS DETALLADO:\n');

    for (const result of results) {
      console.log(`\n📋 ${result.tableName}:`);
      console.log(`   Usado en código: ${result.usedInCode ? '✅' : '❌'}`);
      console.log(`   Repository: ${result.repositoryExists ? '✅' : '❌'}`);
      console.log(`   Service: ${result.serviceExists ? '✅' : '❌'}`);
      console.log(`   Controller: ${result.controllerExists ? '✅' : '❌'}`);
      console.log(`   Migration: ${result.migrationExists ? '✅' : '❌'}`);
      if (result.references.length > 0) {
        console.log(`   Referencias encontradas: ${result.references.length}`);
        result.references.slice(0, 3).forEach(ref => {
          console.log(`     - ${ref.replace(projectRoot, '')}`);
        });
      }
    }

    // Summary
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log('📊 RESUMEN:\n');
    console.log(`   Total de tablas: ${results.length}`);
    console.log(`   ✅ Tablas usadas: ${usedTables.length}`);
    console.log(`   ⚠️  Tablas no usadas: ${unusedTables.length}`);
    
    if (unusedTables.length > 0) {
      console.log('\n⚠️  NOTA: Las tablas no usadas pueden ser:');
      console.log('   - Tablas de estadísticas/vistas materializadas');
      console.log('   - Tablas para funcionalidades futuras');
      console.log('   - Tablas legacy que pueden ser eliminadas');
      console.log('   - Tablas usadas solo en migraciones/SQL directo');
    }

  } catch (error: any) {
    console.error('❌ Error durante el análisis:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Run analysis
analyzeTableUsage().catch((error) => {
  console.error('❌ Error fatal:', error);
  process.exit(1);
});

