# Screenwriter AI Service (Python)

Python implementation of the AI service using FastAPI, running alongside the Node.js version for testing.

## Setup

1. **Install dependencies:**
   ```bash
   pip install -r requirements.txt
   ```

2. **Configure environment:**
   ```bash
   cp .env.example .env
   # Edit .env and add your OPENAI_API_KEY
   ```

3. **Run the service:**
   ```bash
   python main.py
   ```
   
   Or with uvicorn directly:
   ```bash
   uvicorn main:app --host 0.0.0.0 --port 3002 --reload
   ```

## Configuration

- **PORT**: Server port (default: 3002 for testing alongside Node.js on 3001)
- **OPENAI_API_KEY**: Your OpenAI API key
- **EDIT_LOOP_ENABLED**: Enable the Cursor-like explicit edit loop (default: `1`).
  - Set to `0`/`false` to fall back to the legacy graph-based edit flow.

## Edit mode streaming

- **Typed events (default)**: In `mode="edit"`, the server streams typed JSON events (status/decision/tool/apply/final).
- **Legacy compatibility**: Send `streamEvents=false` in the `/api/chat` request to force:
  - plain-text progress lines, then
  - a single final raw JSON payload: `{\"edits\":[...]}`.

## Endpoints

- `GET /api/health` - Health check and configuration status
- `POST /api/complete` - Streaming inline completion
- `POST /api/chat` - Streaming chat (supports 'ask' and 'edit' modes)
- `POST /api/command` - Non-streaming command execution

## Testing

The service runs on port 3002 by default. To test:

1. Start the Python service: `python main.py`
2. Update `src/services/aiClient.ts` to use port 3002:
   ```typescript
   const API_BASE = 'http://localhost:3002/api';
   ```
3. Test all AI features in the frontend
4. Once verified, switch to port 3001 and stop Node.js service

## Migration Path

1. **Initial testing**: Run on port 3002 alongside Node.js (port 3001)
2. **Verification**: Test all features work correctly
3. **Production**: 
   - Set `PORT=3001` in `.env`
   - Stop Node.js service
   - Update frontend `aiClient.ts` back to port 3001
   - Restart Python service

