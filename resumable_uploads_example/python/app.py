from flask import Flask, render_template, request, abort, jsonify
from pathlib import Path
from datetime import datetime, timedelta
import shutil

app = Flask(__name__)
app.config.from_mapping(
    UPLOAD_ROOT=Path(__file__).parent.parent / "uploads",
    CHUNK_TTL_HOURS=6,
    VERIFY_UPLOADS=False,
)

# Set-Create uploads directory
upload_root = app.config['UPLOAD_ROOT']
upload_root.mkdir(parents=True, exist_ok=True)

# Set-Create temp directory
temp_root = upload_root / "temp"
temp_root.mkdir(parents=True, exist_ok=True)

def cleanup_temp_files():
    temp_root = app.config['UPLOAD_ROOT'] / "temp"
    if not temp_root.exists():
        return
    now = datetime.now()
    for d in temp_root.iterdir():
        if d.is_dir() and now - datetime.fromtimestamp(d.stat().st_mtime) > timedelta(hours=app.config['CHUNK_TTL_HOURS']):
            shutil.rmtree(d, ignore_errors=True)
            app.logger.debug(f"Removed old temp directory: {d}")

def chunk_path(identifier: str, filename: str, chunk_number: int) -> Path:
    d = app.config['UPLOAD_ROOT'] / "temp" / identifier
    d.mkdir(parents=True, exist_ok=True)
    return d / f"{filename}.part{chunk_number:03d}"

def verify_file_integrity(path: Path, expected_size: int) -> bool:
    if not path.exists():
        app.logger.error(f"Integrity check failed: {path} does not exist")
        return False
    actual = path.stat().st_size
    if actual != expected_size:
        app.logger.error(f"Integrity check failed for {path}: expected {expected_size}, got {actual}")
        return False
    app.logger.debug(f"File integrity verified for {path}")
    return True

@app.route("/")
def index():
    cleanup_temp_files()
    return render_template("index.html")

@app.route("/resumable_upload", methods=["GET"])
def resumable_get():
    identifier = request.args.get('resumableIdentifier')
    filename   = request.args.get('resumableFilename')
    chunk_str  = request.args.get('resumableChunkNumber')

    if not identifier or not filename:
        return jsonify(status="error", message="Missing parameters"), 400

    final_path = app.config['UPLOAD_ROOT'] / filename
    if final_path.exists():
        # Final file already assembled
        return jsonify(status="complete", size=final_path.stat().st_size)

    if chunk_str:
        # Check for the existence of a single chunk
        try:
            n = int(chunk_str)
        except ValueError:
            abort(400, "Invalid chunk number")
        p = chunk_path(identifier, filename, n)
        if p.exists():
            return "OK"
        else:
            abort(404)
    else:
        # No chunkNumber? Return overall upload status
        temp_dir = app.config['UPLOAD_ROOT'] / "temp" / identifier
        if temp_dir.exists():
            count = sum(1 for _ in temp_dir.iterdir() if _.is_file())
            return jsonify(status="in_progress", chunks_present=count)
        # Return 200 with not_found status instead of 404 to avoid browser console errors
        return jsonify(status="not_found")

@app.route("/resumable_upload", methods=["POST"])
def resumable_post():
    identifier    = request.form.get('resumableIdentifier')
    filename      = request.form.get('resumableFilename')
    chunk_number  = request.form.get('resumableChunkNumber', type=int)
    total_chunks  = request.form.get('resumableTotalChunks', type=int)
    total_size    = request.form.get('resumableTotalSize', type=int)
    upload_file   = request.files.get('file')

    if not all([identifier, filename, chunk_number, total_chunks, upload_file]):
        abort(400, "Missing parameters or file part")

    # Save the incoming chunk
    chunk_file = chunk_path(identifier, filename, chunk_number)
    upload_file.save(chunk_file)

    # If all chunks are present, assemble them
    parts = [chunk_path(identifier, filename, i) for i in range(1, total_chunks + 1)]
    if all(p.exists() for p in parts):
        final_path = app.config['UPLOAD_ROOT'] / filename
        final_path.parent.mkdir(parents=True, exist_ok=True)
        try:
            with final_path.open("wb") as out:
                for p in parts:
                    out.write(p.read_bytes())
                    p.unlink()
            # Clean up the temp directory
            shutil.rmtree(app.config['UPLOAD_ROOT'] / "temp" / identifier, ignore_errors=True)

            # Optional size verification
            if app.config['VERIFY_UPLOADS'] and total_size:
                if verify_file_integrity(final_path, total_size):
                    app.logger.debug(f"Assembled file verified: {final_path}")
                else:
                    app.logger.warning(f"Assembled file size mismatch: {final_path}")
        except Exception as e:
            app.logger.error(f"Error assembling chunks: {e}")

    return "OK"
