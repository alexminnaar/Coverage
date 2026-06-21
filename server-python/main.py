import os
import json
from typing import Optional, List, Dict, Any
from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

# Load environment variables BEFORE any service imports (they read env vars at
# import time).
load_dotenv()

from models import (
    CompletionContext,
    ChatRequest,
    CommandRequest,
    HealthResponse,
    CommandResponse,
    BeatChatRequest,
)
from services.llm_service import llm_service

app = FastAPI(title="Screenwriter AI Server", version="1.0.0")

# CORS middleware - same origins as Node.js version
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:5174",
        "http://127.0.0.1:5173",
        "http://frontend:5173"
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
async def root():
    """Root endpoint with API information"""
    return {
        "name": "Screenwriter AI Server",
        "version": "1.0.0",
        "endpoints": [
            "GET  /api/health - Health check",
            "POST /api/complete - Inline completion (streaming)",
            "POST /api/chat - Chat messages (streaming)",
            "POST /api/beat-chat - Beat AI chat (streaming JSON ops)",
            "POST /api/command - Execute rewrite command",
        ]
    }


@app.get("/api/health", response_model=HealthResponse)
async def health():
    """Health check endpoint"""
    # Check database connection
    db_connected = None
    try:
        await llm_service._ensure_db_pool()
        if llm_service.db_pool:
            # Test query
            async with llm_service.db_pool.acquire() as conn:
                await conn.fetchval('SELECT 1')
            db_connected = True
        else:
            db_connected = False
    except Exception as e:
        print(f'Health check DB error: {e}')
        db_connected = False
    
    return {
        "status": "ok",
        "configured": llm_service.is_configured(),
        "database_connected": db_connected
    }


@app.post("/api/complete")
async def stream_completion(context: CompletionContext):
    """Inline completion (streaming)"""
    if not llm_service.is_configured():
        return JSONResponse(
            status_code=503,
            content={
                "error": "AI not configured",
                "message": "Add OPENAI_API_KEY to server/.env file"
            }
        )

    async def generate():
        try:
            async for chunk in llm_service.stream_completion(context):
                yield f"data: {json.dumps({'content': chunk})}\n\n"
            yield "data: [DONE]\n\n"
        except Exception as stream_error:
            yield f"data: {json.dumps({'error': str(stream_error)})}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive"
        }
    )


@app.post("/api/chat")
async def stream_chat(request: ChatRequest):
    """Chat response (streaming)"""
    if not llm_service.is_configured():
        return JSONResponse(
            status_code=503,
            content={
                "error": "AI not configured",
                "message": "Add OPENAI_API_KEY to server/.env file"
            }
        )

    # Convert Pydantic models to dict for LLM service
    messages = [{"role": msg.role, "content": msg.content} for msg in request.messages]

    async def generate():
        try:
            async for chunk in llm_service.stream_chat(
                messages,
                request.sceneContext,
                request.globalIndex,
                request.mode or 'ask',
                request.projectId,
                request.streamEvents,
                request.selectedElementId,
                request.selectedText,
                request.contextPolicy,
                request.contextElementIds,
                request.model,
            ):
                if request.streamEvents is False:
                    yield f"data: {json.dumps({'content': chunk})}\n\n"
                    continue

                try:
                    # Typed chat chunks are already app-level JSON events.
                    parsed = json.loads(chunk)
                    if isinstance(parsed, dict):
                        yield f"data: {json.dumps(parsed)}\n\n"
                    else:
                        yield f"data: {json.dumps({'type': 'text_delta', 'content': str(chunk)})}\n\n"
                except Exception:
                    yield f"data: {json.dumps({'type': 'text_delta', 'content': chunk})}\n\n"
            yield "data: [DONE]\n\n"
        except Exception as stream_error:
            if request.streamEvents is False:
                yield f"data: {json.dumps({'error': str(stream_error)})}\n\n"
            else:
                yield f"data: {json.dumps({'type': 'error', 'error': str(stream_error)})}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive"
        }
    )


@app.post("/api/beat-chat")
async def stream_beat_chat(request: BeatChatRequest):
    """Beat AI chat response (streaming JSON ops only)"""
    if not llm_service.is_configured():
        return JSONResponse(
            status_code=503,
            content={
                "error": "AI not configured",
                "message": "Add OPENAI_API_KEY to server/.env file"
            }
        )

    # Convert Pydantic models to dict for LLM service
    messages = [{"role": msg.role, "content": msg.content} for msg in request.messages]
    beats = [{"id": b.id, "title": b.title, "description": b.description, "actIndex": b.actIndex, "order": b.order, "color": b.color, "linkedSceneId": b.linkedSceneId} for b in request.beats]
    scenes = [{"id": s.id, "name": s.name} for s in (request.scenes or [])]

    async def generate():
        try:
            async for chunk in llm_service.stream_beat_chat(
                messages,
                beats,
                request.actNames,
                request.selectedBeatId,
                scenes,
                request.projectId,
                request.model,
            ):
                yield f"data: {json.dumps({'content': chunk})}\n\n"
            yield "data: [DONE]\n\n"
        except Exception as stream_error:
            yield f"data: {json.dumps({'error': str(stream_error)})}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive"
        }
    )


@app.post("/api/command", response_model=CommandResponse)
async def execute_command(request: CommandRequest):
    """Command execution (non-streaming)"""
    if not llm_service.is_configured():
        return JSONResponse(
            status_code=503,
            content={
                "error": "AI not configured",
                "message": "Add OPENAI_API_KEY to server/.env file"
            }
        )

    try:
        result = await llm_service.execute_command(request)
        return {"result": result}
    except Exception as error:
        print(f"Command error: {error}")
        raise HTTPException(
            status_code=500,
            detail="Failed to execute command"
        )


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", "3002"))
    uvicorn.run(app, host="0.0.0.0", port=port)
