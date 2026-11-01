import os
import io
import threading
from contextlib import asynccontextmanager

import numpy as np
import soundfile as sf
import torch
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from transformers import AutoProcessor, MusicgenForConditionalGeneration

MODEL_ID = os.getenv("MUSICGEN_MODEL", "facebook/musicgen-small")
MAX_SECONDS = int(os.getenv("MUSICGEN_MAX_SECONDS", "8"))
CPU_THREADS = int(os.getenv("MUSICGEN_CPU_THREADS", str(min(os.cpu_count() or 4, 8))))
torch.set_num_threads(max(1, CPU_THREADS))
generation_lock = threading.Lock()
processor = None
model = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    global processor, model
    processor = AutoProcessor.from_pretrained(MODEL_ID)
    model = MusicgenForConditionalGeneration.from_pretrained(MODEL_ID)
    model.eval()
    yield
    model = None
    processor = None

app = FastAPI(title="AUREX Music API", version="0.1.0", lifespan=lifespan)
origins = [x.strip() for x in os.getenv(
    "CORS_ORIGINS",
    "https://notgamershubh.github.io,http://localhost:8000,http://127.0.0.1:8000"
).split(",") if x.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type"],
)

class GenerateRequest(BaseModel):
    prompt: str = Field(min_length=5, max_length=500)
    seconds: int = Field(default=8, ge=4, le=8)

@app.get("/health")
def health():
    return {
        "ok": True,
        "model": MODEL_ID,
        "device": "cpu",
        "loaded": model is not None,
        "model_loaded": model is not None,
        "max_seconds": MAX_SECONDS,
    }

@app.post("/api/music")
def generate_music(body: GenerateRequest):
    if model is None or processor is None:
        raise HTTPException(status_code=503, detail="Music model is still loading. Try again shortly.")
    if not generation_lock.acquire(blocking=False):
        raise HTTPException(status_code=429, detail="A track is already being generated. Please wait.")
    try:
        seconds = min(body.seconds, MAX_SECONDS)
        inputs = processor(text=[body.prompt.strip()], padding=True, return_tensors="pt")
        # MusicGen uses 50 autoregressive audio tokens per second.
        max_new_tokens = seconds * 50
        with torch.inference_mode():
            audio_values = model.generate(
                **inputs,
                do_sample=True,
                guidance_scale=3,
                max_new_tokens=max_new_tokens,
            )
        audio = audio_values[0, 0].detach().cpu().float().numpy()
        audio = np.nan_to_num(audio)
        peak = float(np.max(np.abs(audio))) if audio.size else 0.0
        if peak > 1.0:
            audio = audio / peak
        sample_rate = int(model.config.audio_encoder.sampling_rate)
        output = io.BytesIO()
        sf.write(output, audio, sample_rate, format="WAV", subtype="PCM_16")
        output.seek(0)
        headers = {
            "Content-Disposition": 'attachment; filename="aurex-track.wav"',
            "X-Aurex-Sample-Rate": str(sample_rate),
            "Cache-Control": "no-store",
        }
        return StreamingResponse(output, media_type="audio/wav", headers=headers)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Music generation failed: {type(exc).__name__}: {str(exc)[:300]}")
    finally:
        generation_lock.release()
