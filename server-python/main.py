import os
import json
from typing import Optional, List, Dict, Any
from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

from models import (
    CompletionContext,
    ChatRequest,
    CommandRequest,
    HealthResponse,
    CommandResponse
)
from services.llm_service import llm_service

# Load environment variables
load_dotenv()

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
                request.mode or 'ask',
                request.projectId,
                request.streamEvents,
                request.selectedElementId,
                request.selectedText,
                request.contextPolicy,
                request.contextElementIds,
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


@app.post("/api/embed/project/{project_id}")
async def embed_project(project_id: str):
    """Compute/upsert embeddings for a single project (best-effort)."""
    if not llm_service.is_configured():
        raise HTTPException(status_code=503, detail="AI not configured")
    try:
        result = await llm_service.embed_project_elements(project_id)
        return {"status": "ok", **result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Embedding failed: {str(e)}")


@app.post("/api/embed/backfill")
async def embed_backfill(projectId: Optional[str] = None):
    """Backfill embeddings for one project or all projects (best-effort)."""
    if not llm_service.is_configured():
        raise HTTPException(status_code=503, detail="AI not configured")
    await llm_service._ensure_db_pool()
    if not llm_service.db_pool:
        raise HTTPException(status_code=500, detail="Database not available")

    try:
        project_ids: List[str] = []
        if projectId:
            project_ids = [projectId]
        else:
            async with llm_service.db_pool.acquire() as conn:
                rows = await conn.fetch("SELECT id::text AS id FROM projects ORDER BY updated_at DESC")
                project_ids = [r["id"] for r in rows]

        results: Dict[str, Any] = {}
        for pid in project_ids:
            results[pid] = await llm_service.embed_project_elements(pid)
        return {"status": "ok", "projects": len(project_ids), "results": results}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Backfill failed: {str(e)}")


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

