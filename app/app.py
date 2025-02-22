from fastapi import FastAPI, APIRouter, Request, UploadFile, File, HTTPException, Form
from fastapi.responses import JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
import aiofiles
import os
import shutil
from pathlib import Path
from typing import List, Dict, Optional

# Create FastAPI app
app = FastAPI()

# Mount static files
app.mount("/static", StaticFiles(directory="app/static"), name="static")

# Configure templates
templates = Jinja2Templates(directory="app/templates")

class FileSystemError:
    """Centralized error messages and status codes"""
    VOLUME_NOT_MOUNTED = ("Volume not mounted", 400)
    PATH_NOT_FOUND = ("Path not found", 404)
    ACCESS_DENIED = ("Access denied", 403)
    DIRECTORY_NOT_FOUND = ("Directory not found", 404)
    NO_FILE_UPLOADED = ("No file uploaded", 400)
    ITEM_EXISTS = ("An item with this name already exists", 400)

    @staticmethod
    def raise_error(error_type: tuple[str, int], detail: Optional[str] = None):
        message, status_code = error_type
        raise HTTPException(status_code=status_code, detail=detail or message)

class PathValidator:
    def __init__(self, base_dir: Path):
        self.base_dir = base_dir

    def ensure_exists(self, path: Path) -> None:
        """Ensure path exists"""
        if not self.base_dir.exists():
            FileSystemError.raise_error(FileSystemError.VOLUME_NOT_MOUNTED)
        if not path.exists():
            FileSystemError.raise_error(FileSystemError.PATH_NOT_FOUND)

    def ensure_in_base_dir(self, path: Path) -> None:
        """Ensure path is within base directory"""
        if not str(path).startswith(str(self.base_dir)):
            FileSystemError.raise_error(FileSystemError.ACCESS_DENIED)

    def validate_path(self, path: Path) -> None:
        """Validate path exists and is within base directory"""
        self.ensure_exists(path)
        self.ensure_in_base_dir(path)

    def validate_directory(self, path: Path) -> None:
        """Validate path exists and is a directory"""
        self.validate_path(path)
        if not path.is_dir():
            FileSystemError.raise_error(FileSystemError.DIRECTORY_NOT_FOUND)

class FileManager:
    def __init__(self, base_dir: Path):
        self.base_dir = base_dir
        self.validator = PathValidator(base_dir)

    def get_directory_contents(self, path: Path) -> Dict[str, List[str]]:
        """Get files and folders in the current directory"""
        self.validator.validate_directory(path)
        
        contents = {"files": [], "folders": [], "path_parts": []}
        
        # Get directory contents
        for item in path.iterdir():
            if item.is_file():
                contents["files"].append(item.name)
            elif item.is_dir():
                contents["folders"].append(item.name)
        
        # Get path parts for navigation
        rel_path = path.relative_to(self.base_dir)
        contents["path_parts"] = str(rel_path).split('/') if str(rel_path) != '.' else []
        
        return contents

    async def upload_file(self, file: UploadFile, current_path: Path) -> None:
        """Upload a file to the specified directory"""
        self.validator.validate_directory(current_path)
        
        if not file:
            FileSystemError.raise_error(FileSystemError.NO_FILE_UPLOADED)
        
        try:
            file_path = current_path / file.filename
            async with aiofiles.open(str(file_path), 'wb') as out_file:
                content = await file.read()
                await out_file.write(content)
        except Exception as e:
            FileSystemError.raise_error((str(e), 500))

    def create_folder(self, current_path: Path) -> Dict[str, str]:
        """Create a new folder with an auto-generated name"""
        self.validator.validate_directory(current_path)
        
        base_name = "Untitled Folder"
        folder_name = self._generate_unique_name(current_path, base_name)
        
        try:
            new_folder = current_path / folder_name
            new_folder.mkdir()
            return {"message": f"Folder {folder_name} created successfully", "name": folder_name}
        except Exception as e:
            FileSystemError.raise_error((str(e), 500))

    def rename_item(self, current_path: Path, old_name: str, new_name: str) -> Dict[str, str]:
        """Rename a file or folder"""
        self.validator.validate_directory(current_path)
        
        old_path = current_path / old_name
        new_path = current_path / new_name
        
        self.validator.validate_path(old_path)
        
        if new_path.exists():
            FileSystemError.raise_error(FileSystemError.ITEM_EXISTS)
        
        try:
            old_path.rename(new_path)
            return {"message": f"Renamed successfully to {new_name}"}
        except Exception as e:
            FileSystemError.raise_error((str(e), 500))

    def delete_item(self, current_path: Path, item_name: str) -> Dict[str, str]:
        """Delete a file or folder"""
        self.validator.validate_directory(current_path)
        
        item_path = current_path / item_name
        self.validator.validate_path(item_path)
        
        try:
            if item_path.is_file():
                item_path.unlink()
            else:
                shutil.rmtree(item_path)
            return {"message": f"{item_name} deleted successfully"}
        except Exception as e:
            FileSystemError.raise_error((str(e), 500))

    def _generate_unique_name(self, path: Path, base_name: str) -> str:
        """Generate a unique name for a new folder"""
        folder_name = base_name
        counter = 1
        
        while (path / folder_name).exists():
            folder_name = f"{base_name} {counter}"
            counter += 1
            
        return folder_name

# Configure upload directory using absolute path
BASE_DIR = Path(__file__).resolve().parent.parent
UPLOAD_FOLDER = BASE_DIR / 'test-volume'
file_manager = FileManager(UPLOAD_FOLDER)

@app.get("/")
@app.get("/{path:path}")
async def index(request: Request, path: str = ""):
    if not UPLOAD_FOLDER.exists():
        return templates.TemplateResponse(
            "index.html",
            {"request": request, "error": "Error: test-volume is not mounted"}
        )
    
    current_path = UPLOAD_FOLDER / path
    contents = file_manager.get_directory_contents(current_path)
    return templates.TemplateResponse(
        "index.html",
        {
            "request": request,
            "current_path": path,
            **contents
        }
    )

@app.post("/upload/{path:path}")
async def upload_file(file: UploadFile = File(...), path: str = ""):
    current_path = UPLOAD_FOLDER / path
    await file_manager.upload_file(file, current_path)
    return RedirectResponse(url=f"/{path}", status_code=303)

@app.post("/create-folder/{path:path}")
async def create_folder(path: str = ""):
    current_path = UPLOAD_FOLDER / path
    return file_manager.create_folder(current_path)

@app.post("/rename/{path:path}")
async def rename_item(path: str, old_name: str = Form(...), new_name: str = Form(...)):
    current_path = UPLOAD_FOLDER / path
    return file_manager.rename_item(current_path, old_name, new_name)

@app.post("/delete/{path:path}")
async def delete_item(path: str, item_name: str = Form(...)):
    current_path = UPLOAD_FOLDER / path
    return file_manager.delete_item(current_path, item_name)