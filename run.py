# run.py
import os
import sys
import uvicorn

# Ensure project root is in sys.path (fixes multiprocessing imports on Windows)
ROOT = os.path.dirname(os.path.abspath(__file__))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="127.0.0.1", port=8000, reload=True)