from fastapi import FastAPI

# Add docs_url and openapi_url parameters
app = FastAPI(
    docs_url="/api/docs",
    openapi_url="/api/openapi.json"
)

@app.get("/hello_world")
async def hello_world():
    return {
        "text": "Hello from FastAPI on Vercel!",
        "status": "success",
        "timestamp": "2026-04-11"
    }
