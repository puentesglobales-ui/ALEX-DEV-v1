# Alex Azul v1 - Regenerado

Sistema de inteligencia conversacional con arquitectura hexagonal estricta.

## 🚀 Instalación Local

1. Instalar dependencias:
   ```bash
   npm install
   ```

2. Configurar variables de entorno:
   ```bash
   cp .env.example .env
   # Edita .env con tu OPENAI_API_KEY y DATABASE_URL
   ```

3. Ejecutar migraciones de base de datos:
   ```bash
   npx prisma migrate dev
   ```

4. Compilar el proyecto:
   ```bash
   npm run build
   ```

5. Iniciar servidor:
   ```bash
   npm start
   ```

## 🐳 Docker

Para levantar todo el stack:
```bash
docker-compose up --build
```

## ☁️ Despliegue en Render

1. Crea un nuevo **Web Service** en Render.
2. Conecta tu repositorio.
3. Configura las variables de entorno (`DATABASE_URL`, `OPENAI_API_KEY`, `API_KEY`).
4. Render usará el `Dockerfile` automáticamente.

## 🏗 Estructura Estricta

- `src/domain`: Entidades y servicios de dominio.
- `src/application`: Contratos y casos de uso.
- `src/infrastructure`: Implementaciones (Prisma, OpenAI, Costes).
- `src/main.ts`: Único punto de entrada e inyección de dependencias.
