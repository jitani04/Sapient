import zipfile
from pathlib import Path

import pytest

from app.services.material_service import (
    ExtractedBlock,
    chunk_blocks,
    extract_material_blocks,
    validate_material_filename,
)


def test_validate_material_filename_rejects_unsupported_types() -> None:
    with pytest.raises(ValueError):
        validate_material_filename("spreadsheet.xlsx")


def test_validate_material_filename_accepts_pptx() -> None:
    validate_material_filename("lecture-slides.pptx")


def test_validate_material_filename_accepts_docx() -> None:
    validate_material_filename("study-guide.docx")


@pytest.mark.asyncio
async def test_extract_material_blocks_reads_text_file(tmp_path: Path) -> None:
    path = tmp_path / "notes.txt"
    path.write_text("Cell respiration\n\nproduces ATP.", encoding="utf-8")

    blocks = await extract_material_blocks(path)

    assert len(blocks) == 1
    assert blocks[0].text == "Cell respiration produces ATP."
    assert blocks[0].page_number is None


@pytest.mark.asyncio
async def test_extract_material_blocks_reads_pptx_slide_text(tmp_path: Path) -> None:
    path = tmp_path / "lecture.pptx"
    slide_xml = """<?xml version="1.0" encoding="UTF-8"?>
    <p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
           xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
      <p:cSld>
        <p:spTree>
          <p:sp>
            <p:txBody>
              <a:p><a:r><a:t>Photosynthesis</a:t></a:r></a:p>
              <a:p><a:r><a:t>converts light into chemical energy.</a:t></a:r></a:p>
            </p:txBody>
          </p:sp>
        </p:spTree>
      </p:cSld>
    </p:sld>
    """
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("ppt/slides/slide1.xml", slide_xml)

    blocks = await extract_material_blocks(path)

    assert len(blocks) == 1
    assert blocks[0].text == "Photosynthesis converts light into chemical energy."
    assert blocks[0].page_number == 1


@pytest.mark.asyncio
async def test_extract_material_blocks_reads_docx_text(tmp_path: Path) -> None:
    path = tmp_path / "study-guide.docx"
    document_xml = """<?xml version="1.0" encoding="UTF-8"?>
    <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
      <w:body>
        <w:p><w:r><w:t>Fine art</w:t></w:r></w:p>
        <w:p><w:r><w:t>is created for aesthetic or intellectual purposes.</w:t></w:r></w:p>
      </w:body>
    </w:document>
    """
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("word/document.xml", document_xml)

    blocks = await extract_material_blocks(path)

    assert len(blocks) == 1
    assert blocks[0].text == "Fine art is created for aesthetic or intellectual purposes."
    assert blocks[0].page_number is None


def test_chunk_blocks_preserve_order_and_overlap() -> None:
    blocks = [ExtractedBlock(text="abcdefghij", page_number=1)]

    chunks = chunk_blocks(blocks, chunk_size=4, chunk_overlap=1)

    assert [chunk.content for chunk in chunks] == ["abcd", "defg", "ghij"]
    assert [chunk.char_start for chunk in chunks] == [0, 3, 6]
    assert [chunk.page_number for chunk in chunks] == [1, 1, 1]
