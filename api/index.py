from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import httpx
import os
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
    try:
        # Communicates with the Ollama instance at the provided IP
        response = await app.state.client.post(
            f"{OLLAMA_URL}/api/generate", 
            json={
                "model": "llama3.2:1b", # Updated model name
                "prompt": request.prompt,
                "stream": False
            }
        )
        print(f"Debug: Ollama response status: {response.status_code}")
        response.raise_for_status()
        return response.json()
    except httpx.RequestError as e:
        print(f"Debug: RequestError: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error connecting to LLM: {str(e)}")
    except Exception as e:
        print(f"Debug: Exception: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))
