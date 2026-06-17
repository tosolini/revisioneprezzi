import pdfplumber

from app.extractors.base import BaseExtractor


class PdfExtractor(BaseExtractor):
    def extract_text(self, file_path: str) -> str:
        pages = []
        with pdfplumber.open(file_path) as pdf:
            for page in pdf.pages:
                text = page.extract_text()
                if text:
                    pages.append(text)
        return "\n\n".join(pages)
