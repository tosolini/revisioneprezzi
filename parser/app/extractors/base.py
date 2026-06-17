from abc import ABC, abstractmethod


class BaseExtractor(ABC):
    @abstractmethod
    def extract_text(self, file_path: str) -> str:
        ...

    def extract(self, file_path: str) -> str:
        return self.extract_text(file_path)
