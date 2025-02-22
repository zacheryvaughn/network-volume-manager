from fastapi import APIRouter, Request, UploadFile, File, HTTPException, Form
from fastapi.responses import JSONResponse, RedirectResponse
import aiofiles
import os
from pathlib import Path
from typing import List, Dict
from app import templates

router = APIRouter()

# Configure upload directory using absolute path
BASE_DIR = Path(__file__).resolve().parent.parent
UPLOAD_FOLDER = BASE_DIR / 'test-volume'

def get_directory_contents(path: Path) -> Dict[str, List[str]]:
    """Get files and folders in the current directory"""
    contents = {"files": [], "folders": [], "path_parts": []}
    if path.exists():
        for item in path.iterdir():
            if item.is_file():
                contents["files"].append(item.name)
            elif item.is_dir():
                contents["folders"].append(item.name)
    
    # Get path parts for navigation
    rel_path = path.relative_to(UPLOAD_FOLDER)
    if str(rel_path) == '.':
        contents["path_parts"] = []
    else:
        contents["path_parts"] = str(rel_path).split('/')
    
    return contents

@router.get("/")
@router.get("/{path:path}")
async def index(request: Request, path: str = ""):
    if not UPLOAD_FOLDER.exists():
        return templates.TemplateResponse(
            "index.html",
            {"request": request, "error": "Error: test-volume is not mounted"}
        )
    
    current_path = UPLOAD_FOLDER / path
    if not current_path.exists() or not current_path.is_dir():
        raise HTTPException(status_code=404, detail="Directory not found")
    
    if not str(current_path).startswith(str(UPLOAD_FOLDER)):
        raise HTTPException(status_code=403, detail="Access denied")
    
    contents = get_directory_contents(current_path)
    return templates.TemplateResponse(
        "index.html",
        {
            "request": request,
            "current_path": path,
            **contents
        }
    )

@router.post("/upload/{path:path}")
async def upload_file(file: UploadFile = File(...), path: str = ""):
    if not UPLOAD_FOLDER.exists():
        raise HTTPException(status_code=400, detail="Volume not mounted")
    
    if not file:
        raise HTTPException(status_code=400, detail="No file uploaded")
    
    current_path = UPLOAD_FOLDER / path
    if not current_path.exists() or not current_path.is_dir():
        raise HTTPException(status_code=404, detail="Directory not found")
    
    if not str(current_path).startswith(str(UPLOAD_FOLDER)):
        raise HTTPException(status_code=403, detail="Access denied")
    
    try:
        file_path = current_path / file.filename
        async with aiofiles.open(str(file_path), 'wb') as out_file:
            content = await file.read()  # Async read
            await out_file.write(content)  # Async write
        return RedirectResponse(url=f"/{path}", status_code=303)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/create-folder/{path:path}")
async def create_folder(path: str = ""):
    if not UPLOAD_FOLDER.exists():
        raise HTTPException(status_code=400, detail="Volume not mounted")
    
    current_path = UPLOAD_FOLDER / path
    if not current_path.exists() or not current_path.is_dir():
        raise HTTPException(status_code=404, detail="Directory not found")
    
    if not str(current_path).startswith(str(UPLOAD_FOLDER)):
        raise HTTPException(status_code=403, detail="Access denied")
    
    # Find an available "Untitled Folder" name
    base_name = "Untitled Folder"
    folder_name = base_name
    counter = 1
    
    while (current_path / folder_name).exists():
        folder_name = f"{base_name} {counter}"
        counter += 1
    
    try:
        new_folder = current_path / folder_name
        new_folder.mkdir()
        return {"message": f"Folder {folder_name} created successfully", "name": folder_name}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/rename/{path:path}")
async def rename_item(path: str, old_name: str = Form(...), new_name: str = Form(...)):
    if not UPLOAD_FOLDER.exists():
        raise HTTPException(status_code=400, detail="Volume not mounted")
    
    current_path = UPLOAD_FOLDER / path
    if not current_path.exists() or not current_path.is_dir():
        raise HTTPException(status_code=404, detail="Directory not found")
    
    old_path = current_path / old_name
    new_path = current_path / new_name
    
    if not str(old_path).startswith(str(UPLOAD_FOLDER)) or not str(new_path).startswith(str(UPLOAD_FOLDER)):
        raise HTTPException(status_code=403, detail="Access denied")
    
    if not old_path.exists():
        raise HTTPException(status_code=404, detail="Item not found")
    
    if new_path.exists():
        raise HTTPException(status_code=400, detail="An item with this name already exists")
    
    try:
        old_path.rename(new_path)
        return {"message": f"Renamed successfully to {new_name}"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/delete/{path:path}")
async def delete_item(path: str, item_name: str = Form(...)):
    if not UPLOAD_FOLDER.exists():
        raise HTTPException(status_code=400, detail="Volume not mounted")
    
    parent_path = UPLOAD_FOLDER / path
    if not parent_path.exists() or not parent_path.is_dir():
        raise HTTPException(status_code=404, detail="Directory not found")
    
    item_path = parent_path / item_name
    if not str(item_path).startswith(str(UPLOAD_FOLDER)):
        raise HTTPException(status_code=403, detail="Access denied")
    
    if not item_path.exists():
        raise HTTPException(status_code=404, detail="Item not found")
    
    try:
        import shutil
        if item_path.is_file():
            item_path.unlink()
        else:
            shutil.rmtree(item_path)  # Recursively remove directory and contents
        return {"message": f"{item_name} deleted successfully"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))