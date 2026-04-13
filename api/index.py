from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import httpx
import os
import json
from contextlib import asynccontextmanager

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: Create client
    app.state.client = httpx.AsyncClient(timeout=720.0)
    yield
    # Shutdown: Close client
    await app.state.client.aclose()

app = FastAPI(lifespan=lifespan)

# Add CORS middleware to allow the frontend to communicate with the backend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # In production, restrict this to your actual frontend URL
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Use environment variable for Ollama host, fallback to user provided IP
OLLAMA_URL = os.getenv("OLLAMA_URL", "http://127.0.0.1:11434")

class ChatRequest(BaseModel):
    prompt: str

@app.get("/health")
async def health_check():
    return {"status": "ok", "message": "Backend is running"}

@app.post("/api/chat")
async def chat(request: ChatRequest):
    print(f"Debug: Connecting to Ollama at {OLLAMA_URL}")
    
    async def generate():
        try:
            async with app.state.client.stream(
                "POST",
                f"{OLLAMA_URL}/api/generate",
                json={
                    "model": "llama3.2:1b",
                    "prompt": request.prompt,
                    "stream": True
                }
            ) as response:
                response.raise_for_status()
                async for line in response.aiter_lines():
                    if line:
                        chunk = json.loads(line)
                        if "response" in chunk:
                            yield chunk["response"]
                        if chunk.get("done"):
                            break
        except Exception as e:
            print(f"Debug: Streaming Error: {str(e)}")
            yield f"Error: {str(e)}"

    return StreamingResponse(generate(), media_type="text/plain")
