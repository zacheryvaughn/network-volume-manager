from fastapi import FastAPI, Request, UploadFile, File, HTTPException, Form
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
import aiofiles
import shutil
import logging
import logging.handlers
import os
import time
from pathlib import Path
from typing import List, Dict, Optional, Tuple, Union, Any

# Configure logging
logger = logging.getLogger("network-volume-manager")
logger.setLevel(logging.INFO)

# Create logs directory if it doesn't exist
logs_dir = Path("logs")
logs_dir.mkdir(exist_ok=True)

# Create handlers
console_handler = logging.StreamHandler()
file_handler = logging.handlers.RotatingFileHandler(
    logs_dir / "app.log",
    maxBytes=10*1024*1024,  # 10MB
    backupCount=5
)

# Create formatters
formatter = logging.Formatter(
    '%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)

# Set formatters for handlers
console_handler.setFormatter(formatter)
file_handler.setFormatter(formatter)

# Add handlers to logger
logger.addHandler(console_handler)
logger.addHandler(file_handler)

# Create FastAPI app
app = FastAPI()
# Use a path relative to the current file's location
from pathlib import Path
current_dir = Path(__file__).resolve().parent
app.mount("/static", StaticFiles(directory=current_dir / "static"), name="static")
templates = Jinja2Templates(directory="app/templates")

class FileSystemError:
    """Error definitions for file system operations"""
    VOLUME_NOT_MOUNTED = ("Volume not mounted", 400)
    PATH_NOT_FOUND = ("Path not found", 404)
    ACCESS_DENIED = ("Access denied", 403)
    DIRECTORY_NOT_FOUND = ("Directory not found", 404)
    NO_FILE_UPLOADED = ("No file uploaded", 400)
    ITEM_EXISTS = ("An item with this name already exists", 400)

class FileSystem:
    """Handles file system operations and validation"""
    
    def __init__(self, base_dir: Path):
        self.base_dir = base_dir
        logger.info(f"FileSystem initialized with base directory: {base_dir}")

    def raise_error(self, error: Tuple[str, int], detail: Optional[str] = None):
        """Raise an HTTP exception with predefined error messages"""
        message, status_code = error
        error_detail = detail or message
        logger.error(f"Error raised: {error_detail} (Status code: {status_code})")
        raise HTTPException(status_code=status_code, detail=error_detail)

    def validate_path(self, path: Path, require_dir: bool = False) -> None:
        """Validate path exists and is within base directory"""
        logger.debug(f"Validating path: {path}, require_dir={require_dir}")
        if not self.base_dir.exists():
            logger.warning(f"Volume not mounted: {self.base_dir}")
            self.raise_error(FileSystemError.VOLUME_NOT_MOUNTED)
        if not path.exists():
            logger.warning(f"Path not found: {path}")
            self.raise_error(FileSystemError.PATH_NOT_FOUND)
        if not str(path).startswith(str(self.base_dir)):
            logger.warning(f"Access denied - path outside base directory: {path}")
            self.raise_error(FileSystemError.ACCESS_DENIED)
        if require_dir and not path.is_dir():
            logger.warning(f"Directory not found: {path}")
            self.raise_error(FileSystemError.DIRECTORY_NOT_FOUND)
        logger.debug(f"Path validation successful: {path}")

    def get_folder_size(self, folder_path: Path) -> int:
        """Calculate the total size of a folder recursively"""
        total_size = 0
        try:
            for item in folder_path.iterdir():
                if item.is_file():
                    try:
                        total_size += item.stat().st_size
                    except (PermissionError, OSError):
                        pass  # Skip files we can't access
                elif item.is_dir():
                    total_size += self.get_folder_size(item)
        except (PermissionError, OSError):
            pass  # Skip folders we can't access
        return total_size

    def get_contents(self, path: Path) -> Dict[str, List]:
        """Get directory contents and path parts"""
        logger.info(f"Getting contents of directory: {path}")
        start_time = time.time()
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
                # Calculate folder size
                try:
                    folder_size = self.get_folder_size(item)
                    contents["folders"].append({"name": item.name, "size": folder_size})
                except Exception:
                    # If we can't calculate size for some reason, show with no size
                    contents["folders"].append({"name": item.name, "size": 0})
        
        rel_path = path.relative_to(self.base_dir)
        contents["path_parts"] = str(rel_path).split('/') if str(rel_path) != '.' else []
        
        elapsed_time = time.time() - start_time
        logger.info(f"Retrieved {len(contents['files'])} files and {len(contents['folders'])} folders from {path} in {elapsed_time:.2f}s")
        return contents

    def search(self, query: str) -> Dict[str, List[Dict[str, str]]]:
        """Search for files and folders recursively"""
        logger.info(f"Searching for: '{query}'")
        start_time = time.time()
        results = {"files": [], "folders": []}
        if not self.base_dir.exists():
            logger.warning(f"Search base directory does not exist: {self.base_dir}")
            return results

        def search_dir(path: Path, rel_path: str = "") -> None:
            try:
                for item in path.iterdir():
                    item_rel_path = f"{rel_path}/{item.name}" if rel_path else item.name
                    
                    if query.lower() in item.name.lower():
                        item_type = "files" if item.is_file() else "folders"
                        results[item_type].append({
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
        elapsed_time = time.time() - start_time
        logger.info(f"Search completed in {elapsed_time:.2f}s. Found {len(results['files'])} files and {len(results['folders'])} folders matching '{query}'")
        return results

    async def upload(self, file: UploadFile, path: Path) -> None:
        """Upload a file with atomic operation"""
        logger.info(f"Uploading file: {file.filename} to {path}")
        start_time = time.time()
        self.validate_path(path, require_dir=True)
        
        if not file:
            logger.warning("No file uploaded")
            self.raise_error(FileSystemError.NO_FILE_UPLOADED)
        
        file_path = path / file.filename
        if file_path.exists():
            logger.warning(f"File already exists: {file_path}")
            self.raise_error(FileSystemError.ITEM_EXISTS)
        
        temp_path = file_path.with_suffix('.tmp')
        try:
            async with aiofiles.open(str(temp_path), 'wb') as out_file:
                content = await file.read()
                await out_file.write(content)
            temp_path.rename(file_path)
            elapsed_time = time.time() - start_time
            file_size = os.path.getsize(file_path)
            logger.info(f"File uploaded successfully: {file_path} ({formatBytes(file_size)}) in {elapsed_time:.2f}s")
        except Exception as e:
            logger.error(f"Error uploading file {file.filename}: {str(e)}")
            if temp_path.exists():
                temp_path.unlink()
                logger.debug(f"Temporary file removed: {temp_path}")
            self.raise_error(FileSystemError.ACCESS_DENIED, str(e))
    
    async def upload_chunk(self, filename: str, chunk_index: int, total_chunks: int,
                          chunk_data: bytes, path: Path) -> Dict[str, Any]:
        """Handle chunked file upload"""
        logger.info(f"Uploading chunk {chunk_index+1}/{total_chunks} of file: {filename} to {path}")
        self.validate_path(path, require_dir=True)
        
        # Create chunks directory if it doesn't exist
        chunks_dir = path / ".chunks"
        if not chunks_dir.exists():
            chunks_dir.mkdir(exist_ok=True)
            
        # Create file-specific chunks directory
        file_chunks_dir = chunks_dir / filename
        if not file_chunks_dir.exists():
            file_chunks_dir.mkdir(exist_ok=True)
        
        # Write the chunk to a temporary file
        chunk_file = file_chunks_dir / f"{chunk_index}.part"
        try:
            async with aiofiles.open(str(chunk_file), 'wb') as out_file:
                await out_file.write(chunk_data)
                
            # Check if all chunks have been uploaded
            if chunk_index == total_chunks - 1:
                # All chunks received, combine them
                file_path = path / filename
                if file_path.exists():
                    self.raise_error(FileSystemError.ITEM_EXISTS)
                
                temp_path = file_path.with_suffix('.tmp')
                try:
                    # Combine all chunks into the final file
                    async with aiofiles.open(str(temp_path), 'wb') as out_file:
                        for i in range(total_chunks):
                            chunk_path = file_chunks_dir / f"{i}.part"
                            if not chunk_path.exists():
                                raise FileNotFoundError(f"Chunk {i} is missing")
                            
                            async with aiofiles.open(str(chunk_path), 'rb') as chunk_file:
                                chunk_content = await chunk_file.read()
                                await out_file.write(chunk_content)
                    
                    # Rename temp file to final file
                    temp_path.rename(file_path)
                    
                    # Clean up chunks directory
                    import shutil
                    shutil.rmtree(str(file_chunks_dir))
                    
                    file_size = os.path.getsize(file_path)
                    logger.info(f"Chunked file upload completed: {file_path} ({formatBytes(file_size)})")
                    return {"status": "complete", "filename": filename}
                except Exception as e:
                    if temp_path.exists():
                        temp_path.unlink()
                    self.raise_error(FileSystemError.ACCESS_DENIED, str(e))
            
            logger.debug(f"Chunk {chunk_index+1}/{total_chunks} received for {filename}")
            return {"status": "chunk_received", "chunk": chunk_index, "total": total_chunks}
        except Exception as e:
            logger.error(f"Error uploading chunk {chunk_index+1}/{total_chunks} of {filename}: {str(e)}")
            self.raise_error(FileSystemError.ACCESS_DENIED, str(e))

    def create_folder(self, path: Path) -> Dict[str, str]:
        """Create a new folder with unique name"""
        logger.info(f"Creating new folder in: {path}")
        self.validate_path(path, require_dir=True)
        
        base_name = "Untitled Folder"
        folder_name = base_name
        counter = 1
        
        while (path / folder_name).exists():
            folder_name = f"{base_name} {counter}"
            counter += 1
        
        try:
            (path / folder_name).mkdir()
            logger.info(f"Folder created successfully: {path / folder_name}")
            return {"message": f"Folder {folder_name} created successfully", "name": folder_name}
        except Exception as e:
            logger.error(f"Error creating folder in {path}: {str(e)}")
            self.raise_error(FileSystemError.ACCESS_DENIED, str(e))

    def file_operation(self, operation: str, source_path: Path, item_name: str,
                      destination_path: Optional[Path] = None, new_name: Optional[str] = None) -> Dict[str, Any]:
        """Generic file operation handler for rename, delete, and move operations"""
        logger.info(f"Performing {operation} operation on {item_name} in {source_path}")
        self.validate_path(source_path, require_dir=True)
        item_path = source_path / item_name
        self.validate_path(item_path)
        
        try:
            if operation == "rename":
                if not new_name:
                    self.raise_error(FileSystemError.ACCESS_DENIED, "New name is required")
                new_path = source_path / new_name
                if new_path.exists():
                    self.raise_error(FileSystemError.ITEM_EXISTS)
                item_path.rename(new_path)
                logger.info(f"Renamed {item_path} to {new_path}")
                return {"message": f"Renamed successfully to {new_name}"}
                
            elif operation == "delete":
                if item_path.is_file():
                    item_path.unlink(missing_ok=True)
                else:
                    shutil.rmtree(item_path, ignore_errors=True)
                logger.info(f"Deleted {item_path}")
                return {"message": f"{item_name} deleted successfully"}
                
            elif operation == "move":
                if not destination_path:
                    self.raise_error(FileSystemError.ACCESS_DENIED, "Destination path is required")
                self.validate_path(destination_path, require_dir=True)
                dest_item_path = destination_path / item_name
                if dest_item_path.exists():
                    self.raise_error(FileSystemError.ITEM_EXISTS)
                shutil.move(str(item_path), str(destination_path))
                logger.info(f"Moved {item_path} to {destination_path / item_name}")
                return {"message": f"{item_name} moved successfully to {destination_path.name}"}
                
            else:
                self.raise_error(FileSystemError.ACCESS_DENIED, f"Unknown operation: {operation}")
                
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Error during {operation} operation on {item_path}: {str(e)}")
            self.raise_error(FileSystemError.ACCESS_DENIED, str(e))
    
    def rename(self, path: Path, old_name: str, new_name: str) -> Dict[str, str]:
        """Rename a file or folder"""
        return self.file_operation("rename", path, old_name, new_name=new_name)

    def delete(self, path: Path, item_name: str) -> Dict[str, str]:
        """Delete a file or folder"""
        return self.file_operation("delete", path, item_name)
            
    def move(self, source_path: Path, item_name: str, destination_path: Path) -> Dict[str, str]:
        """Move a file or folder to another location"""
        return self.file_operation("move", source_path, item_name, destination_path=destination_path)
            
    def move_multiple(self, source_path: Path, item_names: List[str], destination_path: Path) -> Dict[str, List]:
        """Move multiple files or folders to another location"""
        logger.info(f"Moving multiple items from {source_path} to {destination_path}")
        self.validate_path(source_path, require_dir=True)
        self.validate_path(destination_path, require_dir=True)
        
        results = {"success": [], "failed": []}
        
        for item_name in item_names:
            try:
                self.move(source_path, item_name, destination_path)
                results["success"].append(item_name)
            except HTTPException as e:
                results["failed"].append({"name": item_name, "error": e.detail})
            except Exception as e:
                error_message = str(e)
                if "not found" in error_message.lower():
                    error_message = "Item not found"
                elif "access" in error_message.lower():
                    error_message = "Access denied"
                
                results["failed"].append({"name": item_name, "error": error_message})
        
        logger.info(f"Move multiple operation completed: {len(results['success'])} succeeded, {len(results['failed'])} failed")
        return results

# Helper function to format bytes
def formatBytes(size):
    """Format bytes to human-readable string"""
    power = 2**10  # 1024
    n = 0
    power_labels = {0: 'B', 1: 'KB', 2: 'MB', 3: 'GB', 4: 'TB'}
    while size > power and n < len(power_labels) - 1:
        size /= power
        n += 1
    return f"{size:.2f} {power_labels[n]}"

# Initialize file system manager
BASE_DIR = Path(__file__).resolve().parent.parent
UPLOAD_DIR = Path('/runpod-volume')
logger.info(f"Initializing application with BASE_DIR: {BASE_DIR}, UPLOAD_DIR: {UPLOAD_DIR}")
fs = FileSystem(UPLOAD_DIR)

@app.post("/change-directory")
async def change_directory(request: Request):
    """Change the base directory for file operations"""
    try:
        data = await request.json()
        new_path = data.get('path', '').strip()
        logger.info(f"Change directory request to: {new_path}")
        if not new_path:
            logger.warning("Empty path provided in change directory request")
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
        
        logger.info(f"Directory changed successfully to: {new_path}")
        return {"message": "Directory changed successfully"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error changing directory: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

# Route handlers
@app.get("/search")
async def search(query: str = "", folders_only: bool = False):
    """Search for files and folders"""
    logger.info(f"Search request: query='{query}', folders_only={folders_only}")
    results = fs.search(query)
    # If folders_only is True, return only folders
    if folders_only:
        results["files"] = []
    return results

@app.get("/")
@app.get("/{path:path}")
async def index(request: Request, path: str = ""):
    """Render index page with directory contents"""
    logger.info(f"Index request for path: '{path}'")
    if not UPLOAD_DIR.exists():
        # Still render the page but with a warning
        logger.warning(f"Volume not mounted: {UPLOAD_DIR}")
        return templates.TemplateResponse(
            "index.html",
            {
                "request": request,
                "error": "Warning: /runpod-volume is not mounted",
                "current_path": "",
                "base_dir_name": UPLOAD_DIR.name,
                "files": [],
                "folders": [],
                "path_parts": []
            }
        )
    
    try:
        current_path = UPLOAD_DIR / path
        contents = fs.get_contents(current_path)
        logger.debug(f"Rendering index for path: '{path}' with {len(contents['files'])} files and {len(contents['folders'])} folders")
        return templates.TemplateResponse(
            "index.html",
            {
                "request": request,
                "current_path": path,
                "base_dir_name": UPLOAD_DIR.name,
                **contents
            }
        )
    except HTTPException as e:
        # Handle errors gracefully
        logger.error(f"HTTP exception in index route for path '{path}': {e.detail}")
        return templates.TemplateResponse(
            "index.html",
            {
                "request": request,
                "error": f"Error: {e.detail}",
                "current_path": path,
                "base_dir_name": UPLOAD_DIR.name,
                "files": [],
                "folders": [],
                "path_parts": []
            }
        )

@app.post("/upload/{path:path}")
async def upload_file(file: UploadFile = File(...), path: str = ""):
    """Upload a file to specified path"""
    logger.info(f"File upload request: {file.filename} to path '{path}'")
    try:
        await fs.upload(file, UPLOAD_DIR / path)
        logger.info(f"Upload successful, redirecting to /{path}")
        return RedirectResponse(url=f"/{path}", status_code=303)
    except HTTPException as e:
        if e.status_code == 400 and "Volume not mounted" in e.detail:
            logger.error(f"Upload failed: Volume not mounted")
            return {"error": "Cannot upload: Volume not mounted. Please change to a valid directory."}
        logger.error(f"Upload failed with HTTP exception: {e.detail}")
        raise

@app.post("/upload-chunk/{path:path}")
async def upload_chunk(
    path: str,
    filename: str = Form(...),
    chunk_index: int = Form(...),
    total_chunks: int = Form(...),
    chunk: UploadFile = File(...)
):
    """Handle chunked file upload"""
    logger.info(f"Chunk upload request: {filename}, chunk {chunk_index+1}/{total_chunks} to path '{path}'")
    try:
        chunk_data = await chunk.read()
        result = await fs.upload_chunk(
            filename,
            chunk_index,
            total_chunks,
            chunk_data,
            UPLOAD_DIR / path
        )
        return result
    except HTTPException as e:
        if e.status_code == 400 and "Volume not mounted" in e.detail:
            logger.error(f"Chunk upload failed: Volume not mounted")
            return {"error": "Cannot upload: Volume not mounted. Please change to a valid directory."}
        logger.error(f"Chunk upload failed with HTTP exception: {e.detail}")
        raise

@app.post("/create-folder/{path:path}")
async def create_folder(path: str = ""):
    """Create a new folder"""
    logger.info(f"Create folder request in path: '{path}'")
    try:
        result = fs.create_folder(UPLOAD_DIR / path)
        return result
    except HTTPException as e:
        if e.status_code == 400 and "Volume not mounted" in e.detail:
            logger.error(f"Create folder failed: Volume not mounted")
            return {"error": "Cannot create folder: Volume not mounted. Please change to a valid directory."}
        logger.error(f"Create folder failed with HTTP exception: {e.detail}")
        raise

@app.post("/rename/{path:path}")
async def rename_item(path: str, old_name: str = Form(...), new_name: str = Form(...)):
    """Rename a file or folder"""
    logger.info(f"Rename request: '{old_name}' to '{new_name}' in path '{path}'")
    try:
        result = fs.rename(UPLOAD_DIR / path, old_name, new_name)
        return result
    except HTTPException as e:
        if e.status_code == 400 and "Volume not mounted" in e.detail:
            logger.error(f"Rename failed: Volume not mounted")
            return {"error": "Cannot rename: Volume not mounted. Please change to a valid directory."}
        logger.error(f"Rename failed with HTTP exception: {e.detail}")
        raise

@app.post("/delete/{path:path}")
async def delete_item(path: str, item_name: str = Form(...)):
    """Delete a file or folder"""
    logger.info(f"Delete request: '{item_name}' in path '{path}'")
    try:
        result = fs.delete(UPLOAD_DIR / path, item_name)
        return result
    except HTTPException as e:
        if e.status_code == 400 and "Volume not mounted" in e.detail:
            logger.error(f"Delete failed: Volume not mounted")
            return {"error": "Cannot delete: Volume not mounted. Please change to a valid directory."}
        logger.error(f"Delete failed with HTTP exception: {e.detail}")
        raise

@app.post("/move/{path:path}")
async def move_item(path: str, item_name: str = Form(...), destination: str = Form(...)):
    """Move a file or folder to a new location"""
    logger.info(f"Move request: '{item_name}' from '{path}' to '{destination}'")
    try:
        # Convert relative destination path to absolute path
        # If destination is empty or just a slash, use the root directory
        destination = destination.strip()
        dest_path = UPLOAD_DIR if destination in ('', '/') else UPLOAD_DIR / destination
        source_path = UPLOAD_DIR / path
        
        # Call the move method
        result = fs.move(source_path, item_name, dest_path)
        return result
    except HTTPException as e:
        if e.status_code == 400 and "Volume not mounted" in e.detail:
            logger.error(f"Move failed: Volume not mounted")
            return {"error": "Cannot move: Volume not mounted. Please change to a valid directory."}
        logger.error(f"Move failed with HTTP exception: {e.detail}")
        raise