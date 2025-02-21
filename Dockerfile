FROM python:3.12-slim

WORKDIR /app

# Install dependencies
RUN pip install --no-cache-dir flask flask-socketio

# Copy application code
COPY app/ ./app/
COPY run.py .

# Run the application
CMD ["python", "run.py"]