#!/usr/bin/env tsx
/**
 * Script para crear el primer usuario administrador
 * 
 * Uso:
 *   pnpm --filter @cortex/api-service exec tsx scripts/create-admin-user.ts <username> <password> [email] [full_name]
 * 
 * Ejemplo:
 *   pnpm --filter @cortex/api-service exec tsx scripts/create-admin-user.ts admin Admin123! admin@example.com "Admin User"
 */

import { Pool } from 'pg';
import bcrypt from 'bcrypt';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

// Load environment variables from multiple possible locations
const envPaths = [
  path.join(__dirname, '../../../.env'), // Root of project
  path.join(__dirname, '../../.env'),   // backend/.env
  path.join(__dirname, '../.env'),       // backend/api-service/.env
];

for (const envPath of envPaths) {
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
    break;
  }
}

// Also try to load from process.env directly (if set)

const SALT_ROUNDS = 10;

async function createAdminUser() {
  const args = process.argv.slice(2);
  
  if (args.length < 2) {
    console.error('❌ Error: Se requieren username y password');
    console.log('');
    console.log('Uso:');
    console.log('  pnpm --filter @cortex/api-service exec tsx scripts/create-admin-user.ts <username> <password> [email] [full_name]');
    console.log('');
    console.log('Ejemplo:');
    console.log('  pnpm --filter @cortex/api-service exec tsx scripts/create-admin-user.ts admin Admin123! admin@example.com "Admin User"');
    process.exit(1);
  }

  const username = args[0];
  const password = args[1];
  const email = args[2] || null;
  const full_name = args[3] || null;

  if (password.length < 8) {
    console.error('❌ Error: La contraseña debe tener al menos 8 caracteres');
    process.exit(1);
  }

  // Get database connection
  // Allow DATABASE_URL to be passed as environment variable or use default
  let databaseUrl = process.env.DATABASE_URL;
  
  // If not set, use the provided default or check for common patterns
  if (!databaseUrl) {
    // Try to construct from individual components if available
    const dbHost = process.env.DB_HOST || 'localhost';
    const dbPort = process.env.DB_PORT || '5432';
    const dbName = process.env.DB_NAME || 'cortexagenthub';
    const dbUser = process.env.DB_USER || 'postgres';
    const dbPassword = process.env.DB_PASSWORD;
    
    if (dbPassword) {
      databaseUrl = `postgresql://${dbUser}:${dbPassword}@${dbHost}:${dbPort}/${dbName}`;
    } else {
      // Use the provided default
      databaseUrl = 'postgresql://postgres:cial1997@localhost:5432/cortexagenthub';
      console.log('⚠️  DATABASE_URL no encontrada, usando configuración por defecto');
    }
  }
  
  console.log(`📦 Conectando a: ${databaseUrl.replace(/:[^:@]*@/, ':****@')}`);

  const db = new Pool({
    connectionString: databaseUrl,
  });

  try {
    console.log('🔐 Creando usuario administrador...');
    console.log(`   Username: ${username}`);
    console.log(`   Email: ${email || 'N/A'}`);
    console.log(`   Full Name: ${full_name || 'N/A'}`);

    // Check if user already exists
    const existingUser = await db.query(
      'SELECT id, username FROM admin_users WHERE username = $1',
      [username]
    );

    if (existingUser.rows.length > 0) {
      console.error(`❌ Error: El usuario "${username}" ya existe`);
      process.exit(1);
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    // Insert user
    const result = await db.query(
      `INSERT INTO admin_users (username, password_hash, email, full_name, is_active)
       VALUES ($1, $2, $3, $4, true)
       RETURNING id, username, email, full_name, is_active, created_at`,
      [username, passwordHash, email, full_name]
    );

    const user = result.rows[0];
    console.log('');
    console.log('✅ Usuario administrador creado exitosamente!');
    console.log(`   ID: ${user.id}`);
    console.log(`   Username: ${user.username}`);
    console.log(`   Email: ${user.email || 'N/A'}`);
    console.log(`   Full Name: ${user.full_name || 'N/A'}`);
    console.log(`   Active: ${user.is_active}`);
    console.log(`   Created: ${user.created_at}`);
    console.log('');
    console.log('💡 Ahora puedes iniciar sesión con estas credenciales en el panel de administración');
  } catch (error: any) {
    console.error('❌ Error al crear usuario:', error.message);
    if (error.code === '42P01') {
      console.error('');
      console.error('⚠️  La tabla admin_users no existe. Ejecuta la migración primero:');
      console.error('   psql -d <database> -f backend/packages/database/migrations/012_admin_users.sql');
    }
    process.exit(1);
  } finally {
    await db.end();
  }
}

createAdminUser();

