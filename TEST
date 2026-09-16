#!/usr/bin/env bash

# Salir inmediatamente si algún comando falla
set -e

echo "🚀 Iniciando pruebas locales (CI replica)..."
echo "==========================================="

echo "📦 1. Instalando dependencias (si es necesario)..."
pnpm install

echo -e "\n🧪 2. Ejecutando tests de lógica (Vitest)..."
pnpm test

echo -e "\n🔍 3. Ejecutando verificación de tipos (Typecheck)..."
pnpm typecheck

echo -e "\n🧹 4. Ejecutando linter..."
pnpm lint

echo -e "\n🏗️  5. Construyendo la aplicación (Build)..."
pnpm build

# Con el stack local levantado (pnpm supabase start y pnpm dev:functions),
# el job "database" del CI equivale a: pnpm test:sql && pnpm test:orders:integration

echo -e "\n==========================================="
echo "✅ ¡Todo perfecto! Los tests pasaron exitosamente y no se rompió nada."
