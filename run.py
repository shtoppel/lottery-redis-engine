import asyncio
import sys
import uvicorn

# Фикс путей, чтобы "from app.routers" работало
import os

sys.path.append(os.path.dirname(os.path.abspath(__file__)))

if __name__ == "__main__":
    # Для Python 3.14+ на Windows Proactor и так дефолт,
    # но uvicorn может форсить selector. Мы явно передаем factory.

    uvicorn.run(
        "app.main:app",  # Обрати внимание на точку
        host="127.0.0.1",
        port=8000,
        reload=True,
        loop="asyncio"  # Используем стандартную петлю asyncio (которая в 3.14 уже Proactor)
    )