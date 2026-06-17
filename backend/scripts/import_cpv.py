"""Import CPV codes from local XML into cpv_catalog table."""
from pathlib import Path

from app.core.database import SessionLocal
from app.services.cpv_importer import import_from_xml

XML_PATH = Path(__file__).resolve().parent.parent.parent.parent / "cpv_2008_xml" / "cpv_2008.xml"


def main():
    db = SessionLocal()
    try:
        imported, path = import_from_xml(db, xml_path=XML_PATH)
        print(f"Importati {imported} elementi da: {path}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
