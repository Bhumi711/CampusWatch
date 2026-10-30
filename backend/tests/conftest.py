import os
import tempfile

# Configure before the app is imported: isolated DB, no background loop, fast SNMP failure.
_tmp = tempfile.mkdtemp(prefix="campus-test-")
os.environ.update(DATABASE_URL=f"sqlite:///{_tmp}/test.db", COLLECTOR_ENABLED="false", DEMO_AUTO_SEED="false",
                  SNMP_TIMEOUT_SECONDS="0.5", SNMP_RETRIES="0", COLLECTION_MODE="demo")

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.db.session import SessionLocal  # noqa: E402
from app.main import app  # noqa: E402
from app.services import seed  # noqa: E402


@pytest.fixture(scope="session")
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture(scope="session")
def seeded(client):
    with SessionLocal() as db:
        return seed.seed_demo(db, hours=24)


@pytest.fixture
def db():
    with SessionLocal() as s:
        yield s
