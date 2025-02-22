from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pathlib import Path

app = FastAPI()

# Mount static files
app.mount("/static", StaticFiles(directory="app/static"), name="static")

# Configure templates
templates = Jinja2Templates(directory="app/templates")

# Import routes after app creation to avoid circular imports
from app.routes import router
app.include_router(router)