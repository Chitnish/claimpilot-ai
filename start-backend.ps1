$env:PATH = "$env:PATH;C:\Program Files\nodejs;C:\poppler\poppler-24.08.0\Library\bin"
Set-Location "C:\Users\AnishChitnis(Intern)\projects\claimpilot-ai\backend"
.\.venv\Scripts\Activate.ps1
uvicorn app.main:app --reload --port 8000
