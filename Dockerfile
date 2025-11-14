FROM python:3.11-slim

# Prevent Python from writing .pyc files and enable unbuffered logs
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# Install dependencies first (better layer caching)
COPY fastmcp_myob/requirements.txt /app/requirements.txt
RUN pip install --upgrade pip \
    && pip install -r /app/requirements.txt

# Copy app code
COPY . /app

# Default network settings for Azure Container Apps
ENV HOST=0.0.0.0 \
    PORT=8000

EXPOSE 8000

# Run FastMCP server; transport controlled by TRANSPORT env (default sse)
ENV TRANSPORT=sse
CMD ["python", "fastmcp_myob/server.py"]
