from dotenv import load_dotenv
import os

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL", "")
QDRANT_URL = os.getenv("QDRANT_URL", "")
