"""Regenerates the Excel fixtures used by tests/e2e/teacher-mcq-editor.spec.ts (python3 + openpyxl). Files are committed; this documents how they were made."""
import io, zipfile
from openpyxl import Workbook

HEAD = ['Statement', 'Option A', 'Option B', 'Option C', 'Option D', 'Option E', 'Correct', 'Explanation', 'Difficulty', 'Topic', 'Subtopic', 'Bloom', 'Marks']

def book(rows, extra_sheet=True):
    wb = Workbook(); ws = wb.active; ws.title = 'Questions'; ws.append(HEAD)
    for r in rows: ws.append(r)
    if extra_sheet:
        other = wb.create_sheet('Notes'); other.append(['not a question', 'this sheet must be ignored'])
    return wb

ok = [
    ['Which vitamin deficiency causes scurvy?', 'Vitamin A', 'Vitamin B12', 'Vitamin C', 'Vitamin D', None, 'C', 'Ascorbic acid is needed for collagen synthesis', 'Easy', 'Nutrition', 'Vitamins', 'Remember', 1],
    ['Which cranial nerve supplies the muscles of facial expression?', 'Trigeminal', 'Facial', 'Vagus', 'Hypoglossal', None, 'b', None, 'medium', 'Neuroanatomy', None, 'Understand', 2],
    ['Which enzyme is deficient in classic phenylketonuria?', 'Tyrosinase', 'Phenylalanine hydroxylase', 'Homogentisate oxidase', 'Fumarylacetoacetase', 'Transaminase', 'B', 'Phenylalanine cannot be converted to tyrosine', 'HARD', 'Biochemistry', 'Amino acid disorders', None, 1.5],
]
book(ok).save('tests/e2e/fixtures/mcq-import-ok.xlsx')
rows = [ok[0], ok[1][:11] + ['Genius'] + ok[1][12:]]
book(rows).save('tests/e2e/fixtures/mcq-import-bad-bloom.xlsx')

# A hostile workbook: a valid-looking sheet whose inflated size is ~30 MB (it compresses to a few KB). The reader must refuse it, not inflate it.
buf = io.BytesIO(); src = zipfile.ZipFile('tests/e2e/fixtures/mcq-import-ok.xlsx')
with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as z:
    for n in src.namelist():
        data = src.read(n)
        if n == 'xl/worksheets/sheet1.xml': data = data.replace(b'</sheetData>', b'</sheetData>' + b' ' * 30_000_000)
        z.writestr(n, data)
open('tests/e2e/fixtures/zip-bomb.xlsx', 'wb').write(buf.getvalue())
print('ok', len(buf.getvalue()), 'bytes for the bomb')
