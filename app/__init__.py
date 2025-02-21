from flask import Flask
from flask_socketio import SocketIO

app = Flask(__name__)
app.config['SECRET_KEY'] = 'dev'
socketio = SocketIO(
    app,
    ping_timeout=7200,  # 2 hour timeout
    ping_interval=25,   # Default ping interval
    max_http_buffer_size=1024 * 1024 * 100,  # 100MB buffer size
    async_mode='threading',  # Use threading mode for more consistent chunk handling
    cors_allowed_origins='*',  # Allow cross-origin requests
    logger=False,  # Disable verbose socket.io logging
    engineio_logger=False  # Disable engine.io logging
)

from app import routes