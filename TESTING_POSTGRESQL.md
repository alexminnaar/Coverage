# Testing PostgreSQL Integration

This guide explains how to test the new PostgreSQL integration for the AI service graph nodes.

## Prerequisites

1. **PostgreSQL running**: Either via Docker Compose or locally
2. **Project in database**: You need at least one screenplay saved to the database
3. **Environment variables**: Database connection configured

## Quick Test

### 1. Check Health Endpoint

```bash
curl http://localhost:3002/api/health
```

Expected response:
```json
{
  "status": "ok",
  "configured": true,
  "database_connected": true
}
```

If `database_connected` is `false` or `null`, check your database configuration.

### 2. Run Test Script

```bash
cd server-python
python test_db_integration.py [project_id]
```

The script will:
- ✅ Test database connection
- ✅ Query elements by search terms
- ✅ Extract element context
- ✅ Verify element IDs
- ✅ Simulate full edit flow

**To get a project_id:**
- Open the app and check browser console
- Or query database: `SELECT id FROM projects LIMIT 1;`

## Manual Testing

### Test 1: Database Connection

1. Start the AI service:
   ```bash
   cd server-python
   python main.py
   ```

2. Check logs for:
   ```
   ✅ Database connection pool created
   ```

3. If you see:
   ```
   ⚠️  Database connection failed: ...
   ```
   Check your environment variables.

### Test 2: Edit Mode with Database

1. **Open the app** and create/open a screenplay
2. **Save the screenplay** (so it's in the database)
3. **Open AI Chat** and switch to "Edit" mode
4. **Send a test message** like:
   - "Make John's dialogue more dramatic"
   - "Find all scenes with Sarah"
   - "Improve the action lines in scene 3"

5. **Watch the console logs** for:
   ```
   [Locating] Found X relevant elements
   [Loading Context] Extracted X elements from database
   ```

6. **Check the response** - it should:
   - Be faster (less context sent to LLM)
   - Only include relevant elements
   - Still produce accurate edits

### Test 3: Verify Database Queries

1. **Open browser DevTools** → Network tab
2. **Send an edit request** in AI Chat
3. **Check the request payload** - `projectId` should be included
4. **Check the response** - should stream intermediate results:
   ```
   [Planning] Analyzing intent...
   [Locating] Found 5 relevant elements
   [Loading Context] Extracted 15 elements from database
   ...
   ```

### Test 4: Fallback Mode

To test fallback (when DB is unavailable):

1. **Stop PostgreSQL**:
   ```bash
   docker-compose stop postgres
   ```

2. **Send an edit request** - should still work using full screenplay string

3. **Check logs** for:
   ```
   ⚠️  Database connection failed: ...
   [Loading Context] Extracted relevant context (fallback mode)
   ```

4. **Restart PostgreSQL**:
   ```bash
   docker-compose start postgres
   ```

## Docker Compose Testing

If using Docker Compose:

1. **Update docker-compose.yml** (already done):
   ```yaml
   ai-service:
     environment:
       DATABASE_URL: postgresql://...
       DB_HOST: postgres
       # ... other DB vars
   ```

2. **Restart services**:
   ```bash
   docker-compose restart ai-service
   ```

3. **Check logs**:
   ```bash
   docker-compose logs ai-service | grep -i database
   ```

## Expected Behavior

### ✅ Success Indicators

- Health endpoint shows `database_connected: true`
- Edit mode queries find relevant elements
- Context extraction returns focused results
- Response times are faster (less tokens)
- Intermediate results show database operations

### ❌ Failure Indicators

- Health endpoint shows `database_connected: false`
- Logs show connection errors
- Edit mode falls back to full screenplay
- No intermediate results streamed

## Troubleshooting

### Database Connection Fails

**Check environment variables:**
```bash
# In server-python/.env or docker-compose.yml
DATABASE_URL=postgresql://user:pass@host:5432/dbname
# OR
DB_HOST=postgres
DB_PORT=5432
DB_NAME=screenwriter
DB_USER=screenwriter
DB_PASSWORD=screenwriter
```

**Test connection manually:**
```bash
psql postgresql://screenwriter:screenwriter@localhost:5432/screenwriter
```

### No Elements Found

- **Check project_id**: Make sure it's a valid UUID from the database
- **Check screenplay**: Ensure it has elements saved
- **Check search terms**: Try common terms like character names, "INT.", "EXT."

### Fallback Mode Always Active

- Database connection might be failing silently
- Check logs for connection errors
- Verify network connectivity (if using Docker)
- Ensure PostgreSQL is running and accessible

## Performance Comparison

### Before (Full Screenplay)
- **Context size**: ~50-500KB (entire screenplay)
- **Tokens**: ~10,000-100,000 tokens
- **Query time**: N/A (no DB query)
- **LLM processing**: Slower (more tokens)

### After (Database Queries)
- **Context size**: ~5-20KB (relevant elements only)
- **Tokens**: ~1,000-5,000 tokens
- **Query time**: ~50-200ms (PostgreSQL JSONB)
- **LLM processing**: Faster (fewer tokens)

**Expected improvement**: 80-90% reduction in tokens, 2-5x faster responses

## Next Steps

Once testing is complete:

1. ✅ Verify database queries work
2. ✅ Confirm fallback mode works
3. ✅ Check performance improvements
4. ✅ Monitor logs for any issues
5. ✅ Test with large screenplays (1000+ elements)

