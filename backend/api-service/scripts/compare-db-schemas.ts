#!/usr/bin/env tsx
/**
 * Script para comparar la estructura de las tablas entre la base de datos local y Azure
 * Uso: pnpm tsx scripts/compare-db-schemas.ts
 * 
 * NO HACE CAMBIOS, solo reporta diferencias
 */

import { Pool, QueryResult } from 'pg';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { execSync } from 'child_process';

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

interface TableColumn {
  table_name: string;
  column_name: string;
  data_type: string;
  is_nullable: string;
  column_default: string | null;
  character_maximum_length: number | null;
  numeric_precision: number | null;
  numeric_scale: number | null;
}

interface TableConstraint {
  table_name: string;
  constraint_name: string;
  constraint_type: string;
  column_name: string | null;
  foreign_table: string | null;
  foreign_column: string | null;
}

interface TableIndex {
  table_name: string;
  index_name: string;
  index_def: string;
  is_unique: boolean;
}

interface TableInfo {
  columns: TableColumn[];
  constraints: TableConstraint[];
  indexes: TableIndex[];
}

/**
 * Get Azure database connection string from Azure App Service
 */
function getAzureDatabaseUrl(): string {
  const RESOURCE_GROUP = process.env.AZURE_RESOURCE_GROUP || 'rg-cortexagenthub-stg-001';
  const APP_NAME = process.env.AZURE_APP_NAME || 'app-back-cortexagenthub-stg-001';

  try {
    console.log(`📡 Obteniendo DATABASE_URL de Azure App Service: ${APP_NAME}...`);
    
    const dbUrl = execSync(
      `az webapp config appsettings list --name "${APP_NAME}" --resource-group "${RESOURCE_GROUP}" --query "[?name=='DATABASE_URL'].value" -o tsv`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();

    if (!dbUrl) {
      throw new Error('No se pudo obtener DATABASE_URL de Azure');
    }

    console.log('✅ DATABASE_URL obtenida de Azure\n');
    return dbUrl;
  } catch (error: any) {
    console.error('❌ Error al obtener DATABASE_URL de Azure:', error.message);
    console.error('\n💡 Asegúrate de:');
    console.error('   1. Tener Azure CLI instalado (az)');
    console.error('   2. Estar autenticado (az login)');
    console.error('   3. Tener permisos para leer App Service settings');
    process.exit(1);
  }
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
 * Get table columns
 */
async function getTableColumns(pool: Pool, tableName: string): Promise<TableColumn[]> {
  const result = await pool.query(`
    SELECT 
      table_name,
      column_name,
      data_type,
      is_nullable,
      column_default,
      character_maximum_length,
      numeric_precision,
      numeric_scale
    FROM information_schema.columns
    WHERE table_schema = 'public' 
    AND table_name = $1
    ORDER BY ordinal_position
  `, [tableName]);
  return result.rows;
}

/**
 * Get table constraints (primary keys, foreign keys, unique, check)
 */
async function getTableConstraints(pool: Pool, tableName: string): Promise<TableConstraint[]> {
  const result = await pool.query(`
    SELECT
      tc.table_name,
      tc.constraint_name,
      tc.constraint_type,
      kcu.column_name,
      ccu.table_name AS foreign_table,
      ccu.column_name AS foreign_column
    FROM information_schema.table_constraints AS tc
    LEFT JOIN information_schema.key_column_usage AS kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    LEFT JOIN information_schema.constraint_column_usage AS ccu
      ON ccu.constraint_name = tc.constraint_name
      AND ccu.table_schema = tc.table_schema
    WHERE tc.table_schema = 'public'
    AND tc.table_name = $1
    ORDER BY tc.constraint_type, tc.constraint_name
  `, [tableName]);
  return result.rows;
}

/**
 * Get table indexes
 */
async function getTableIndexes(pool: Pool, tableName: string): Promise<TableIndex[]> {
  const result = await pool.query(`
    SELECT
      t.relname AS table_name,
      i.relname AS index_name,
      pg_get_indexdef(i.oid) AS index_def,
      idx.indisunique AS is_unique
    FROM pg_class t
    JOIN pg_index idx ON t.oid = idx.indrelid
    JOIN pg_class i ON i.oid = idx.indexrelid
    WHERE t.relkind = 'r'
    AND t.relname = $1
    AND i.relname NOT LIKE 'pg_toast%'
    ORDER BY i.relname
  `, [tableName]);
  return result.rows;
}

/**
 * Get complete table info
 */
async function getTableInfo(pool: Pool, tableName: string): Promise<TableInfo> {
  const [columns, constraints, indexes] = await Promise.all([
    getTableColumns(pool, tableName),
    getTableConstraints(pool, tableName),
    getTableIndexes(pool, tableName),
  ]);

  return { columns, constraints, indexes };
}

/**
 * Format column type for comparison
 */
function formatColumnType(col: TableColumn): string {
  let type = col.data_type;
  
  if (col.character_maximum_length) {
    type += `(${col.character_maximum_length})`;
  } else if (col.numeric_precision !== null) {
    if (col.numeric_scale !== null) {
      type += `(${col.numeric_precision},${col.numeric_scale})`;
    } else {
      type += `(${col.numeric_precision})`;
    }
  }
  
  // Handle vector type (pgvector)
  if (type === 'USER-DEFINED') {
    // Try to get actual type name
    return 'vector'; // Simplified, but should work for comparison
  }
  
  return type;
}

/**
 * Compare two table infos
 */
function compareTableInfo(
  local: TableInfo,
  azure: TableInfo,
  tableName: string
): { differences: string[]; isIdentical: boolean } {
  const differences: string[] = [];
  let isIdentical = true;

  // Compare columns
  const localCols = new Map(local.columns.map((c) => [c.column_name, c]));
  const azureCols = new Map(azure.columns.map((c) => [c.column_name, c]));

  // Check for missing columns in Azure
  for (const [colName, localCol] of localCols) {
    if (!azureCols.has(colName)) {
      differences.push(`❌ Columna '${colName}' existe en LOCAL pero NO en AZURE`);
      isIdentical = false;
    } else {
      const azureCol = azureCols.get(colName)!;
      const localType = formatColumnType(localCol);
      const azureType = formatColumnType(azureCol);

      if (localType !== azureType) {
        differences.push(
          `⚠️  Columna '${colName}': tipo LOCAL='${localType}' vs AZURE='${azureType}'`
        );
        isIdentical = false;
      }

      if (localCol.is_nullable !== azureCol.is_nullable) {
        differences.push(
          `⚠️  Columna '${colName}': NULLABLE LOCAL='${localCol.is_nullable}' vs AZURE='${azureCol.is_nullable}'`
        );
        isIdentical = false;
      }

      // Compare defaults (simplified)
      const localDefault = localCol.column_default || 'NULL';
      const azureDefault = azureCol.column_default || 'NULL';
      if (localDefault !== azureDefault) {
        differences.push(
          `⚠️  Columna '${colName}': DEFAULT LOCAL='${localDefault}' vs AZURE='${azureDefault}'`
        );
        isIdentical = false;
      }
    }
  }

  // Check for extra columns in Azure
  for (const [colName] of azureCols) {
    if (!localCols.has(colName)) {
      differences.push(`⚠️  Columna '${colName}' existe en AZURE pero NO en LOCAL`);
      isIdentical = false;
    }
  }

  // Compare constraints (simplified - just count and types)
  const localConstraints = new Map(
    local.constraints.map((c) => [`${c.constraint_type}:${c.constraint_name}`, c])
  );
  const azureConstraints = new Map(
    azure.constraints.map((c) => [`${c.constraint_type}:${c.constraint_name}`, c])
  );

  for (const [key, localConstraint] of localConstraints) {
    if (!azureConstraints.has(key)) {
      differences.push(
        `⚠️  Constraint '${localConstraint.constraint_name}' (${localConstraint.constraint_type}) existe en LOCAL pero NO en AZURE`
      );
      isIdentical = false;
    }
  }

  for (const [key] of azureConstraints) {
    if (!localConstraints.has(key)) {
      const azureConstraint = azureConstraints.get(key)!;
      differences.push(
        `⚠️  Constraint '${azureConstraint.constraint_name}' (${azureConstraint.constraint_type}) existe en AZURE pero NO en LOCAL`
      );
      isIdentical = false;
    }
  }

  // Compare indexes (simplified - just count)
  if (local.indexes.length !== azure.indexes.length) {
    differences.push(
      `⚠️  Número de índices: LOCAL=${local.indexes.length} vs AZURE=${azure.indexes.length}`
    );
    isIdentical = false;
  }

  return { differences, isIdentical };
}

/**
 * Main comparison function
 */
async function compareSchemas() {
  console.log('🔍 Comparando estructuras de bases de datos...\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // Get local database URL
  const localDbUrl = process.env.DATABASE_URL;
  if (!localDbUrl) {
    console.error('❌ DATABASE_URL no está configurada en .env');
    process.exit(1);
  }

  // Get Azure database URL
  const azureDbUrl = getAzureDatabaseUrl();

  // Create connections
  const localPool = new Pool({ connectionString: localDbUrl });
  const azurePool = new Pool({ connectionString: azureDbUrl });

  try {
    // Test connections
    console.log('🔌 Probando conexiones...');
    await localPool.query('SELECT 1');
    console.log('✅ Conexión LOCAL exitosa');
    await azurePool.query('SELECT 1');
    console.log('✅ Conexión AZURE exitosa\n');

    // Get all tables
    console.log('📋 Obteniendo listas de tablas...');
    const localTables = await getTables(localPool);
    const azureTables = await getTables(azurePool);
    console.log(`   LOCAL: ${localTables.length} tablas`);
    console.log(`   AZURE: ${azureTables.length} tablas\n`);

    // Find common tables
    const allTables = new Set([...localTables, ...azureTables]);
    const commonTables = localTables.filter((t) => azureTables.includes(t));
    const onlyLocal = localTables.filter((t) => !azureTables.includes(t));
    const onlyAzure = azureTables.filter((t) => !localTables.includes(t));

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log('📊 RESUMEN DE TABLAS:\n');

    if (onlyLocal.length > 0) {
      console.log('❌ Tablas solo en LOCAL:');
      onlyLocal.forEach((t) => console.log(`   - ${t}`));
      console.log();
    }

    if (onlyAzure.length > 0) {
      console.log('⚠️  Tablas solo en AZURE:');
      onlyAzure.forEach((t) => console.log(`   - ${t}`));
      console.log();
    }

    if (commonTables.length === 0) {
      console.log('❌ No hay tablas en común entre LOCAL y AZURE');
      return;
    }

    console.log(`✅ Tablas en común: ${commonTables.length}\n`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // Compare each common table
    console.log('🔍 Comparando estructuras de tablas...\n');

    let totalDifferences = 0;
    let identicalTables = 0;
    let differentTables = 0;

    for (const tableName of commonTables.sort()) {
      console.log(`📋 Tabla: ${tableName}`);
      
      try {
        const [localInfo, azureInfo] = await Promise.all([
          getTableInfo(localPool, tableName),
          getTableInfo(azurePool, tableName),
        ]);

        const comparison = compareTableInfo(localInfo, azureInfo, tableName);

        if (comparison.isIdentical) {
          console.log(`   ✅ Estructura IDÉNTICA\n`);
          identicalTables++;
        } else {
          console.log(`   ⚠️  DIFERENCIAS ENCONTRADAS:\n`);
          comparison.differences.forEach((diff) => {
            console.log(`   ${diff}`);
          });
          console.log();
          differentTables++;
          totalDifferences += comparison.differences.length;
        }
      } catch (error: any) {
        console.log(`   ❌ Error al comparar: ${error.message}\n`);
        differentTables++;
      }
    }

    // Final summary
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log('📊 RESUMEN FINAL:\n');
    console.log(`   Tablas comparadas: ${commonTables.length}`);
    console.log(`   ✅ Tablas idénticas: ${identicalTables}`);
    console.log(`   ⚠️  Tablas con diferencias: ${differentTables}`);
    console.log(`   📝 Total de diferencias encontradas: ${totalDifferences}\n`);

    if (totalDifferences === 0 && onlyLocal.length === 0 && onlyAzure.length === 0) {
      console.log('✅ ¡Las estructuras de las bases de datos son IDÉNTICAS!\n');
    } else {
      console.log('⚠️  Se encontraron diferencias entre LOCAL y AZURE\n');
    }
  } catch (error: any) {
    console.error('❌ Error durante la comparación:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await localPool.end();
    await azurePool.end();
  }
}

// Run comparison
compareSchemas().catch((error) => {
  console.error('❌ Error fatal:', error);
  process.exit(1);
});

