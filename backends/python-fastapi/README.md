# Python FastAPI Backend Router for `<gemini-omnibar>`

Drop [`gemini_omnibar_router.py`](./gemini_omnibar_router.py) into any existing FastAPI service:

```python
from fastapi import FastAPI
from gemini_omnibar_router import router as gemini_omnibar_router

app = FastAPI()
app.include_router(gemini_omnibar_router)
```

## Required Environment Variables

```bash
export GCP_PROJECT_ID="your-gcp-project"
export GCP_LOCATION="global"
export GE_ENGINE_ID="your-agentspace-engine-id"
export GE_WIDGET_CONFIG_ID="your-widget-config-uuid"
```
