from fastapi import FastAPI, Request, UploadFile, File, HTTPException, Form
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
import aiofiles
import shutil
from pathlib import Path
from typing import Dict, Optional

app = FastAPI()
app.mount("/static", StaticFiles(directory="app/static"), name="static")
templates = Jinja2Templates(directory="app/templates")

class FileSystem:
    def __init__(self, base_dir: Path):
        self.base_dir = base_dir
        self.error_map = {
            'volume': (400, "Volume not mounted"),
            'path': (404, "Path not found"),
            'access': (403, "Access denied"),
            'exists': (400, "Item already exists"),
            'upload': (400, "No file uploaded")
        }

    def raise_error(self, key: str, detail: Optional[str] = None):
        code, msg = self.error_map[key]
        raise HTTPException(status_code=code, detail=detail or msg)

    def validate(self, path: Path, check_exists: bool = True, require_dir: bool = False) -> None:
        if not self.base_dir.exists():
            self.raise_error('volume')
        if check_exists and not path.exists():
            self.raise_error('path')
        if not str(path).startswith(str(self.base_dir)):
            self.raise_error('access')
        if require_dir and not path.is_dir():
            self.raise_error('path')

    def get_size(self, path: Path) -> int:
        try:
            return sum(f.stat().st_size for f in path.rglob('*') if f.is_file())
        except (PermissionError, OSError):
            return 0

    def count_files(self, path: Path) -> int:
        try:
            return sum(1 for _ in path.rglob('*') if _.is_file())
        except (PermissionError, OSError):
            return 0

    def get_contents(self, path: Path) -> Dict:
        self.validate(path, require_dir=True)
        contents = {"files": [], "folders": [], "path_parts": []}
        
        for item in path.iterdir():
            item_data = {"name": item.name}
            if item.is_file():
                item_data["size"] = item.stat().st_size
                contents["files"].append(item_data)
            else:
                item_data["file_count"] = self.count_files(item)
                contents["folders"].append(item_data)

        rel_path = path.relative_to(self.base_dir)
        contents["path_parts"] = str(rel_path).split('/') if str(rel_path) != '.' else []
        contents["total_size"] = self.get_size(path)
        return contents

    def search(self, query: str) -> Dict:
        results = {"files": [], "folders": []}
        if not self.base_dir.exists():
            return results

        def search_dir(path: Path, rel_path: str = ""):
            try:
                for item in path.iterdir():
                    item_rel_path = f"{rel_path}/{item.name}" if rel_path else item.name
                    if query.lower() in item.name.lower():
                        results["files" if item.is_file() else "folders"].append({
                            "name": item.name,
                            "path": item_rel_path
                        })
                    if item.is_dir():
                        search_dir(item, item_rel_path)
            except PermissionError:
                pass

        search_dir(self.base_dir)
        return results

    async def upload(self, file: UploadFile, path: Path) -> None:
        self.validate(path, require_dir=True)
        if not file:
            self.raise_error('upload')
        
        file_path = path / file.filename
        if file_path.exists():
            self.raise_error('exists')
        
        temp_path = file_path.with_suffix('.tmp')
        try:
            async with aiofiles.open(str(temp_path), 'wb') as out_file:
                await out_file.write(await file.read())
            temp_path.rename(file_path)
        except Exception as e:
            if temp_path.exists():
                temp_path.unlink()
            self.raise_error('access', str(e))

    def create_folder(self, path: Path) -> Dict:
        self.validate(path, require_dir=True)
        name = "Untitled Folder"
        counter = 1
        while (path / name).exists():
            name = f"Untitled Folder {counter}"
            counter += 1
        try:
            (path / name).mkdir()
            return {"message": f"Folder {name} created", "name": name}
        except Exception as e:
            self.raise_error('access', str(e))

    def rename(self, path: Path, old_name: str, new_name: str) -> Dict:
        self.validate(path, require_dir=True)
        old_path = path / old_name
        new_path = path / new_name
        self.validate(old_path)
        if new_path.exists():
            self.raise_error('exists')
        try:
            old_path.rename(new_path)
            return {"message": f"Renamed to {new_name}"}
        except Exception as e:
            self.raise_error('access', str(e))

    def delete(self, path: Path, item_name: str) -> Dict:
        self.validate(path, require_dir=True)
        item_path = path / item_name
        self.validate(item_path)
        try:
            if item_path.is_file():
                item_path.unlink()
            else:
                shutil.rmtree(item_path)
            return {"message": f"{item_name} deleted"}
        except Exception as e:
            self.raise_error('access', str(e))

BASE_DIR = Path(__file__).resolve().parent.parent
UPLOAD_DIR = BASE_DIR / 'test-volume'
fs = FileSystem(UPLOAD_DIR)

@app.post("/change-directory")
async def change_directory(request: Request):
    try:
        data = await request.json()
        new_path = data.get('path', '').strip()
        if not new_path:
            raise HTTPException(status_code=400, detail="Path cannot be empty")

        new_path = Path(new_path if Path(new_path).is_absolute() else BASE_DIR / new_path).resolve()
        if not new_path.exists() or not new_path.is_dir():
            raise HTTPException(status_code=404, detail="Invalid directory")

        global UPLOAD_DIR, fs
        UPLOAD_DIR = new_path
        fs = FileSystem(UPLOAD_DIR)
        return {"message": "Directory changed"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/search")
async def search(query: str = ""):
    return fs.search(query)

@app.get("/")
@app.get("/{path:path}")
async def index(request: Request, path: str = ""):
    if not UPLOAD_DIR.exists():
        return templates.TemplateResponse("index.html", 
            {"request": request, "error": "Error: test-volume is not mounted"})
    
    contents = fs.get_contents(UPLOAD_DIR / path)
    return templates.TemplateResponse("index.html", {
        "request": request,
        "current_path": path,
        "base_dir_name": UPLOAD_DIR.name,
        **contents
    })

@app.post("/upload/{path:path}")
async def upload_file(file: UploadFile = File(...), path: str = ""):
    await fs.upload(file, UPLOAD_DIR / path)
    return RedirectResponse(url=f"/{path}", status_code=303)

@app.post("/create-folder/{path:path}")
async def create_folder(path: str = ""):
    return fs.create_folder(UPLOAD_DIR / path)

@app.post("/rename/{path:path}")
async def rename_item(path: str, old_name: str = Form(...), new_name: str = Form(...)):
    return fs.rename(UPLOAD_DIR / path, old_name, new_name)

@app.post("/delete/{path:path}")
async def delete_item(path: str, item_name: str = Form(...)):
    return fs.delete(UPLOAD_DIR / path, item_name)

@app.get("/total-size")
async def get_total_size():
    return {"total_size": fs.get_size(UPLOAD_DIR) if UPLOAD_DIR.exists() else 0}