# AUREX AI — self-hosted MusicGen CPU API

This runs the open MusicGen Small model on your own Linux VPS. It does not use the public Hugging Face Gradio page at generation time. CPU inference can be slow; there is no GPU acceleration.

## Requirements
- Ubuntu/Debian Linux, Python 3.10 or 3.11 recommended
- 8 GB+ RAM (16 GB+ recommended)
- Free disk space for Python packages and model weights (allow at least 5 GB)

## Install
Run from the repository folder:

```bash
sudo apt-get update
sudo apt-get install -y python3-venv python3-pip ffmpeg libsndfile1
cd /opt/aurex-music-ai
python3 -m venv .venv-music
source .venv-music/bin/activate
python -m pip install --upgrade pip
pip install -r requirements-music.txt
```

## Start (first launch downloads the model)
```bash
cd /opt/aurex-music-ai
source .venv-music/bin/activate
export MUSICGEN_CPU_THREADS=8
export MUSICGEN_MAX_SECONDS=8
uvicorn music_api:app --host 0.0.0.0 --port 8091
```

Keep the process running during the first test. Model download and startup may take several minutes. Check:
```bash
curl http://127.0.0.1:8091/health
```

Generate a test track:
```bash
curl -X POST http://127.0.0.1:8091/api/music \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"Epic cinematic orchestral fantasy soundtrack with powerful drums","seconds":4}' \
  --output /tmp/aurex-test.wav
file /tmp/aurex-test.wav
```

## Important deployment notes
- Do not expose port 8091 publicly without a firewall, reverse proxy/TLS, and abuse protection. Prefer a reverse proxy on HTTPS and restrict the backend to that proxy.
- Configure `CORS_ORIGINS` to your exact GitHub Pages origin if needed.
- This is an experimental CPU endpoint, not production-hardened. It serializes generation to avoid exhausting RAM/CPU.
- Model weights are downloaded from Hugging Face on first startup. This does not embed or call the public Gradio Space.
- A small CPU-only model may take a long time per clip. This does not promise unlimited or instant generation.
