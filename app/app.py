from fastapi import FastAPI, Request, UploadFile, File, HTTPException, Form
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
import aiofiles
import shutil
from pathlib import Path
from typing import List, Dict, Optional, Tuple

# Create FastAPI app
app = FastAPI()
app.mount("/static", StaticFiles(directory="app/static"), name="static")
templates = Jinja2Templates(directory="app/templates")

class FileSystem:
    """Handles file system operations and validation"""
    
    # Error definitions
    ERRORS = {
        'VOLUME_NOT_MOUNTED': ("Volume not mounted", 400),
        'PATH_NOT_FOUND': ("Path not found", 404),
        'ACCESS_DENIED': ("Access denied", 403),
        'DIRECTORY_NOT_FOUND': ("Directory not found", 404),
        'NO_FILE_UPLOADED': ("No file uploaded", 400),
        'ITEM_EXISTS': ("An item with this name already exists", 400)
    }

    def __init__(self, base_dir: Path):
        self.base_dir = base_dir

    def raise_error(self, error_key: str, detail: Optional[str] = None):
        """Raise an HTTP exception with predefined error messages"""
        message, status_code = self.ERRORS[error_key]
        raise HTTPException(status_code=status_code, detail=detail or message)

    def validate_path(self, path: Path, require_dir: bool = False) -> None:
        """Validate path exists and is within base directory"""
        if not self.base_dir.exists():
            self.raise_error('VOLUME_NOT_MOUNTED')
        if not path.exists():
            self.raise_error('PATH_NOT_FOUND')
        if not str(path).startswith(str(self.base_dir)):
            self.raise_error('ACCESS_DENIED')
        if require_dir and not path.is_dir():
            self.raise_error('DIRECTORY_NOT_FOUND')

    def get_contents(self, path: Path) -> Dict[str, List]:
        """Get directory contents and path parts"""
        self.validate_path(path, require_dir=True)
        
        contents = {"files": [], "folders": [], "path_parts": []}
        
        for item in path.iterdir():
            if item.is_file():
                # Add file with its size
                try:
                    file_size = item.stat().st_size
                    contents["files"].append({"name": item.name, "size": file_size})
                except Exception:
                    # If we can't get size for some reason, show with no size
                    contents["files"].append({"name": item.name, "size": 0})
            else:
                contents["folders"].append(item.name)
        
        rel_path = path.relative_to(self.base_dir)
        contents["path_parts"] = str(rel_path).split('/') if str(rel_path) != '.' else []
        
        return contents

    def search(self, query: str) -> Dict[str, List[Dict[str, str]]]:
        """Search for files and folders recursively"""
        results = {"files": [], "folders": []}
        if not self.base_dir.exists():
            return results

        def search_dir(path: Path, rel_path: str = "") -> None:
            try:
                for item in path.iterdir():
                    item_rel_path = f"{rel_path}/{item.name}" if rel_path else item.name
                    
                    if query.lower() in item.name.lower():
                        results["files" if item.is_file() else "folders"].append({
                            "name": item.name,
                            "path": item_rel_path
                        })
                    
                    if item.is_dir():
                        try:
                            search_dir(item, item_rel_path)
                        except PermissionError:
                            pass
            except (PermissionError, Exception) as e:
                if not isinstance(e, PermissionError):
                    print(f"Error searching directory {path}: {str(e)}")

        search_dir(self.base_dir)
        return results

    async def upload(self, file: UploadFile, path: Path) -> None:
        """Upload a file with atomic operation"""
        self.validate_path(path, require_dir=True)
        
        if not file:
            self.raise_error('NO_FILE_UPLOADED')
        
        file_path = path / file.filename
        if file_path.exists():
            self.raise_error('ITEM_EXISTS')
        
        temp_path = file_path.with_suffix('.tmp')
        try:
            async with aiofiles.open(str(temp_path), 'wb') as out_file:
                content = await file.read()
                await out_file.write(content)
            temp_path.rename(file_path)
        except Exception as e:
            if temp_path.exists():
                temp_path.unlink()
            self.raise_error('ACCESS_DENIED', str(e))

    def create_folder(self, path: Path) -> Dict[str, str]:
        """Create a new folder with unique name"""
        self.validate_path(path, require_dir=True)
        
        base_name = "Untitled Folder"
        folder_name = base_name
        counter = 1
        
        while (path / folder_name).exists():
            folder_name = f"{base_name} {counter}"
            counter += 1
        
        try:
            (path / folder_name).mkdir()
            return {"message": f"Folder {folder_name} created successfully", "name": folder_name}
        except Exception as e:
            self.raise_error('ACCESS_DENIED', str(e))

    def rename(self, path: Path, old_name: str, new_name: str) -> Dict[str, str]:
        """Rename a file or folder"""
        self.validate_path(path, require_dir=True)
        
        old_path = path / old_name
        new_path = path / new_name
        
        self.validate_path(old_path)
        if new_path.exists():
            self.raise_error('ITEM_EXISTS')
        
        try:
            old_path.rename(new_path)
            return {"message": f"Renamed successfully to {new_name}"}
        except Exception as e:
            self.raise_error('ACCESS_DENIED', str(e))

    def delete(self, path: Path, item_name: str) -> Dict[str, str]:
        """Delete a file or folder"""
        self.validate_path(path, require_dir=True)
        
        item_path = path / item_name
        self.validate_path(item_path)
        
        try:
            if item_path.is_file():
                item_path.unlink(missing_ok=True)
            else:
                shutil.rmtree(item_path, ignore_errors=True)
            return {"message": f"{item_name} deleted successfully"}
        except Exception as e:
            self.raise_error('ACCESS_DENIED', str(e))
            
    def move(self, source_path: Path, item_name: str, destination_path: Path) -> Dict[str, str]:
        """Move a file or folder to another location"""
        # Validate both source and destination paths
        self.validate_path(source_path, require_dir=True)
        self.validate_path(destination_path, require_dir=True)
        
        # Get the full paths
        item_path = source_path / item_name
        dest_item_path = destination_path / item_name
        
        # Validate source item exists
        self.validate_path(item_path)
        
        # Check if an item with the same name exists at the destination
        if dest_item_path.exists():
            self.raise_error('ITEM_EXISTS')
            
        try:
            # Use shutil.move which works for both files and directories
            shutil.move(str(item_path), str(destination_path))
            return {"message": f"{item_name} moved successfully to {destination_path.name}"}
        except Exception as e:
            self.raise_error('ACCESS_DENIED', str(e))
            
    def move_multiple(self, source_path: Path, item_names: List[str], destination_path: Path) -> Dict[str, List]:
        """Move multiple files or folders to another location"""
        # Validate both source and destination paths
        self.validate_path(source_path, require_dir=True)
        self.validate_path(destination_path, require_dir=True)
        
        results = {"success": [], "failed": []}
        
        for item_name in item_names:
            # Get the full paths
            item_path = source_path / item_name
            dest_item_path = destination_path / item_name
            
            try:
                # Validate source item exists
                self.validate_path(item_path)
                
                # Check if an item with the same name exists at the destination
                if dest_item_path.exists():
                    results["failed"].append({"name": item_name, "error": "An item with this name already exists"})
                    continue
                    
                # Use shutil.move which works for both files and directories
                shutil.move(str(item_path), str(destination_path))
                results["success"].append(item_name)
            except Exception as e:
                error_message = str(e)
                if "not found" in error_message.lower():
                    error_message = "Item not found"
                elif "access" in error_message.lower():
                    error_message = "Access denied"
                
                results["failed"].append({"name": item_name, "error": error_message})
        
        return results

# Initialize file system manager
BASE_DIR = Path(__file__).resolve().parent.parent
UPLOAD_DIR = BASE_DIR / 'test-volume'
fs = FileSystem(UPLOAD_DIR)

@app.post("/change-directory")
async def change_directory(request: Request):
    """Change the base directory for file operations"""
    try:
        data = await request.json()
        new_path = data.get('path', '').strip()
        if not new_path:
            raise HTTPException(status_code=400, detail="Path cannot be empty")

        # Convert to absolute path if relative
        if not Path(new_path).is_absolute():
            new_path = BASE_DIR / new_path

        new_path = Path(new_path).resolve()
        
        # Validate the new directory
        if not new_path.exists():
            raise HTTPException(status_code=404, detail="Directory not found")
        if not new_path.is_dir():
            raise HTTPException(status_code=400, detail="Path must be a directory")
            
        # Update the file system manager
        global UPLOAD_DIR, fs
        UPLOAD_DIR = new_path
        fs = FileSystem(UPLOAD_DIR)
        
        return {"message": "Directory changed successfully"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# Route handlers
@app.get("/search")
async def search(query: str = "", folders_only: bool = False):
    """Search for files and folders"""
    results = fs.search(query)
    # If folders_only is True, return only folders
    if folders_only:
        results["files"] = []
    return results

@app.get("/")
@app.get("/{path:path}")
async def index(request: Request, path: str = ""):
    """Render index page with directory contents"""
    if not UPLOAD_DIR.exists():
        return templates.TemplateResponse(
            "index.html",
            {"request": request, "error": "Error: test-volume is not mounted"}
        )
    
    current_path = UPLOAD_DIR / path
    contents = fs.get_contents(current_path)
    return templates.TemplateResponse(
        "index.html",
        {
            "request": request,
            "current_path": path,
            "base_dir_name": UPLOAD_DIR.name,
            **contents
        }
    )

@app.post("/upload/{path:path}")
async def upload_file(file: UploadFile = File(...), path: str = ""):
    """Upload a file to specified path"""
    await fs.upload(file, UPLOAD_DIR / path)
    return RedirectResponse(url=f"/{path}", status_code=303)

@app.post("/create-folder/{path:path}")
async def create_folder(path: str = ""):
    """Create a new folder"""
    return fs.create_folder(UPLOAD_DIR / path)

@app.post("/rename/{path:path}")
async def rename_item(path: str, old_name: str = Form(...), new_name: str = Form(...)):
    """Rename a file or folder"""
    return fs.rename(UPLOAD_DIR / path, old_name, new_name)

@app.post("/delete/{path:path}")
async def delete_item(path: str, item_name: str = Form(...)):
    """Delete a file or folder"""
    return fs.delete(UPLOAD_DIR / path, item_name)

@app.post("/move/{path:path}")
async def move_item(path: str, item_name: str = Form(...), destination: str = Form(...)):
    """Move a file or folder to a new location"""
    # Convert relative destination path to absolute path
    dest_path = UPLOAD_DIR / destination
    source_path = UPLOAD_DIR / path
    
    # Call the move method
    return fs.move(source_path, item_name, dest_path)