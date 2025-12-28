# Docker Setup for Screenwriter

This project now includes Docker Compose configuration for running the entire application stack.

## Prerequisites

- Docker
- Docker Compose

## Quick Start

1. **Create environment file** (optional, defaults are provided):
   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

2. **Start all services**:
   ```bash
   docker-compose up -d
   ```

3. **Access the application**:
   - Frontend: http://localhost:5173
   - Backend API: http://localhost:3001
   - PostgreSQL: localhost:5432

## Services

### PostgreSQL Database
- **Container**: `screenwriter-db`
- **Port**: 5432
- **Data**: Persisted in Docker volume `postgres_data`
- **Auto-initialization**: Schema is automatically created from `server/db/init.sql`

### Backend API
- **Container**: `screenwriter-backend`
- **Port**: 3001
- **Environment**: Node.js with TypeScript (tsx)
- **Endpoints**: 
  - `/api/projects` - Project CRUD operations
  - `/api/writing` - Writing goals and sessions
  - `/api/health` - Health check

### Frontend
- **Container**: `screenwriter-frontend`
- **Port**: 5173 (mapped to container port 80)
- **Build**: Production build with Nginx

## Environment Variables

Key environment variables (with defaults):

- `DB_HOST=postgres`
- `DB_PORT=5432`
- `DB_NAME=screenwriter`
- `DB_USER=screenwriter`
- `DB_PASSWORD=screenwriter`
- `OPENAI_API_KEY` - Optional, for AI features
- `VITE_API_BASE_URL` - Frontend API endpoint

## Development Mode

For development, you may want to run services individually:

```bash
# Start only database
docker-compose up -d postgres

# Run backend locally
cd server
npm install
npm run dev

# Run frontend locally
npm install
npm run dev
```

## Database Access

To access the PostgreSQL database directly:

```bash
docker-compose exec postgres psql -U screenwriter -d screenwriter
```

## Troubleshooting

1. **Database connection issues**: Ensure PostgreSQL container is healthy:
   ```bash
   docker-compose ps
   ```

2. **Port conflicts**: Change ports in `docker-compose.yml` if 3001, 5173, or 5432 are in use

3. **Reset database**: 
   ```bash
   docker-compose down -v
   docker-compose up -d
   ```

4. **View logs**:
   ```bash
   docker-compose logs -f [service-name]
   ```

## Migration from localStorage

The application automatically detects if the API is available and uses it. If the API is unavailable, it falls back to localStorage. To force API mode:

1. Ensure all services are running
2. The frontend will automatically detect and use the API
3. Existing localStorage data can be manually migrated by exporting/importing projects

